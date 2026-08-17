# Dianzhi SQLite Tools and Options Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tools into OPFS SQLite with stable preset IDs and soft removal, redesign the Tool and AI Provider Options pages as configuration-plus-live-test workspaces, and automatically translate the visible reasoning controls into provider-compatible request bodies.

**Architecture:** The offscreen document remains the only SQL owner and exposes typed named tool operations. The background service worker composes synchronized settings with SQLite tools, migrates legacy string IDs transactionally, resolves and caches hidden provider capabilities, and owns abortable Options test streams. React Options containers keep unsaved drafts local while focused panes render the approved master-detail-test layouts.

**Tech Stack:** React 19, TypeScript 5.8 strict mode, Vite 7, CRXJS, Chrome MV3, Vitest/jsdom, Playwright, `web-sqlite-js@2.3.0`, OPFS SQLite, native HTML drag and drop.

## Global Constraints

- Work only in `/home/wuchuheng/myProjects/com.wuchuheng.dianzhi/com.wuchuheng.dianzhi.extension` on `main`.
- Treat `docs/superpowers/specs/2026-08-17-dianzhi-sqlite-tools-options-testing-design.md` as the approved contract.
- Preserve the existing native Chrome Side Panel, content popover, per-tool conversation behavior, Shadow DOM boundary, typed event framework, and `web-sqlite-js@2.3.0` vendoring.
- The offscreen document is the only component allowed to execute SQL. Options, content, Side Panel, and background callers use named typed operations only.
- Tool IDs are positive safe integers. Preset IDs `1`, `2`, and `3` are reserved; custom tools use SQLite autoincrement IDs.
- Existing preset rows, including edited or soft-removed rows, are never overwritten by startup seeding.
- Synchronized settings version 2 contains no tools array. Do not remove legacy synchronized tools until the SQLite migration transaction commits.
- Do not expose provider dialect, `thinkingParam`, `enable_thinking`, `thinking_budget`, or raw compatibility choices in the UI.
- Options test requests use current unsaved drafts, stream reasoning and answer separately, are abortable, and never create conversation or message rows.
- Calibration is bounded and may retry only a validated `400` or `422` unsupported-reasoning-field response. Never retry authentication, permission, rate-limit, network, abort, or server failures.
- API keys, authorization headers, and provider response secrets must never enter logs or user-visible errors.
- Use red-green-refactor for every behavior change. Keep production modules focused and avoid growing `src/options/App.tsx` or `src/background/index.ts` into larger monoliths.
- Preserve unrelated untracked `.chrome-data/` and `.superpowers/` directories; never add them to commits.
- Before completion, run format, lint, typecheck, unit/integration tests, build, and real unpacked-Chrome verification at 375, 768, 1024, and 1440 pixels.

---

## File and interface map

- `src/dianzhi/tools/model.ts`: numeric tool records, drafts, preset validation, and request payloads.
- `src/dianzhi/tools/preset-tools.ts`: bundled product-owned preset array with reserved IDs.
- `src/dianzhi/domain/types.ts`: composed application settings and numeric tool/conversation identifiers.
- `src/dianzhi/domain/settings.ts`: version-2 synchronized settings, legacy parsing, composition, and default repair.
- `src/offscreen/database/schema.ts`: tool table release and string-to-integer conversation migration.
- `src/offscreen/database/store.ts`: named tool CRUD, preset seeding, reorder, soft removal, restoration, and legacy migration.
- `src/offscreen/database/rpc.ts`: exhaustive typed dispatch for tool operations.
- `src/background/settings-service.ts`: migration gate and synchronized-settings/SQLite composition.
- `src/dianzhi/provider/reasoning-profile.ts`: provider fingerprinting, known profiles, level mapping, request-body application, and unsupported-field classification.
- `src/background/provider-capabilities.ts`: local capability cache, legacy `thinkingParam` migration, invalidation, and bounded calibration.
- `src/background/options-test-runner.ts`: one abortable test run per Options port and streaming update envelopes.
- `src/options/test/use-options-test-stream.ts`: Options-port lifecycle and request-ID filtering.
- `src/options/tools/`: tool list, editor, live test, dirty-switch state, drag/keyboard reorder, and responsive workspace.
- `src/options/provider/`: provider setup, visible reasoning controls, live test, metrics, and responsive workspace.
- `src/options/App.tsx`: section routing and persistence orchestration only.

