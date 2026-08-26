# Dianzhi Tool Permanent Delete Design

Status: approved via collaborative brainstorming (2026-08-26). Adds the ability to
**permanently delete** a soft-removed (deleted-status) tool from the Options tools
workspace, with an Element-UI-style confirmation dialog.

## 1. Goal

Today tools support soft remove (`deleted_at` set) and restore, forever. This spec
adds a destructive but explicit **permanent delete**: a `永久删除` button next to the
`恢复` button on each row of the "已删除" section in `src/options/tools/ToolList.tsx`,
guarded by a confirmation dialog (Element UI `MessageBox.confirm` style) so the user
confirms before the tool row is irreversibly gone.

**Product decision (2026-08-26): permanent delete removes only the `tools` row.**
Saved conversations that used the tool are **kept** — they snapshot
`tool_name`/`prompt_snapshot` at creation, so history stays viewable and nothing is
cascade-deleted. This is the non-destructive default; cascade deletion of
conversations was considered and rejected to avoid silent history loss.

## 2. Decisions

| Decision           | Choice                                                                                            | Rationale                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Delete scope       | `DELETE FROM tools` only; conversations untouched                                                 | Conversations already snapshot tool identity; avoid irreversible history loss            |
| Guard              | Only rows with `deleted_at IS NOT NULL` can be hard-deleted; active/preset rows rejected          | Prevents bypassing the soft-remove + confirm flow; presets can never reach deleted state |
| Error codes        | `TOOL_NOT_FOUND` (missing) and new `TOOL_NOT_REMOVED` (row not in deleted state)                  | Stable, testable, UI-safe messages mirror `TOOL_PRESET_INVALID` style                    |
| Confirmation UI    | Centered overlay dialog (backdrop + title + message + 取消 / 确认删除), state local to `ToolList` | Matches Element `MessageBox.confirm`; reuses the repo's existing modal-overlay pattern   |
| Operation name     | `tools.delete` event → RPC `deleteTool`                                                           | Follows `tools.restore`/`softRemoveTool` naming convention layer-for-layer               |
| Runtime boundaries | Options renders dialog + dispatches typed event; background brokers; offscreen owns SQL           | Unchanged from `CLAUDE.md` "Options is the durable settings surface"                     |

## 3. Architecture

The permanent delete flows through the same six-layer path as `restore`, with no new
crossing points:

```
ToolList (永久删除 click) → ToolsWorkspace.handleDelete → ToolsApi.delete(id)
  → toolsCommand.dispatch({ type: 'tools.delete' })
  → background index (tools.delete) → db.request('deleteTool', { id })
  → offscreen rpc → config.deleteTool(id) → DELETE FROM tools WHERE id=? AND deleted_at IS NOT NULL
  → re-list → apply() re-render
```

No Chrome context boundaries change; no manifest permission changes; no schema release
(the change is DML, not DDL).

### 3.1 Store (`src/offscreen/database/config-store.ts`)

Add to `ConfigStore` interface and `createConfigStore`:

```ts
async function deleteTool(id: number): Promise<void> {
  const result = await db.exec('DELETE FROM tools WHERE id = ? AND deleted_at IS NOT NULL', [id])
  if (Number(result.changes ?? 0) !== 1) {
    const rows = await db.query<{ deletedAt: string | null }>(
      'SELECT deleted_at AS deletedAt FROM tools WHERE id = ?',
      [id]
    )
    const row = rows[0]
    if (!row) throw toolNotFound(id)
    throw new DianzhiError({
      code: 'TOOL_NOT_REMOVED',
      message: 'The tool must be removed before it can be permanently deleted.',
      context: { id },
    })
  }
}
```

`restoreTool`/`softRemoveTool` guards stay untouched; presets never reach this path
(`softRemoveTool` already refuses preset ids).

### 3.2 Errors (`src/dianzhi/domain/errors.ts`)

Add `'TOOL_NOT_REMOVED'` to the `DianzhiErrorCode` union.

### 3.3 RPC (`src/offscreen/database/rpc.ts`)

Add to `DatabaseOperationMap`:

```ts
deleteTool: {
  args: {
    id: number
  }
  result: Awaited<ReturnType<ConfigStore['deleteTool']>>
}
```

and add `deleteTool` to the `MUTATIONS` set.

### 3.4 Protocol (`src/dianzhi/domain/protocol.ts`)

- Augment the `ToolsCommand` union:
  ```ts
  | { type: 'tools.delete'; requestId: string; payload: { id: number } }
  ```
