# Tool Permanent Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `永久删除` button to soft-removed tools in the Options tools pane, guarded by an Element-UI-style confirm dialog, backed by a new `deleteTool` store operation that removes only the `tools` row (conversation history is kept).

**Architecture:** The permanent delete flows through the existing six-layer path already used by `restore`: `ToolList` button → `ToolsWorkspace.handleDelete` → `ToolsApi.delete` → `toolsCommand.dispatch({ type: 'tools.delete' })` → background handler → offscreen RPC → `config.deleteTool(id)` (`DELETE ... WHERE id=? AND deleted_at IS NOT NULL`) → re-list. The confirm dialog is local React state inside `ToolList`.

**Tech Stack:** TypeScript, React (Options page), Chrome extension messaging, OPFS SQLite; unit tests with vitest + `node:sqlite` (spec files that use it start with `// @vitest-environment node`).

**Spec:** `docs/superpowers/specs/2026-08-26-dianzhi-tool-permanent-delete-design.md` (approved 2026-08-26). §3 defines the store method, error codes, event plumbing, and UI.

---

### Task 1: Store-level permanent delete

**Files:**
- Modify: `src/dianzhi/domain/errors.ts`
- Modify: `src/offscreen/database/config-store.ts`
- Test: `tests/unit/offscreen/config-store.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append these four tests to `tests/unit/offscreen/config-store.spec.ts` (the file already has `// @vitest-environment node` on line 1 and imports `createConfigStore` and `createNodeDatabase`):