Core new types:

```ts
export type ReasoningLevel = 'low' | 'medium' | 'high'

export interface ToolRecord {
  id: number
  name: string
  prompt: string
  isPreset: boolean
  enabled: boolean
  sortOrder: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProviderSettings {
  apiBaseUrl: string
  apiKey: string
  model: string
  temperature: number
  reasoningEnabled: boolean
  reasoningLevel: ReasoningLevel
  extraBody: Record<string, unknown>
}
```

The Options streaming port is named `dianzhi:options-test` and uses request IDs:

```ts
type OptionsTestCommand =
  | { type: 'provider.test'; requestId: string; provider: ProviderSettings; message: string }
  | {
      type: 'tool.test'
      requestId: string
      provider: ProviderSettings
      tool: ToolDraft
      selected: string
      context: string
    }
  | { type: 'test.stop'; requestId: string }

type OptionsTestUpdate =
  | { type: 'test.started'; requestId: string; startedAt: number }
  | { type: 'test.reasoning'; requestId: string; delta: string }
  | { type: 'test.answer'; requestId: string; delta: string; firstTokenMs?: number }
  | { type: 'test.done'; requestId: string; totalMs: number; profileLabel: string }
  | { type: 'test.error'; requestId: string; error: DianzhiErrorShape }
  | { type: 'test.stopped'; requestId: string }
```

The named command surface is exhaustive: `tools.list`, `tools.create`, `tools.update`, `tools.reorder`, `tools.softRemove`, `tools.restore`, `tools.ensurePresets`, `tools.migrateLegacy`, `tools.test`, `provider.test`, `provider.calibrate`, and `provider.invalidateCapability`. No caller can provide SQL or an arbitrary operation name.

---

### Task 1: Define numeric tools, preset configuration, and version-2 settings

**Files:**

- Create: `src/dianzhi/tools/model.ts`
- Create: `src/dianzhi/tools/preset-tools.ts`
- Create: `tests/unit/tools/model.spec.ts`
- Modify: `src/dianzhi/domain/types.ts`
- Modify: `src/dianzhi/domain/presets.ts`
- Modify: `src/dianzhi/domain/settings.ts`
- Modify: `src/dianzhi/domain/errors.ts`
- Modify: `src/dianzhi/domain/protocol.ts`
- Modify: `tests/unit/domain/settings.spec.ts`
- Modify: `tests/unit/domain/protocol.spec.ts`
- Modify: all compile-time consumers of `ToolDefinition.id` and `defaultToolId`

**Interfaces:**

- `PRESET_TOOLS`, `validatePresetTools`, `parseToolId`, `toToolRecord`, `ToolRecord`, `ToolDraft`, `ToolCreateInput`, and `ToolUpdatePatch`.
- `SyncSettingsV2` owns provider, shortcuts, context, and numeric `defaultToolId`; `ComposedSettings` adds active `tools`.
- `parseLegacySyncSettings(raw)` preserves a version-1 tools array for the migration gate without returning it as current settings.
- Add stable errors `TOOL_NOT_FOUND`, `TOOL_LAST_ENABLED`, `TOOL_ORDER_INVALID`, `TOOL_PRESET_INVALID`, and `PROVIDER_COMPATIBILITY_UNRESOLVED`.

- [ ] **Step 1: Write failing numeric-domain and preset tests**

Cover unique positive safe preset IDs, non-empty names/prompts, exact reserved presets, numeric tool parsing, settings v2 serialization without tools, legacy v1 preservation, and numeric default repair.

```ts
expect(validatePresetTools(PRESET_TOOLS)).toEqual({ ok: true })
expect(
  validatePresetTools([
    { id: 1, name: 'A', prompt: 'x' },
    { id: 1, name: 'B', prompt: 'y' },
  ])
).toMatchObject({
  ok: false,
  error: { code: 'TOOL_PRESET_INVALID' },
})
expect(serializeSyncSettings(settings)).not.toHaveProperty('tools')
expect(repairDefaultToolId(99, [{ id: 3, enabled: true, sortOrder: 0 }])).toBe(3)
```

