# Tools Options Page — Three-Pane Master-Detail-Test Workspace

## Context

The user asked for the Options page's 查询工具 (tools) section to be redesigned as a workspace where the user can, in one stable view: pick a tool (left list, drag-and-drop reorder), configure it (middle pane), and live-test it (right playground). This mirrors the approved layout in `docs/superpowers/specs/2026-08-17-dianzhi-sqlite-tools-options-testing-design.md` §5 (the brainstorm mockup "B — Master + config + live test"), but implemented **on the current settings-based data model** (string IDs, `promptMode: preset|custom`) — the user chose this scope over the much larger SQLite migration.

Today the tools section (`src/options/App.tsx:168-267`) is a stacked list of cards with ↑/↓/删除 only — no drag-and-drop, no live test. The existing `settings.testProvider` does a non-streaming, non-abortable fixed "Reply with OK." call (`src/background/index.ts:117-136`), so a real tool test needs a small new background transport.

Note: a complete three-pane implementation exists in a side worktree on the **SQLite model** (`/mnt/c/users/administrator/desktop/myprojects/com.wuchuheng.extension.dianzhi/.superpowers/worktrees/dianzhi-sqlite-tools-options-testing/src/options/{tools,test}/`). It is not merged and not portable as-is (numeric IDs, dirty drafts, `保存工具`). This plan **borrows its proven patterns** (port transport, request-ID filtering, reorder math, responsive CSS) while staying on the current model.

## Data flow & message protocol

**Live test transport** (mirrors the Side Panel port precedent, `src/sidepanel/App.tsx:136-168` / `src/background/conversation-manager.ts:615`):

- Options page opens `chrome.runtime.connect({ name: OPTIONS_TOOL_TEST_PORT_NAME })` lazily on first run; sends `{ type: 'tool.test', requestId, payload: { prompt, provider } }`; background runs `streamChat` with a per-port AbortController and streams typed updates back over the same port. Port disconnect (page close) aborts the fetch — this fixes the "closing Options leaves the request running" gap.
- The **filled** prompt string is sent from Options (`fillTemplate(effectivePrompt(tool), { selected, context })`), so "what the preview shows" == "what runs" and the runner stays stateless.
- Persistence: none. The runner uses `streamChat` directly (never `createProviderRunner`/DB), so no conversation or message rows are ever written.

## Protocol additions — `src/dianzhi/domain/protocol.ts`

Next to `SIDEPANEL_PORT_NAME` (line 5):

```ts
export const OPTIONS_TOOL_TEST_PORT_NAME = 'dianzhi:options-tool-test'

export type ToolTestCommand =
  | {
      type: 'tool.test'
      requestId: string
      payload: { prompt: string; provider: ProviderSettings }
    }
  | { type: 'tool.test.stop'; requestId: string; payload: Record<string, never> }

export type ToolTestUpdate =
  | { type: 'test.validating'; requestId: string }
  | { type: 'test.started'; requestId: string }
  | { type: 'test.delta'; requestId: string; kind: 'content' | 'reasoning'; delta: string }
  | {
      type: 'test.done'
      requestId: string
      content: string
      reasoningContent: string
      firstTokenMs: number | null
      totalMs: number
    }
  | {
      type: 'test.stopped'
      requestId: string
      content: string
      reasoningContent: string
      firstTokenMs: number | null
      totalMs: number
    }
  | { type: 'test.error'; requestId: string; error: DianzhiErrorShape }

// parseOptionsTestCommand(value): ParseResult<ToolTestCommand>
```

`parseOptionsTestCommand` mirrors `parseConversationCommand` (`protocol.ts:158-227`): `isRecord` envelope, `isRequestId(requestId)`, `typeof type === 'string'`, `isRecord(payload)`, reject caller `tabId` (`hasCallerTabId`, line 149). For `tool.test`: non-empty trimmed `payload.prompt`, and `isProviderSettings(payload.provider)` structural guard (baseUrl/apiKey/model `string`, finite `temperature`, `reasoningEnabled` boolean, `reasoningEffort ∈ {low,medium,high}`, `thinkingParam ∈ {'',enable_thinking}`, `extraBody` string). Empty prompt → `INVALID_EVENT` at parse time. `tool.test.stop` payload must be `{}`. Unknown type → `INVALID_EVENT`.