- In `parseToolsCommand`, extend the shared `tools.softRemove`/`tools.restore` case:
  ```ts
  case 'tools.softRemove':
  case 'tools.restore':
  case 'tools.delete':
    if (!isPositiveInteger(payload.id)) return invalid('Tools id payload is invalid.')
    return { ok: true, value: { type: value.type, requestId, payload: { id: payload.id } } }
  ```

### 3.5 Background (`src/background/index.ts`)

Add a sibling case to `tools.restore`:

```ts
case 'tools.delete':
  return db
    .request('deleteTool', { id: command.payload.id })
    .then(() => db.request('listTools', { includeRemoved: true }))
```

### 3.6 Options API (`src/options/tools/use-tools-api.ts` + `ToolsWorkspace.tsx`)

- `ToolsApi` gains `delete(id: number): Promise<ToolRecord[]>`, dispatching
  `{ type: 'tools.delete' }`.
- `ToolsWorkspace` adds `handleDelete` (same shape as `handleRestore`) and passes
  `onDelete={handleDelete}` to `ToolList`.

### 3.7 UI (`src/options/tools/ToolList.tsx` + `tool-workspace.css`)

- `ToolListProps` gains `onDelete(id: number): void`.
- Each `removed-tool-row` renders `永久删除` (class `removed-tool-delete`, danger
  style) beside `恢复`.
- Clicking `永久删除` sets `deleting` local state (`ToolRecord | null`) and opens a
  centered overlay dialog:
  - Title: `永久删除工具`
  - Message: `此操作将永久删除工具“{name}”，且不可恢复。是否继续？`
  - Buttons: `取消` (secondary, closes), `确认删除` (danger, calls `onDelete(id)` and closes).
  - Backdrop click or Escape closes without deleting.
- New CSS in `tool-workspace.css`: `.removed-tool-delete` and the dialog
  (backdrop/panel) styles following the `tool-delete-confirm`/`tool-prompt-popover`
  visual conventions.

## 4. Tests

- **config-store** (`tests/unit/offscreen/config-store.spec.ts`): create a custom
  tool → `softRemoveTool` → `deleteTool` removes it from `listTools(true)`; `deleteTool`
  on an active tool rejects with `TOOL_NOT_REMOVED`; `deleteTool` on an unknown id
  rejects with `TOOL_NOT_FOUND`.
- **protocol** (`tests/unit/dianzhi/protocol.spec.ts`): `tools.delete` with a valid
  id parses; invalid/missing id is rejected.
- **ToolList** (`tests/unit/options/ToolList.spec.tsx`, new): clicking `永久删除`
  shows the dialog with the tool name; `确认删除` calls `onDelete` once; `取消` and
  backdrop click do not call `onDelete`.
- Existing suite must stay green: `pnpm run test`.

## 5. Files changed

| Path                                                                        | Change                                    |
| --------------------------------------------------------------------------- | ----------------------------------------- |
| `src/offscreen/database/config-store.ts`                                    | `deleteTool` call + store method          |
| `src/dianzhi/domain/errors.ts`                                              | `TOOL_NOT_REMOVED` code                   |
| `src/offscreen/database/rpc.ts`                                             | operation map + MUTATIONS entry           |
| `src/dianzhi/domain/protocol.ts`                                            | `tools.delete` type + parse               |
| `src/background/index.ts`                                                   | `tools.delete` handler                    |
| `src/options/tools/use-tools-api.ts`                                        | `ToolsApi.delete`                         |
| `src/options/tools/ToolsWorkspace.tsx`                                      | `handleDelete` + `onDelete` prop          |
| `src/options/tools/ToolList.tsx`                                            | button + confirm dialog + `onDelete` prop |
| `src/options/tools/tool-workspace.css`                                      | button + dialog styles                    |
| `tests/unit/offscreen/config-store.spec.ts`                                 | permanent-delete cases                    |
| `tests/unit/dianzhi/protocol.spec.ts`                                       | `tools.delete` parse cases                |
| `tests/unit/options/ToolList.spec.tsx`                                      | **new** dialog/button cases               |
| `docs/superpowers/specs/2026-08-26-dianzhi-tool-permanent-delete-design.md` | this document                             |

## 6. Non-goals

- No cascade deletion of conversations.
- No manifest/permission changes.
- No schema release; no change to soft-remove or restore semantics.
- No global/shared dialog component (dialog stays local to `ToolList`).