- [ ] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/tools/model.spec.ts tests/unit/domain/settings.spec.ts tests/unit/domain/protocol.spec.ts`

Expected: FAIL because numeric tool modules and version-2 parsers do not exist.

- [ ] **Step 3: Implement the product-owned preset file and numeric model**

Use a literal bundled file, not remote data or executable configuration:

```ts
export const PRESET_TOOLS = [
  { id: 1, name: '语境', prompt: BUILTIN_PROMPTS.context },
  { id: 2, name: '同义词', prompt: BUILTIN_PROMPTS.synonyms },
  { id: 3, name: '翻译', prompt: BUILTIN_PROMPTS.translate },
] as const
```

Remove `builtin`, `promptMode`, and `customPrompt` from the current runtime tool shape. A database prompt is the effective prompt for every tool.

- [ ] **Step 4: Carry numeric IDs through existing reducers and views**

Change conversation, tool-tab, content, Side Panel, popup, and Options helper types from string IDs to numbers. Keep behavior unchanged in this task; temporary test fixtures must use numeric IDs rather than compatibility casts.

- [ ] **Step 5: Run focused gates and commit**

Run: `pnpm vitest --run tests/unit/tools tests/unit/domain tests/unit/conversation tests/unit/ui tests/unit/content tests/unit/sidepanel tests/unit/options/settings-form.spec.ts && pnpm run typecheck && pnpm run lint`

```bash
git add src/dianzhi src/content src/sidepanel src/popup src/options/settings-form.ts tests/unit
git commit -m "refactor(domain): adopt numeric tool identities"
```

---

### Task 2: Add SQLite tool schema, lifecycle operations, and legacy data migration

**Files:**

- Modify: `src/offscreen/database/schema.ts`
- Modify: `src/offscreen/database/store.ts`
- Modify: `src/offscreen/database/rpc.ts`
- Modify: `src/offscreen/main.ts`
- Modify: `tests/unit/offscreen/store.spec.ts`
- Modify: `tests/unit/offscreen/rpc.spec.ts`
- Modify: `tests/integration/offscreen-recovery.spec.ts`

**Interfaces:**

- Add store methods `ensurePresetTools`, `listTools`, `createTool`, `updateTool`, `reorderTools`, `softRemoveTool`, `restoreTool`, and `migrateLegacyTools`.
- `migrateLegacyTools(input)` returns `{ idMap: Record<string, number>; tools: ToolRecord[] }` after one committed transaction.
- Startup calls `ensurePresetTools(PRESET_TOOLS)` after schema releases complete and before reporting database readiness.

- [ ] **Step 1: Write failing store and migration tests**

Cover per-ID preset insertion, idempotence, preservation of edited/removed presets, autoincrement custom IDs, exact active ordering, collision-free reorder, append-on-restore, last-enabled protection, timestamp updates, and migration of existing conversation tool references.

```ts
await store.ensurePresetTools(PRESET_TOOLS)
await store.updateTool(1, { prompt: 'user edit' })
await store.softRemoveTool(1)
await store.ensurePresetTools(PRESET_TOOLS)
expect(await store.listTools({ includeRemoved: true })).toContainEqual(
  expect.objectContaining({ id: 1, prompt: 'user edit', deletedAt: expect.any(String) })
)
```

Add interruption coverage: rerunning `migrateLegacyTools` after the SQLite transaction committed must return the same mapping and create no duplicates.

- [ ] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/offscreen/store.spec.ts tests/unit/offscreen/rpc.spec.ts tests/integration/offscreen-recovery.spec.ts`

Expected: FAIL on missing schema release and named operations.

- [ ] **Step 3: Add the schema release**

Create `tools` with the approved columns and partial active-order index. For legacy databases, rebuild `conversations` so `tool_id` has integer affinity while retaining `tool_name`, `prompt_snapshot`, timestamps, state, and every foreign-key relationship. Run `PRAGMA foreign_key_check` before committing the release.

- [ ] **Step 4: Implement transactional named operations**

Use one transaction for every multi-row operation. Reorder in two passes so the unique partial index cannot collide:

```ts
await transaction(async (tx) => {
  for (const [index, id] of orderedIds.entries()) {
    await tx.run('UPDATE tools SET sort_order = ? WHERE id = ?', [-(index + 1), id])
  }
  for (const [index, id] of orderedIds.entries()) {
    await tx.run('UPDATE tools SET sort_order = ?, updated_at = ? WHERE id = ?', [index, now, id])
  }
})
```

Validate that reorder input exactly equals the active ID set. Restore to `max(sort_order) + 1`. Reject disabling or removing the last active enabled tool.