```ts
it('permanently deletes a soft-removed tool', async () => {
  const { connection, db } = createNodeDatabase()
  const config = createConfigStore(connection, clock)
  await config.ensurePresets()
  const tool = await config.createTool({ name: '临时工具', prompt: 'p' })
  await config.softRemoveTool(tool.id)
  await config.deleteTool(tool.id)
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM tools WHERE id = ?')
    .get(tool.id) as { count: number }
  expect(row.count).toBe(0)
  const list = await config.listTools(true)
  expect(list.some((item) => item.id === tool.id)).toBe(false)
})

it('rejects permanently deleting a tool that is not in deleted status', async () => {
  const { connection } = createNodeDatabase()
  const config = createConfigStore(connection, clock)
  await config.ensurePresets()
  const tool = await config.createTool({ name: '活跃工具', prompt: 'p' })
  await expect(config.deleteTool(tool.id)).rejects.toMatchObject({
    code: 'TOOL_NOT_REMOVED',
  })
})

it('rejects permanently deleting an unknown tool id', async () => {
  const { connection } = createNodeDatabase()
  const config = createConfigStore(connection, clock)
  await expect(config.deleteTool(999_999)).rejects.toMatchObject({
    code: 'TOOL_NOT_FOUND',
  })
})

it('keeps conversations when a tool is permanently deleted', async () => {
  const { connection, db } = createNodeDatabase()
  const now = clock()
  db.prepare(
    `INSERT INTO conversations (selection_key, tab_id, tool_id, tool_name, title, selected_text, context_text, prompt_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(0, 1, 1050, '旧工具', 't', 's', 'c', 'p', now, now)
  db.prepare(
    `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 1, 1, ?, ?, ?)`
  ).run(1050, '旧工具', 'p', now, now, now)
  const config = createConfigStore(connection, clock)
  await config.deleteTool(1050)
  const conv = db
    .prepare('SELECT COUNT(*) AS count FROM conversations WHERE tool_id = 1050')
    .get() as { count: number }
  expect(conv.count).toBe(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/offscreen/config-store.spec.ts`
Expected: FAIL — `config.deleteTool is not a function` (3 tests) / `config.deleteTool` rejects (keeps-conversations test fails on the missing method too).

- [ ] **Step 3: Add the error code**

In `src/dianzhi/domain/errors.ts`, add `'TOOL_NOT_REMOVED'` to the `DianzhiErrorCode` union (after `'TOOL_ORDER_INVALID'`, before `'TOOL_PRESET_INVALID'`):

```ts
  | 'TOOL_ORDER_INVALID'
  | 'TOOL_NOT_REMOVED'
  | 'TOOL_PRESET_INVALID'
```

- [ ] **Step 4: Implement `deleteTool`**

In `src/offscreen/database/config-store.ts`:

1. Add to the `ConfigStore` interface (after `restoreTool(id: number): Promise<void>`, currently line 55):

```ts
  deleteTool(id: number): Promise<void>
```

2. Add the implementation inside `createConfigStore`, directly after the `restoreTool` function (currently ends around line 352):

```ts
  async function deleteTool(id: number): Promise<void> {
    const result = await db.exec(
      'DELETE FROM tools WHERE id = ? AND deleted_at IS NOT NULL',
      [id]
    )
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

3. Add `deleteTool` to the returned store object (near `restoreTool` in the return statement).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/offscreen/config-store.spec.ts`
Expected: PASS (8 tests — 4 allocation + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/dianzhi/domain/errors.ts src/offscreen/database/config-store.ts \
        tests/unit/offscreen/config-store.spec.ts
git commit -m "feat(tools): add permanent deleteTool for soft-removed tools"
```

---

### Task 2: Protocol + RPC + background `tools.delete`

**Files:**
- Modify: `src/dianzhi/domain/protocol.ts`
- Modify: `src/offscreen/database/rpc.ts`
- Modify: `src/background/index.ts`
- Test: `tests/unit/dianzhi/protocol.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/dianzhi/protocol.spec.ts` (add `parseToolsCommand` to the import on line 1, so it reads `import { parseConversationCommand, parseToolsCommand } from '@/dianzhi/domain/protocol'`):

```ts
describe('parseToolsCommand: tools.delete', () => {
  const requestId = 'r-tools-delete'

  it('accepts a positive integer id', () => {
    const result = parseToolsCommand({
      type: 'tools.delete',
      requestId,
      payload: { id: 5 },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatchObject({ type: 'tools.delete', payload: { id: 5 } })
    }
  })

  it('rejects a non-positive id', () => {
    const result = parseToolsCommand({
      type: 'tools.delete',
      requestId,
      payload: { id: 0 },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing id', () => {
    const result = parseToolsCommand({ type: 'tools.delete', requestId, payload: {} })
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/dianzhi/protocol.spec.ts`
Expected: FAIL — `parseToolsCommand` returns `invalid('Tools command type is invalid.')` for `tools.delete` (id is not accepted).

- [ ] **Step 3: Add the union member**

In `src/dianzhi/domain/protocol.ts`, extend the `ToolsCommand` union (after the `tools.restore` member at line 157):

```ts
  | { type: 'tools.restore'; requestId: string; payload: { id: number } }
  | { type: 'tools.delete'; requestId: string; payload: { id: number } }
```

- [ ] **Step 4: Extend the parser**

In `src/dianzhi/domain/protocol.ts`, change the shared case at lines 392–395:

```ts
    case 'tools.softRemove':
    case 'tools.restore':
    case 'tools.delete':
      if (!isPositiveInteger(payload.id)) return invalid('Tools id payload is invalid.')
      return { ok: true, value: { type: value.type, requestId, payload: { id: payload.id } } }
```

- [ ] **Step 5: Register the RPC operation**

In `src/offscreen/database/rpc.ts`, add to `DatabaseOperationMap` (after `restoreTool`, line 79):

```ts
  deleteTool: {
    args: { id: number }
    result: Awaited<ReturnType<ConfigStore['deleteTool']>>
  }
```

and add `deleteTool` to the `MUTATIONS` set (after `'restoreTool'`, line 115):

```ts
  'softRemoveTool',
  'restoreTool',
  'deleteTool',
  'migrateLegacy',
```

- [ ] **Step 6: Add the background handler**

In `src/background/index.ts`, inside `dispatchToolsCommand`, add a case after `tools.restore` (after line 214):

```ts
    case 'tools.delete':
      return db
        .request('deleteTool', { id: command.payload.id })
        .then(() => db.request('listTools', { includeRemoved: true }))
```

- [ ] **Step 7: Verify type check + tests**

Run: `pnpm exec tsc -b` → exit 0 (the exhaustive switch now covers `tools.delete`).
Run: `pnpm exec vitest run tests/unit/dianzhi/protocol.spec.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/dianzhi/domain/protocol.ts src/offscreen/database/rpc.ts \
        src/background/index.ts tests/unit/dianzhi/protocol.spec.ts
git commit -m "feat(tools): wire tools.delete event through protocol, rpc, and background"
```

---

### Task 3: Options API + workspace wiring

**Files:**
- Modify: `src/options/tools/use-tools-api.ts`
- Modify: `src/options/tools/ToolsWorkspace.tsx`

No unit test here: `options/App.spec.tsx` stubs `ToolsWorkspace` entirely and the dispatch-adapter validation is covered by the protocol spec (Task 2). This task's correctness is verified by `pnpm exec tsc -b` plus the ToolList spec in Task 4.

- [ ] **Step 1: Add `delete` to the API adapter**

In `src/options/tools/use-tools-api.ts`, add to the `ToolsApi` interface (after `restore`, line 12):

```ts
  delete(id: number): Promise<ToolRecord[]>
```

and add to the returned object (after the `restore` entry, before the closing `}),`):

```ts
      delete: (id) =>
        toolsCommand.dispatch({
          type: 'tools.delete',
          requestId: freshRequestId(),
          payload: { id },
        }) as Promise<ToolRecord[]>,
```

- [ ] **Step 2: Wire the workspace handler**

In `src/options/tools/ToolsWorkspace.tsx`, add a handler next to `handleRestore` (after line 140):

```ts
  const handleDelete = (id: number) => {
    void toolsApi
      .delete(id)
      .then(apply)
      .catch((reason: unknown) => setError(message(reason)))
  }
```

and pass it through – the `ToolList` usage (line 146–156) gains:

```tsx
        onRestore={handleRestore}
        onDelete={handleDelete}
```

(`onDelete` does not exist on `ToolListProps` until Task 4; `tsc` will be red here until Task 4 lands, which is expected — do NOT commit mid-task state without Task 4.)

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc -b` — expected to FAIL until Task 4 adds `onDelete` to `ToolListProps`. This task and Task 4 are interdependent for type-cleanliness; proceed straight to Task 4 before committing.

---

### Task 4: ToolList button + confirm dialog

**Files:**
- Modify: `src/options/tools/ToolList.tsx`
- Modify: `src/options/tools/tool-workspace.css`
- Test: `tests/unit/options/ToolList.spec.tsx` (new)
- Modify: `eslint.config.js` (allow-list the new spec)

- [ ] **Step 1: Write the failing component tests**

Create `tests/unit/options/ToolList.spec.tsx`:

```tsx
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolList } from '@/options/tools/ToolList'
import type { ToolRecord } from '@/offscreen/database/config-store'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

const removedTool: ToolRecord = {
  id: 77,
  name: '旧工具',
  prompt: '# x',
  enabled: false,
  isDefault: false,
  isPreset: false,
  deletedAt: '2026-08-20T00:00:00.000Z',
  sortOrder: 1,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

function renderToolList() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const handlers = {
    onSelect: vi.fn(),
    onToggleEnabled: vi.fn(),
    onSetDefault: vi.fn(),
    onReorder: vi.fn(),
    onAdd: vi.fn(),
    onRestore: vi.fn(),
    onDelete: vi.fn(),
  }
  act(() => {
    root?.render(
      <ToolList
        tools={[]}
        removed={[removedTool]}
        selectedId={null}
        onSelect={handlers.onSelect}
        onToggleEnabled={handlers.onToggleEnabled}
        onSetDefault={handlers.onSetDefault}
        onReorder={handlers.onReorder}
        onAdd={handlers.onAdd}
        onRestore={handlers.onRestore}
        onDelete={handlers.onDelete}
      />
    )
  })
  return { host, handlers }
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('ToolList removed tools', () => {
  it('renders a permanent-delete button next to restore', () => {
    renderToolList()
    expect(host?.querySelector('.removed-tool-restore')).not.toBeNull()
    expect(host?.querySelector('.removed-tool-delete')).not.toBeNull()
  })

  it('opens the confirm dialog with the tool name and cancels without deleting', () => {
    const { host, handlers } = renderToolList()
    act(() => host?.querySelector<HTMLButtonElement>('.removed-tool-delete')?.click())
    const dialog = host?.querySelector('.tool-delete-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('旧工具')
    act(() => host?.querySelector<HTMLButtonElement>('.tool-delete-dialog .secondary')?.click())
    expect(host?.querySelector('.tool-delete-dialog')).toBeNull()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('calls onDelete once with the tool id on confirm', () => {
    const { host, handlers } = renderToolList()
    act(() => host?.querySelector<HTMLButtonElement>('.removed-tool-delete')?.click())
    act(() =>
      host
        ?.querySelector<HTMLButtonElement>('.tool-delete-dialog-actions .danger')
        ?.click()
    )
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
    expect(handlers.onDelete).toHaveBeenCalledWith(77)
    expect(host?.querySelector('.tool-delete-dialog')).toBeNull()
  })

  it('closes the dialog on backdrop click without deleting', () => {
    const { host, handlers } = renderToolList()
    act(() => host?.querySelector<HTMLButtonElement>('.removed-tool-delete')?.click())
    act(() => host?.querySelector<HTMLButtonElement>('.tool-delete-dialog-backdrop')?.click())
    expect(host?.querySelector('.tool-delete-dialog')).toBeNull()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/options/ToolList.spec.tsx`
Expected: FAIL — `.removed-tool-delete` and `.tool-delete-dialog` do not exist yet.

- [ ] **Step 3: Implement the button + dialog**

In `src/options/tools/ToolList.tsx`:

1. Add to `ToolListProps` (after `onRestore`, line 14):

```ts
  onDelete(id: number): void
```

2. Add dialog state next to the existing `dragOver` state (line 95):

```ts
  const [confirmingDelete, setConfirmingDelete] = useState<ToolRecord | null>(null)
```

3. In the removed-tool row, add the button after the 恢复 button (after line 258):

```tsx
                <button
                  type="button"
                  className="removed-tool-delete"
                  aria-label={`永久删除工具 ${tool.name}`}
                  onClick={() => setConfirmingDelete(tool)}
                >
                  永久删除
                </button>
```

4. Append the dialog as the last child of the root `<div className="tool-list-pane">` (after the removed-tools `</section>`, before the closing `</div>`), using a `<button>` backdrop to match the repo's existing overlay pattern (a11y-safe):

```tsx
      {confirmingDelete !== null && (
        <div className="tool-delete-dialog-layer">
          <button
            type="button"
            className="tool-delete-dialog-backdrop"
            aria-label="取消永久删除"
            onClick={() => setConfirmingDelete(null)}
          />
          <section
            className="tool-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="永久删除工具"
          >
            <h3 className="tool-delete-dialog-title">永久删除工具</h3>
            <p className="tool-delete-dialog-message">
              此操作将永久删除工具“{confirmingDelete.name}”，且不可恢复。是否继续？
            </p>
            <div className="tool-delete-dialog-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setConfirmingDelete(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  props.onDelete(confirmingDelete.id)
                  setConfirmingDelete(null)
                }}
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
```

- [ ] **Step 4: Add the CSS**

In `src/options/tools/tool-workspace.css`, after the `.removed-tool-restore:hover` rule (line 270):

```css
.removed-tool-delete {
  border: 1px solid var(--d-danger-border);
  border-radius: var(--d-radius-xs);
  padding: 3px 10px;
  color: var(--d-danger);
  background: var(--d-surface);
  font-size: var(--d-text-hint);
  font-weight: 600;
  cursor: pointer;
}
.removed-tool-delete:hover {
  border-color: var(--d-danger);
  color: var(--d-danger);
}
```

and after the "Prompt editor popover" comment block region (end of the popover rules, before any media queries):

```css
/* Permanent-delete confirm dialog (Element-style message box) */
.tool-delete-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
}
.tool-delete-dialog-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(31, 26, 22, 0.34);
  cursor: default;
}
.tool-delete-dialog {
  position: relative;
  z-index: 1;
  width: min(360px, calc(100vw - 32px));
  border: 1px solid var(--d-border);
  border-radius: var(--d-radius-md);
  padding: 18px;
  background: var(--d-surface);
  box-shadow: 0 20px 50px rgba(55, 42, 28, 0.24);
}
.tool-delete-dialog-title {
  margin: 0 0 8px;
  font-size: 15px;
}
.tool-delete-dialog-message {
  margin: 0 0 16px;
  color: var(--d-text-secondary);
  font-size: var(--d-text-label);
  line-height: 1.6;
}
.tool-delete-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 5: Allow-list the spec**

In `eslint.config.js`, add `'tests/unit/options/ToolList.spec.tsx'` to `allowDefaultProject` (alphabetically between `'tests/unit/options/App.spec.tsx'` and `'tests/unit/options/ToolConfig.spec.tsx'`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/options/ToolList.spec.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Full verification**

Run: `pnpm exec tsc -b` → exit 0 (Task 3 + Task 4 together make the types clean).
Run: `pnpm exec vitest run` → full suite PASS.
Run: `pnpm exec eslint tests/unit/options/ToolList.spec.tsx src/options/tools/ToolList.tsx src/options/tools/ToolsWorkspace.tsx src/options/tools/use-tools-api.ts` → exit 0.

- [ ] **Step 8: Commit Tasks 3 + 4 together**

```bash
git add src/options/tools/use-tools-api.ts src/options/tools/ToolsWorkspace.tsx \
        src/options/tools/ToolList.tsx src/options/tools/tool-workspace.css \
        tests/unit/options/ToolList.spec.tsx eslint.config.js
git commit -m "feat(tools): permanent-delete button and confirm dialog for removed tools"
```

---

### Task 5: Gates and final verification

**Files:** none expected.

- [ ] **Step 1: Format check**

Run: `pnpm run format:check`
Expected: PASS. If only feature files need fixes, run prettier on them and re-check.

- [ ] **Step 2: Lint + type check**

Run: `pnpm exec tsc -b` → exit 0.
Run: `pnpm run lint` — NOTE: this repo's lint gate is red repo-wide for pre-existing reasons (un-allowlisted `web-sqlite-js/**`, `.agents/**`, several spec files, and the >14 default-project cap). Verify by classification that **none** of the errors are in the files this feature changed (`src/offscreen/database/config-store.ts`, `src/offscreen/database/rpc.ts`, `src/dianzhi/domain/errors.ts`, `src/dianzhi/domain/protocol.ts`, `src/background/index.ts`, `src/options/tools/{use-tools-api,ToolsWorkspace,ToolList}.ts*`, our new/edited spec files, `eslint.config.js`). Report the classification, do not fix unrelated files.

- [ ] **Step 3: Unit tests**

Run: `pnpm run test`
Expected: all PASS (24+ files).

- [ ] **Step 4: Production build**

Run: `pnpm run build`
Expected: completes (vendors SQLite, `tsc -b`, vite build). Do not hand-edit `dist/`.

- [ ] **Step 5: Drift check**

Run `/drift-check` and resolve any findings that point at this feature.

- [ ] **Step 6: Commit any fixes (only if a gate above needed a fix to a feature file)**

```bash
git add -A
git commit -m "chore: post-gate fixes for tool permanent delete"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 store+errors ⇢ Task 1; §3.3 RPC, §3.4 protocol, §3.5 background ⇢ Task 2; §3.6 Options API ⇢ Task 3; §3.7 UI/dialog/CSS ⇢ Task 4; §4 tests ⇢ Tasks 1, 2, 4; §5 files all touched.
- **Type consistency:** `deleteTool` is the store method; the event type string is `tools.delete`; the API adapter method is `delete`; the `ToolList` prop is `onDelete`; CSS classes are `removed-tool-delete`, `tool-delete-dialog`, `tool-delete-dialog-backdrop`, `tool-delete-dialog-actions`. These names are used identically across tasks and tests.
- **Tasks 3 and 4 are interdependent for type-cleanliness** (`onDelete` prop) and are committed together in Task 4 Step 8.