Also add `'TEST_PORT_CLOSED'` to `DianzhiErrorCode` in `src/dianzhi/domain/errors.ts:1-11`.

## Files to create

- `src/background/options-test-runner.ts` — `createOptionsToolTestRunner(deps: { streamChat?, now?, isExtensionUrl? }): { connect(port): void }`. Per-port `Map<Port, { controller: AbortController; token: symbol }>`. `connect`: filter by `port.name`; reject non-extension sender (default `isExtensionUrl = (u) => u.startsWith(chrome.runtime.getURL(''))`, reject `!port.sender?.url`); `onMessage` → `parseOptionsTestCommand` → `handle`; `onDisconnect` → abort + remove. `handle`: abort previous run, new `AbortController`+token. `run`: post `test.validating` → guard empty apiKey/model (`DianzhiError` `PROVIDER_NOT_CONFIGURED`) → `test.started` → `streamChat({ provider, messages: [{ role: 'user', content: prompt }], signal }, { fetch, onDelta, onDone })`. `onDelta` checks `isCurrent(token)` before any post; tracks `content`/`reasoningContent`/`firstTokenMs`. Success → `test.done` with totals (`now()`). Abort → `test.stopped` with partials. Other errors → `test.error` (`DianzhiError` → `toJSON()`, else `PROVIDER_STREAM_ERROR`). `post` try/catch; on throw `logWarn` + abort. Uses only `src/events/logger.ts`.
- `src/options/tools/use-tool-test.ts` — `useToolTest(deps: { connect? }): { state, run({prompt, provider}), stop(), reset() }`. `useReducer` over `reduceToolTestState`; lazy `ensurePort()` on first run (try/catch → dispatch `test.validating` + `test.error` with `TEST_PORT_CLOSED` so the pane never strands); `onMessage` filters by `requestIdRef.current`; stale-disconnect guard (`sidepanel/App.tsx:150` pattern); unmount disconnects port.
- `src/options/tools/tool-test-state.ts` — `ToolTestStatus = 'idle'|'validating'|'streaming'|'completed'|'stopped'|'error'`; `ToolTestState { status, requestId, content, reasoningContent, firstTokenMs, totalMs, error: DianzhiErrorShape|null }`; `INITIAL_TOOL_TEST_STATE`; `reduceToolTestState(state, action)`. Rules: `test.reset` → initial; `test.validating` resets + status; mismatched `requestId` dropped; terminal statuses freeze further same-request deltas; `done`/`stopped` replace content with authoritative background-accumulated strings. (Bespoke reducer on purpose — `reduceConversationView`'s snapshot/message machinery is meaningless for a non-persistent probe.)
- `src/options/tools/ToolsWorkspace.tsx` — container. Props `{ settings, onSettingsChange, testStream? }` (`testStream` defaults to `useToolTest()`, injectable for tests). Owns `activeToolId` (`useState` + repair effect) and `detailTab` (`'config'|'test'`, used at medium width). Handles: `updateTool(id, patch)` (moved from `App.tsx:31-35`), toggle-enabled via `setToolEnabled`, move via `moveTool`, reorder via `reorderToolsByTarget`, add via `addCustomTool` (then select the newly appended non-builtin id), remove via `removeCustomTool`, defaultToolId via `updateUi`-style patch. Renders the three panes.
- `src/options/tools/ToolList.tsx` — presentational. Props `{ tools, selectedId, onSelect, onToggleEnabled, onMove, onReorder, onAdd }`. `<li draggable>` rows: grip glyph, name `<button aria-current={selected}'>`, 内置/自定义 badge, enabled checkbox (`stopPropagation`), ↑/↓ buttons (disabled at ends). Native HTML5 DnD (`onDragStart`/`onDragOver` midpoint `before`/`onDrop`/`onDragEnd`), drop-indicator lines. Header: `共 N 个工具` + `+ 添加自定义工具`.
- `src/options/tools/ToolConfig.tsx` — presentational. Props `{ tool, isDefaultTool, defaultOptions, onUpdate(patch), onSetDefault(id), onRemove() }`. Fields: 名称, 启用, 提示词模式 (`preset` disabled for non-builtin), 提示词 textarea (`readOnly` when preset, value `effectivePrompt(tool)`, editable `customPrompt` otherwise), 默认工具 select (only enabled tools), 删除 (non-builtin only). Inline "已停用" hint when `!tool.enabled`.
- `src/options/tools/ToolTestPane.tsx` — presentational playground. Props `{ tool, provider, testStream }`. Local `selectedText`/`contextText` state; live preview (`fillTemplate(effectivePrompt(tool), {...})`, `white-space: pre-wrap`); `运行测试` (disabled when running or empty prompt) / `停止` / `清空`; `role="status"` line mapping statuses 就绪/正在校验服务…/正在生成…/已完成/已停止/测试失败(error message); separate reasoning (`<pre>`) + answer regions. No `Markdown`/`Reasoning` shared components — they emit `dz-` classes whose CSS lives in sidepanel/content sheets, not Options.
- `src/options/tools/tool-workspace.css` — three-pane grid + responsive (below).

## Files to modify

- `src/options/settings-form.ts` — add pure helpers (reuse `copy()` idiom):
  - `reorderToolsByTarget(settings, draggedId, targetId, before): DianzhiSettings` — splice-out then insert before/after target, recomputing the post-removal target index; no-op (same reference) when indices invalid/unchanged.
  - `setToolEnabled(settings, toolId, enabled): DianzhiSettings` — patches one tool; when disabling the current `ui.defaultToolId`, repairs to the first enabled tool (fallback `'context'`), mirroring `removeCustomTool` (`settings-form.ts:26-27`).
- `src/options/App.tsx` — replace the tools section (lines 168-267) with `<ToolsWorkspace settings={settings} onSettingsChange={props.onSettingsChange} />`. Remove now-unused imports (`addCustomTool`, `moveTool`, `removeCustomTool` from line 5; `effectivePrompt` if no longer used elsewhere here) and the local `updateTool` (lines 31-35). Keep `OptionsViewProps` unchanged.

> Note: the workspace needs `settings` — if `effectivePrompt`/`fillTemplate` must be called by children only, keep the imports where used; the container re-derives them from `settings.tools`.

- `src/options/App.css` — remove dead rules used only by the replaced section: `.default-tool`, `.tool-list`, `.tool-card`, `.tool-head`, `.section-title` (`.primary`/`.secondary`/`.settings-card`/`.grid-two` stay).
- `src/background/index.ts` — `const optionsTestRunner = createOptionsToolTestRunner()`; add `chrome.runtime.onConnect.addListener((port) => optionsTestRunner.connect(port))` beside line 151. Multiple `onConnect` listeners are safe (each filters by `port.name`; no collision with `SIDEPANEL_PORT_NAME` or the `ep2cs:` relay).

## CSS layout (plain CSS, existing palette `#c85f32`/`#ded8ce`/`#f3ded1`/`#f5f2ec`)

```css
.tool-workspace {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
```

- Desktop (≥1024): three panes visible (`tool-list-pane` | `tool-config-pane` | `tool-test-pane`, card recipe matching `.settings-card`). Medium (768–1023, when `.options-shell main` ≈ 710px): `grid-template-columns: 1fr`; tool list above a `配置/测试` tabset (`detail-tabs`, `[hidden]` on inactive pane). Mobile (≤767): stacked, no tabs, no horizontal scroll. Respect `prefers-reduced-motion`. Do not touch the existing `.options-shell` breakpoint (`App.css:212`).

## Component tree / state ownership

| Concern                                            | Owner                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `settings.tools` / `ui.defaultToolId` / `provider` | Parent draft via `onSettingsChange` (single source of truth, global 保存设置 persists) |
| `activeToolId`                                     | `ToolsWorkspace` local `useState`, repaired by effect when tools change                |
| `detailTab` (medium width)                         | `ToolsWorkspace` local `useState`                                                      |
| Live-test port + view state                        | `useToolTest()` hook owned by `ToolsWorkspace`                                         |
| Sample selected/context inputs                     | `ToolTestPane` local state (persist across tool switches)                              |
| DnD drop-position                                  | `ToolList` local state                                                                 |

## Tests (red-green-refactor, repo patterns)

1. `tests/unit/options/settings-form.spec.ts` — extend: `reorderToolsByTarget` no-op cases return same reference; valid moves (first→after third, third→before first) verify exact order and input immutability; `setToolEnabled` patches only target; disabling default repairs `defaultToolId`; disabling non-default leaves it.
2. `tests/unit/options/tool-test-state.spec.ts` — new: validating resets; deltas append to right stream; stale requestId dropped; terminal freezes; done replaces strings; error sets status; reset → idle.
3. `tests/unit/domain/protocol.spec.ts` — extend: valid `tool.test`/`tool.test.stop` accepted; rejects (non-object envelope, missing requestId, empty prompt, non-record payload, caller `tabId`, malformed provider incl. bad `reasoningEffort`/NaN temperature, unknown type, non-empty stop payload); port-name constant assertion.
4. `tests/unit/background/options-test-runner.spec.ts` — new (`// @vitest-environment node`, injected `streamChat`/`now`, fake port): update ordering validating→started→delta→delta→done with accumulated strings + metrics; empty apiKey/model → `PROVIDER_NOT_CONFIGURED`, `streamChat` never called; new start aborts previous (token guard blocks late posts); port disconnect aborts; wrong name / non-extension sender → disconnect, no listeners; `postMessage` throw aborts.
5. `tests/unit/options/use-tool-test.spec.tsx` — new (jsdom, `createRoot`+`act`, fake port): lazy connect; run sends `tool.test` + validating; streams matching requestId, ignores others; connect throw → `TEST_PORT_CLOSED` error (never stranded); stop/reset/unmount behaviors.
6. `tests/unit/options/app.spec.tsx` — extend: render `section="tools"`, assert workspace heading, list, config fields, test pane. Optional `tool-list.spec.tsx`/`tool-config.spec.tsx` markup tests (`renderToStaticMarkup`, `aria-current`, read-only preset textarea).
7. Optional E2E: `tests/e2e/tools-options.spec.ts` with existing mock provider (like `dianzhi.spec.ts`) — run test on the active tool, assert streamed answer, verify via the offscreen DB channel that zero conversation rows were created.

## Implementation order

1. Protocol + errors (`protocol.ts`, `errors.ts`) + protocol tests.
2. Background runner (`options-test-runner.ts`) + tests; wire `onConnect` in `index.ts`.
3. Pure helpers (`settings-form.ts`) + reducer (`tool-test-state.ts`) + tests.
4. Hook (`use-tool-test.ts`) + tests.
5. Presentational components (`ToolList`, `ToolConfig`, `ToolTestPane`) + markup tests.
6. Container (`ToolsWorkspace`) + `tool-workspace.css`; swap the App.tsx tools section; clean `App.css`; extend `app.spec.tsx`.
7. Full gates: `pnpm run format:check`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, `pnpm run test:e2e`.

## Verification

- `pnpm run format:check && pnpm run lint && pnpm run test && pnpm run build`
- `pnpm run test:e2e` (existing suite stays green; new tools-options spec optional).
- Manual unpacked Chrome at **375 / 768 / 1024 / 1440**: 1440+1024 three-pane; 768 list + 配置/测试 tabs; 375 stacked, no horizontal scroll. DnD reorder + ↑/↓ alternative, then 保存设置 → reload → order persists and matches popover/Side Panel tabs. Row click selects; disabling the default tool repairs the default select; 添加自定义工具 selects the new draft; deleting active custom tool falls back. Run a tool test with a real key: reasoning + answer stream separately; 停止 aborts; rerun aborts the previous; **no conversation rows are created**; closing the Options tab aborts the in-flight fetch (Network tab). Console clean, no `console.log` in new code.

## Risks

- **Sender validation**: `port.sender?.url` is the only trustworthy page indicator; require the port name + extension URL, disconnect otherwise (reject undefined sender).
- **Port races**: one run per port, per-run token checked before every `postMessage`, prior run aborted synchronously on new start (pattern from `provider-runner.ts`).
- **Dead `conversationUpdateToExtension`** (`src/events/config.ts:36`): out of scope, do not wire it.
- **Type-vs-runtime JSON**: never cast port `onMessage` values; always `parseOptionsTestCommand` first (`unknown` → narrowed).