- [ ] **Step 5: Extend exhaustive RPC dispatch**

Accept only the named tool operations from the protocol parser. Reject unknown operation names, string IDs, duplicate reorder IDs, and malformed patches before calling the store.

- [ ] **Step 6: Run focused gates and commit**

Run: `pnpm vitest --run tests/unit/offscreen tests/integration/offscreen-recovery.spec.ts && pnpm run typecheck && pnpm run lint`

```bash
git add src/offscreen tests/unit/offscreen tests/integration/offscreen-recovery.spec.ts
git commit -m "feat(database): persist and migrate SQLite tools"
```

---

### Task 3: Gate startup migration and compose settings through background

**Files:**

- Create: `src/background/settings-service.ts`
- Create: `tests/unit/background/settings-service.spec.ts`
- Modify: `src/background/offscreen-client.ts`
- Modify: `src/background/index.ts`
- Modify: `src/events/config.ts`
- Modify: `src/options/settings-form.ts`
- Modify: `tests/unit/background/offscreen-client.spec.ts`
- Modify: `tests/unit/options/settings-form.spec.ts`
- Modify: `tests/integration/conversation-flow.spec.ts`

**Interfaces:**

- `SettingsService.ready()` runs exactly one shared migration promise per service-worker lifetime.
- `SettingsService.getComposedSettings()` returns sync v2 plus active SQLite tools in database order and repairs/persists an invalid default ID.
- `SettingsService.saveSyncSettings(input)` saves only synchronized fields.
- Background exposes validated tool commands to extension pages; content and Side Panel receive composed read-only settings.
- The event layer names the handlers `tools.list`, `tools.create`, `tools.update`, `tools.reorder`, `tools.softRemove`, `tools.restore`, `tools.ensurePresets`, and `tools.migrateLegacy`; `tools.test` is carried by the Options test port defined in Task 5.

- [ ] **Step 1: Write failing migration-gate and composition tests**

Verify SQLite migration happens before any settings response, sync tools are removed only after offscreen commit, a failed offscreen migration leaves v1 sync data intact, concurrent callers share one migration, defaults repair deterministically, and removed tools never appear in composed settings.

```ts
await expect(service.getComposedSettings()).resolves.toMatchObject({
  version: 2,
  defaultToolId: 2,
  tools: [{ id: 2 }, { id: 3 }],
})
expect(syncStorage.set).toHaveBeenCalledWith(
  expect.not.objectContaining({ tools: expect.anything() })
)
```

- [ ] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/background/settings-service.spec.ts tests/unit/background/offscreen-client.spec.ts tests/integration/conversation-flow.spec.ts`

- [ ] **Step 3: Implement the idempotent startup gate**

Parse raw synchronized state without first merging it into v2 defaults. If it is v1, send the preserved tools/default through `tools.migrateLegacy`, translate default ID from the returned map, then write v2. Seed the hidden compatibility cache when legacy `thinkingParam === 'enable_thinking'`; removal of the visible property occurs only in the final v2 write.

- [ ] **Step 4: Broker tool commands and compose consumers**

Add sender-validated extension-page handlers for list/create/update/reorder/remove/restore. After a mutation, return the canonical ordered tool list and repaired default ID so Options updates from the database result rather than optimistic guessed IDs.

Update new-conversation creation to resolve the selected numeric tool from composed settings and persist its current name/prompt snapshots.

- [ ] **Step 5: Run focused and regression gates, then commit**

Run: `pnpm vitest --run tests/unit/background tests/unit/options/settings-form.spec.ts tests/integration/conversation-flow.spec.ts && pnpm run typecheck && pnpm run lint`

```bash
git add src/background src/events/config.ts src/options/settings-form.ts tests/unit/background tests/unit/options tests/integration/conversation-flow.spec.ts
git commit -m "feat(settings): compose synchronized settings with SQLite tools"
```

---

### Task 4: Resolve and cache hidden provider reasoning compatibility

**Files:**

- Create: `src/dianzhi/provider/reasoning-profile.ts`
- Create: `src/background/provider-capabilities.ts`
- Create: `tests/unit/provider/reasoning-profile.spec.ts`
- Create: `tests/unit/background/provider-capabilities.spec.ts`
- Modify: `src/dianzhi/provider/request.ts`
- Modify: `src/dianzhi/provider/client.ts`
- Modify: `src/background/provider-runner.ts`
- Modify: `tests/unit/provider/request.spec.ts`
- Modify: `tests/unit/provider/client.spec.ts`
- Modify: `tests/unit/background/provider-runner.spec.ts`

**Interfaces:**

```ts
type ReasoningProfile =
  | { kind: 'openai'; offMode: 'omit' | 'none'; supportedEfforts: readonly string[] }
  | { kind: 'aliyun'; effortField: 'reasoning_effort' | 'thinking_budget' | null }
  | { kind: 'deepseek'; supportedEfforts: readonly string[] }

interface CachedCapability {
  fingerprint: string
  profile: ReasoningProfile
  acceptedAt: string
  source: 'known' | 'calibrated' | 'legacy'
}
```

- `fingerprintProvider(baseUrl, model)` normalizes URL/model before hashing or key construction.
- `resolveKnownProfile(baseUrl, model)` recognizes authoritative OpenAI, Alibaba/DashScope/Qwen, and DeepSeek combinations.
- `applyReasoningProfile(body, intent, profile)` returns one request body without mutually exclusive reasoning mechanisms.
- `ProviderCapabilityService.resolve(provider, signal)` checks cache, known profiles, then bounded calibration.
- Background routes `provider.calibrate` and `provider.invalidateCapability` through this service; `provider.test` is carried by the Options test port defined in Task 5.

- [ ] **Step 1: Write the provider request matrix first**

Cover reasoning on/off and low/medium/high for each profile, unknown gateway candidates, `extraBody` final override, normalized fingerprints, cache hits, URL/model invalidation, failed calibration, old `enable_thinking` migration, and safe error classification.

Representative assertions:

```ts
expect(applyReasoningProfile(base, { enabled: false, level: 'medium' }, aliyun)).toMatchObject({
  enable_thinking: false,
})
expect(applyReasoningProfile(base, { enabled: true, level: 'high' }, deepseek)).toMatchObject({
  thinking: { type: 'enabled' },
})
expect(request).not.toHaveProperty('reasoning_effort')
```

- [ ] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/provider tests/unit/background/provider-capabilities.spec.ts tests/unit/background/provider-runner.spec.ts`

- [ ] **Step 3: Implement pure known-profile mapping**

Base it on current official contracts:

- OpenAI reasoning effort: `https://developers.openai.com/api/docs/models/gpt-5.5`
- Alibaba OpenAI-compatible Qwen: `https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions`
- DeepSeek thinking mode: `https://api-docs.deepseek.com/guides/thinking_mode`

Keep host/model matchers conservative. Unknown hosts must not be guessed from model name alone unless the profile explicitly permits that combination.

- [ ] **Step 4: Implement capability storage and bounded calibration**

Store capability entries under one namespaced `chrome.storage.local` object. Try a deterministic candidate list using a minimal non-persistent request. Advance only when `isUnsupportedReasoningField(error, candidateFields)` validates a `400` or `422` response. Cache accepted profiles; do not cache failure.

- [ ] **Step 5: Route production provider runs through one resolved profile**

Resolve before generation starts, build once, and never switch dialect after receiving stream data. Keep the existing stream parser and abort behavior. Redact request headers, API keys, and nested provider secrets in every error path.

- [ ] **Step 6: Run focused gates and commit**

Run: `pnpm vitest --run tests/unit/provider tests/unit/background/provider-capabilities.spec.ts tests/unit/background/provider-runner.spec.ts && pnpm run typecheck && pnpm run lint`

```bash
git add src/dianzhi/provider src/background/provider-capabilities.ts src/background/provider-runner.ts tests/unit/provider tests/unit/background
git commit -m "feat(provider): resolve reasoning compatibility automatically"
```

---

### Task 5: Add abortable, non-persistent Options test streaming

**Files:**

- Create: `src/background/options-test-runner.ts`
- Create: `src/options/test/use-options-test-stream.ts`
- Create: `src/options/test/test-state.ts`
- Create: `tests/unit/background/options-test-runner.spec.ts`
- Create: `tests/unit/options/test-state.spec.ts`
- Modify: `src/dianzhi/domain/protocol.ts`
- Modify: `src/background/index.ts`
- Modify: `tests/unit/domain/protocol.spec.ts`
- Modify: `tests/integration/conversation-flow.spec.ts`

**Interfaces:**

- Background accepts only `dianzhi:options-test` ports whose sender URL belongs to this extension.
- One `AbortController` is owned per connected port. Starting a new test aborts the previous run; stop and disconnect also abort.
- Provider test uses the unsaved provider draft and an editable message.
- Tool test fills the unsaved tool prompt with selected/context inputs, then uses the saved provider settings.
- Both paths emit the shared `OptionsTestUpdate` state machine and never call conversation persistence methods.

- [ ] **Step 1: Write failing protocol, state-machine, and runner tests**

Cover malformed commands, stale request-ID updates, provider draft pass-through, single-pass tool substitution, reasoning/answer separation, first-token timing, total timing, abort replacement, disconnect cleanup, safe errors, and zero conversation/message writes.

```ts
runner.handle(port, providerTest)
runner.handle(port, nextProviderTest)
expect(firstSignal.aborted).toBe(true)
expect(conversationStore.createConversation).not.toHaveBeenCalled()
expect(conversationStore.appendMessage).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/domain/protocol.spec.ts tests/unit/background/options-test-runner.spec.ts tests/unit/options/test-state.spec.ts tests/integration/conversation-flow.spec.ts`

- [ ] **Step 3: Implement the background runner and port boundary**

Reuse the provider client and capability resolver, but not `ConversationManager`. Measure from request start; set `firstTokenMs` on the first reasoning or answer delta and `totalMs` at terminal completion. Convert errors through `DianzhiError.toJSON()`.

- [ ] **Step 4: Implement the React hook and reducer**

The hook opens the port lazily, creates request IDs with `crypto.randomUUID()`, filters late updates, and exposes:

```ts
{
  state,
  runProviderTest,
  runToolTest,
  stop,
  reset,
}
```

Close the port on unmount. A stopped request retains already streamed output and transitions to `stopped`.

- [ ] **Step 5: Run focused gates and commit**

Run: `pnpm vitest --run tests/unit/domain/protocol.spec.ts tests/unit/background/options-test-runner.spec.ts tests/unit/options/test-state.spec.ts tests/integration/conversation-flow.spec.ts && pnpm run typecheck && pnpm run lint`

```bash
git add src/background src/options/test src/dianzhi/domain/protocol.ts tests/unit tests/integration/conversation-flow.spec.ts
git commit -m "feat(options): stream non-persistent provider tests"
```

---

### Task 6: Build the three-pane Tool Options workspace

**Files:**

- Create: `src/options/tools/ToolWorkspace.tsx`
- Create: `src/options/tools/ToolList.tsx`
- Create: `src/options/tools/ToolEditor.tsx`
- Create: `src/options/tools/ToolTestPanel.tsx`
- Create: `src/options/tools/tool-workspace-state.ts`
- Create: `src/options/tools/tool-workspace.css`
- Create: `tests/unit/options/tool-workspace-state.spec.ts`
- Create: `tests/unit/options/tool-workspace.spec.tsx`
- Modify: `src/options/App.tsx`
- Modify: `src/options/App.css`
- Modify: `src/options/settings-form.ts`
- Modify: `tests/unit/options/app.spec.tsx`
- Modify: `tests/unit/options/settings-form.spec.ts`

**UI contract:**

- Desktop: fixed-width draggable list, flexible configuration pane, flexible live-test pane.
- Medium: list above a keyboard-accessible Configuration/Test tabset.
- Mobile: stacked regions without horizontal scrolling.
- Selection uses border, icon/state, and `aria-current`, not color alone.

- [ ] **Step 1: Write failing reducer and component interaction tests**

Cover initial selection, local add draft, insert only on save, field edits, Save/Discard/Stay dirty switching, native drag reorder, keyboard Move up/down, default selection, enable/disable, soft-remove confirmation, removed-list restore, scoped announcements, and running the current unsaved prompt.

```tsx
await user.click(screen.getByRole('button', { name: '翻译' }))
expect(screen.getByRole('button', { name: '翻译' })).toHaveAttribute('aria-current', 'true')
await user.type(screen.getByLabelText('提示词'), ' unsaved')
await user.click(screen.getByRole('button', { name: '同义词' }))
expect(screen.getByRole('dialog', { name: '未保存的工具修改' })).toBeVisible()
```

- [ ] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/options/tool-workspace-state.spec.ts tests/unit/options/tool-workspace.spec.tsx tests/unit/options/app.spec.tsx`

- [ ] **Step 3: Implement pure workspace state**

Keep persisted records, selected ID, draft, dirty comparison, pending selection, and new-draft sentinel explicit. The reducer must not invent database IDs. Mutation success actions replace records with the canonical background response.

- [ ] **Step 4: Implement list and editor panes**

Use native drag events with a visible insertion indicator. Persist the complete active ordered ID list on drop. Provide row action menus with Move up/down for keyboard users. Removed tools live in a compact disclosure below the active list.

Use a modal `role="dialog"` for dirty switching with Save and switch, Discard, and Stay. Restore focus to the initiating tool row after dismissal.

- [ ] **Step 5: Implement the live-test pane**

Show selected/context inputs, single-pass filled-prompt preview, Run/Stop, separate collapsible reasoning and answer regions, and idle/validating/streaming/completed/stopped/error feedback. Starting a new run delegates abort behavior to the shared hook.

- [ ] **Step 6: Implement responsive and accessible styling**

Use existing warm Dianzhi tokens. Avoid layout-moving hover styles. Add visible focus rings, pointer cursors, reduced-motion handling, and independent `aria-live` regions for tool save/order status and tool test status.

- [ ] **Step 7: Run focused gates and commit**

Run: `pnpm vitest --run tests/unit/options && pnpm run typecheck && pnpm run lint && pnpm run build`

```bash
git add src/options tests/unit/options
git commit -m "feat(options): add SQLite tool workspace and live test"
```

---

### Task 7: Build the split Provider Options workspace

**Files:**

- Create: `src/options/provider/ProviderWorkspace.tsx`
- Create: `src/options/provider/ProviderSetup.tsx`
- Create: `src/options/provider/ProviderTestPanel.tsx`
- Create: `src/options/provider/provider-workspace.css`
- Create: `tests/unit/options/provider-workspace.spec.tsx`
- Modify: `src/options/App.tsx`
- Modify: `src/options/App.css`
- Modify: `tests/unit/options/app.spec.tsx`

**UI contract:**

- Left setup pane: API address, API key show/hide, model, temperature, visible Reasoning switch, visible Low/Medium/High level, and collapsed `extraBody` only.
- Right test pane: editable message, Run/Stop, reasoning, answer, first-token latency, total duration, status, and field-local recovery guidance.
- The unsaved indicator and provider-save live region are independent from the test status/live region.

- [ ] **Step 1: Write failing provider workspace tests**

Verify all visible fields, absence of dialect controls, reasoning-level enablement, API-key reveal behavior, unsaved marker, current-unsaved-draft test payload, independent save/test statuses, streaming regions, metrics, stop behavior, and field highlighting for URL/key/model/JSON errors.

```tsx
expect(screen.queryByLabelText(/thinkingParam|enable_thinking|dialect/i)).not.toBeInTheDocument()
await user.clear(screen.getByLabelText('模型'))
await user.type(screen.getByLabelText('模型'), 'qwen-plus')
await user.click(screen.getByRole('button', { name: '运行测试' }))
expect(sendTest).toHaveBeenCalledWith(
  expect.objectContaining({ provider: expect.objectContaining({ model: 'qwen-plus' }) })
)
```

- [ ] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/options/provider-workspace.spec.tsx tests/unit/options/app.spec.tsx`

- [ ] **Step 3: Implement controlled setup and draft semantics**

Provider draft state remains in the section container across Options navigation. Save validates and persists v2 synchronized fields. Changing base URL/model triggers capability invalidation after a successful save; tests use the unsaved fingerprint without overwriting the saved cache entry for a different fingerprint.

- [ ] **Step 4: Implement the test pane and recovery states**

Default the test message to a useful short prompt. Map stable errors to exact fields and actions without echoing secrets. Show `Compatible request accepted` for calibrated unknown gateways and a specific known-profile label for authoritative matches.

- [ ] **Step 5: Implement responsive styling**

Use two equal columns on desktop and stack on narrow screens. Keep primary actions visible without a horizontal scroll. Ensure Reasoning level is visually associated with and disabled by the Reasoning switch when off.

- [ ] **Step 6: Run focused gates and commit**

Run: `pnpm vitest --run tests/unit/options && pnpm run typecheck && pnpm run lint && pnpm run build`

```bash
git add src/options tests/unit/options
git commit -m "feat(options): add provider setup and compatibility test"
```

---

### Task 8: Reconcile all contexts, document the contracts, and verify in Chrome

**Files:**

- Modify: `src/content/views/App.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/popup/App.tsx`
- Modify: `src/background/conversation-manager.ts`
- Modify: `tests/integration/conversation-flow.spec.ts`
- Modify: `tests/e2e/dianzhi.spec.ts`
- Modify: `tests/e2e/support/mock-provider.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-17-dianzhi-sqlite-tools-options-testing.md`

- [ ] **Step 1: Add failing cross-context integration coverage**

Prove database order and numeric IDs appear identically in Options, content, and Side Panel; removed/disabled/default tools reconcile; preset edits survive reload; conversation snapshots remain readable after tool removal; and changing a tool never rewrites historical prompt/name snapshots.

- [ ] **Step 2: Extend the mock provider contract matrix**

Have the E2E mock validate OpenAI, Alibaba/Qwen, DeepSeek, and generic-calibration request shapes. Record requests without authorization headers. Provide deterministic SSE reasoning/answer chunks and explicit unsupported-field `400` responses.

- [ ] **Step 3: Update unpacked-Chrome journeys**

Cover:

1. First startup seeds IDs `1`, `2`, and `3`.
2. Editing then reloading a preset preserves the edit.
3. Soft-removing then reloading a preset does not recreate it.
4. Creating a custom tool yields a numeric ID and survives reload.
5. Drag and keyboard reorder match in popover and Side Panel.
6. Tool draft test streams and leaves conversation row count unchanged.
7. Provider draft test uses unsaved settings and automatic reasoning mapping.
8. Unknown-gateway calibration caches, reuses, and invalidates on URL/model change.
9. Existing conversation handoff and continued Side Panel chat still work.

- [ ] **Step 4: Update operator and architecture documentation**

Document settings ownership, schema release/migration safety, preset-ID reservation, soft-removal semantics, automatic reasoning resolution, local capability cache, test non-persistence, and recovery messages. Remove documentation of visible `thinkingParam` or storage-owned tools.

- [ ] **Step 5: Run the full automated gate**

Run:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run test:e2e
git diff --check
```

Expected: every command exits `0`; no direct `console.*` appears in new production code; build output contains the offscreen SQLite assets and Side Panel entry.

- [ ] **Step 6: Verify the unpacked extension in real Chrome**

Load a clean temporary profile and inspect UI, console, network, and storage/OPFS behavior. Exercise keyboard flow and 375/768/1024/1440 widths. Confirm no secrets in logs, no Options test rows in SQLite, no duplicate presets after service-worker restart, and no interruption of an active content-to-Side-Panel stream.

- [ ] **Step 7: Request final code review and close findings**

Use `superpowers:requesting-code-review`. Fix every Critical or Important finding with a failing regression test first, rerun affected gates, then rerun the complete verification sequence.

- [ ] **Step 8: Update this plan and commit the verified slice**

Mark completed checkboxes and record material deviations beneath their task. Commit only intended source, tests, docs, and lockfile changes:

```bash
git add README.md docs/superpowers src tests package.json pnpm-lock.yaml
git commit -m "feat(options): ship SQLite tools and adaptive reasoning"
```

Do not add `.chrome-data/` or `.superpowers/`.

---

## Final acceptance checklist

- [ ] Each bundled preset ID is checked independently on startup.
- [ ] Existing, edited, or removed preset rows are never overwritten.
- [ ] Tools, conversation references, active IDs, and defaults are numeric end to end.
- [ ] Legacy migration is transactional and safely repeatable after service-worker interruption.
- [ ] Tool removal is soft; historical conversations remain intact.
- [ ] Tool order is transactional and consistent across Options, popover, and Side Panel.
- [ ] The Tool page matches the approved master-detail-test layout and dirty-switch flow.
- [ ] The Provider page matches the approved setup-test layout and exposes Reasoning plus Low/Medium/High.
- [ ] No provider dialect or raw reasoning-format control is visible.
- [ ] Known providers receive one correct request shape; unknown gateways calibrate within the approved retry boundary.
- [ ] Capability cache is local, fingerprinted, migrated, and invalidated correctly.
- [ ] Provider and tool tests use unsaved drafts, stream independently, abort correctly, and write no conversation data.
- [ ] All automated gates and real-Chrome checks pass without console/network errors or secret leakage.
