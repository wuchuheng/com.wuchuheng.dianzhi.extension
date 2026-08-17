# Dianzhi SQLite Tools and Options Testing Design

**Date:** 2026-08-17  
**Status:** Approved
**Base:** Dianzhi extension at commit `379a0f1`

## 1. Goal

Move tool ownership from `chrome.storage.sync` into the OPFS SQLite database, seed product presets by stable numeric ID, support soft removal and restoration, and redesign Options as focused configuration-and-test workspaces.

The provider UI exposes reasoning intent, not provider wire-format details. A hidden compatibility resolver translates that intent into OpenAI, Alibaba Cloud/DashScope/Qwen, DeepSeek, or calibrated generic-gateway request fields.

## 2. Product decisions

### 2.1 Tool identity and preset initialization

- Every tool has a positive integer ID.
- Preset tools use fixed reserved IDs. Initial assignments are:
  - `1`: 语境
  - `2`: 同义词
  - `3`: 翻译
- Custom tools use SQLite `INTEGER PRIMARY KEY AUTOINCREMENT` IDs.
- A bundled TypeScript preset file is the product-owned seed source:

```ts
export const PRESET_TOOLS = [
  { id: 1, name: '语境', prompt: BUILTIN_PROMPTS.context },
  { id: 2, name: '同义词', prompt: BUILTIN_PROMPTS.synonyms },
  { id: 3, name: '翻译', prompt: BUILTIN_PROMPTS.translate },
] as const
```

- Offscreen initialization validates every preset and checks each ID independently.
- A missing ID is inserted. An existing ID is left unchanged, including user-edited and soft-removed records.
- Reordering or changing the bundled preset array never overwrites an existing database row.
- Preset IDs must be unique positive safe integers; names and prompts must be non-empty. Invalid bundled data blocks database readiness with a stable error.

### 2.2 Tool lifecycle

- Preset and custom tools may be renamed, edited, enabled, disabled, reordered, soft-removed, and restored.
- Soft removal sets `deleted_at`; it never deletes the row or existing conversations.
- Normal tool queries exclude removed records.
- The Options page includes a compact Removed tools section with restore actions.
- Restoring a tool clears `deleted_at` and appends it after the last active `sort_order`, avoiding order collisions.
- At least one non-removed enabled tool must remain.
- `defaultToolId` becomes numeric. If it points to a missing, removed, or disabled tool, it is repaired to the first enabled tool by `sort_order`.

### 2.3 Settings ownership

- SQLite owns tools, their prompts, enabled state, order, removal state, and timestamps.
- `chrome.storage.sync` continues to own provider settings, shortcuts, context limits, and the numeric default tool ID.
- `chrome.storage.local` owns hidden provider-capability cache entries because they are machine/runtime-specific implementation state.
- Background settings reads compose synchronized settings with the active SQLite tool list before returning data to content, Side Panel, and Options.
- Synchronized settings advance to version 2 and no longer persist a `tools` array after legacy migration succeeds.

## 3. SQLite design

Add a new schema release and migrate existing data without deleting OPFS history.

```sql
CREATE TABLE tools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  is_preset   INTEGER NOT NULL DEFAULT 0 CHECK(is_preset IN (0, 1)),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  sort_order  INTEGER NOT NULL,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_tools_active_order
  ON tools(sort_order)
  WHERE deleted_at IS NULL;
```

The migration maps historical string tool IDs as follows:

| Existing ID | Numeric ID |
| ----------- | ---------: |
| `context`   |          1 |
| `synonyms`  |          2 |
| `translate` |          3 |

Background coordinates the one-time version-1 migration before serving composed settings:

1. Read the legacy synchronized `tools` array and default tool ID.
2. Send it through the typed `tools.migrateLegacy` operation.
3. In one SQLite transaction, reserve/seed preset IDs first, allocate numeric IDs for custom tools in legacy order, create rows for any conversation-only legacy tool, rebuild `conversations.tool_id` as an integer column, and update every reference through the generated mapping.
4. Return the numeric mapping to background.
5. Translate the legacy default ID, save settings version 2 without the tools array, and mark migration complete.
6. Only then expose composed settings to content, Side Panel, or Options.

The operation is idempotent so service-worker interruption can safely repeat it. Synchronized settings are not stripped until the SQLite transaction commits. `tool_name` and `prompt_snapshot` remain immutable conversation snapshots, so later tool edits do not rewrite history.

The store exposes only named methods:

- `ensurePresetTools(presets)`
- `listTools({ includeRemoved })`
- `createTool(input)`
- `updateTool(id, patch)`
- `reorderTools(orderedIds)`
- `softRemoveTool(id)`
- `restoreTool(id)`

`reorderTools` validates that the ordered ID set exactly matches all active tools, then updates every `sort_order` in one transaction. Temporary collision-free order values are used before final positions are assigned.

## 4. Typed event and domain changes

`ToolDefinition.id`, `ConversationRecord.toolId`, `ConversationSnapshot.activeToolId`, and `UiSettings.defaultToolId` become numbers.

Add typed background/offscreen operations:

- `tools.list`
- `tools.create`
- `tools.update`
- `tools.reorder`
- `tools.softRemove`
- `tools.restore`
- `tools.ensurePresets`
- `tools.migrateLegacy`
- `tools.test`
- `provider.test`
- `provider.calibrate`
- `provider.invalidateCapability`

The Options page never sends SQL. Background validates the extension-page sender, validates every payload, brokers database calls, and owns provider requests. Content scripts remain read-only settings consumers.

Required new stable error codes are:

- `TOOL_NOT_FOUND`
- `TOOL_LAST_ENABLED`
- `TOOL_ORDER_INVALID`
- `TOOL_PRESET_INVALID`
- `PROVIDER_COMPATIBILITY_UNRESOLVED`

Errors include a safe operation and field where applicable. API keys, authorization headers, and secrets extracted from provider responses are always redacted.

## 5. Tool Options workspace

The 查询工具 page uses the approved three-pane master-detail-test layout.

### 5.1 Tool list

- Fixed-width left pane ordered by `sort_order`.
- Each row contains a drag handle, tool name, preset/custom label, and enabled state.
- The selected row uses color, border, and `aria-current`; color is not the only indicator.
- Clicking selects without reordering.
- Pointer drag-and-drop persists the complete ordered numeric ID list.
- Keyboard users receive Move up and Move down menu actions.
- Add tool creates a local unsaved draft and selects it.
- Removed tools opens a compact restorable list rather than a separate archive page.

### 5.2 Configuration pane

- Fields: name, enabled state, editable prompt, and default-tool status.
- Preset prompts become ordinary editable database values after initial seeding. There is no preset/custom prompt mode.
- Existing-tool changes remain a local draft until Save tool.
- A new custom draft is inserted only when Save tool succeeds.
- Switching away from a dirty draft offers Save and switch, Discard, or Stay.
- Removing a tool uses a concise confirmation that explains it will disappear from popover and Side Panel tabs while existing conversation snapshots remain intact.
- Save, removal, restoration, and reorder status are announced through scoped live regions.

### 5.3 Live-test pane

- Inputs: Selected text and Surrounding context.
- The filled-prompt preview updates from the current unsaved draft using single-pass `{{selected}}` and `{{context}}` substitution.
- Run current draft uses saved provider settings and does not persist a conversation or message.
- Reasoning and final answer stream into separate regions.
- Starting another test aborts the previous test.
- States are idle, validating, streaming, completed, stopped, and error.

### 5.4 Responsive behavior

- Desktop: tool list, configuration, and live test remain visible together.
- Medium widths: tool list appears above a Configuration/Test detail tabset.
- Mobile widths: all regions stack without horizontal scrolling.
- Verify 375, 768, 1024, and 1440 pixel widths.

## 6. Provider Options workspace

The AI 服务 page uses two equal columns.

### 6.1 Setup pane

- API address
- API key with explicit show/hide action
- Model
- Temperature
- Visible Reasoning switch
- Visible Reasoning level: Low, Medium, High
- Collapsed Advanced request fields containing only `extraBody`
- Unsaved indicator when the draft differs from persisted settings

Provider type, request dialect, `thinkingParam`, `enable_thinking`, `thinking_budget`, and raw compatibility decisions are not user-facing controls.

### 6.2 Test pane

- Editable test message with a useful default.
- Run test uses the current unsaved setup draft; Save is not required first.
- Test requests never create SQLite conversations or messages.
- The pane streams reasoning and final answer separately.
- It reports first-token latency, total duration, running/completed state, and safe provider errors.
- Field-specific failures highlight the responsible setup field and provide a recovery action.
- Provider test status and global Save status are separate live regions.

## 7. Hidden reasoning compatibility

The original extension's proven request branch is retained as a compatibility primitive:

- OpenAI-style: reasoning ON sends `reasoning_effort`; OFF omits the field unless a known model supports an explicit no-reasoning effort.
- Alibaba-style: sends top-level `enable_thinking` true or false and adds only model-supported effort or budget fields.
- DeepSeek-style: sends the supported `thinking` object and maps effort to the provider's accepted values.

### 7.1 Resolution order

1. Normalize API base URL and model.
2. Compute a fingerprint from both values.
3. Use a valid cached capability profile when present.
4. Otherwise use an authoritative built-in profile matched by hostname and model family.
5. Otherwise run bounded generic-gateway calibration during Run test or automatically before the first real conversation.
6. Cache only an accepted profile in `chrome.storage.local`.
7. Changing base URL or model invalidates the applicable cache entry.

Known profiles are authoritative. Calibration may prove that a custom gateway accepts a request syntax, but cannot prove that a gateway did not silently ignore an unknown field. Unknown gateways therefore report Compatible request accepted rather than semantically verified.

### 7.2 Calibration safety

- Calibration uses a minimal non-persistent request.
- Candidate formats are bounded and deterministic.
- Try another candidate only after a `400` or `422` response whose validated provider error identifies one of the candidate reasoning fields as unsupported; unrelated request-validation failures do not trigger another candidate.
- Stop immediately on authentication, permission, rate-limit, network, abort, and server failures.
- Production conversation generation uses one resolved profile and never cycles through dialects after generation begins.
- Failed calibration is not cached.
- Existing settings with `thinkingParam: 'enable_thinking'` seed the equivalent hidden capability profile during migration; the visible property is then removed.

### 7.3 Level mapping

The UI expresses user intent as Low, Medium, or High. Each known profile maps that intent to the closest supported value. Unsupported fine-grained levels degrade deterministically; request bodies never send two mutually exclusive effort/budget mechanisms together.

`extraBody` remains the final advanced escape hatch and merges last. It may override generated fields intentionally, but normal compatibility requires no raw JSON.

## 8. State and interaction boundaries

- Separate React containers own provider drafts/tests and tool drafts/tests.
- Presentational panes receive controlled values and callbacks.
- Selecting or dragging a tool does not reset test input/output unless the selected tool changes.
- Tool tests and provider tests have independent abort controllers.
- Navigation away from a dirty tool configuration is guarded; provider section navigation retains its draft until page unload or explicit discard/save.
- Hover effects never shift layout, all clickable rows use pointer cursors, focus rings are visible, and motion respects `prefers-reduced-motion`.
- Normal text meets at least WCAG 4.5:1 contrast.

## 9. Verification

### 9.1 Unit and store tests

- Preset validation and idempotent per-ID insertion.
- Existing edited and soft-removed presets are not overwritten or recreated.
- Custom IDs are numeric and autoincremented.
- String-to-numeric tool/conversation migration preserves history.
- Soft remove, restore, last-enabled protection, default repair, and exact transactional reorder.
- Typed RPC rejects arbitrary operations and malformed IDs/order sets.
- Tool draft substitution is single-pass and test execution writes no conversation data.
- OpenAI, Alibaba/Qwen, DeepSeek, and generic request-body matrices for reasoning on/off and every visible effort.
- Capability-cache hit, invalidation, migration, failed-calibration behavior, and secret redaction.
- Calibration retries only supported-parameter validation failures.

### 9.2 Component and integration tests

- Three-pane selection, dirty-switch guard, create/save/remove/restore, pointer reorder, and keyboard reorder.
- Scoped save/test live regions and field-local errors.
- Provider test uses unsaved values and keeps test status separate from Save status.
- Tool list composition reaches content and Side Panel in database order.
- Removed/disabled/default tools reconcile consistently across contexts.

### 9.3 Unpacked-Chrome verification

- First startup seeds all preset IDs.
- Reload does not overwrite edits or restore soft-removed presets.
- Custom tool creation returns a numeric ID and survives reload.
- Drag order appears identically in Options, popover, and Side Panel.
- Tool draft testing streams without creating conversation rows.
- Provider draft testing exercises reasoning on/off and visible effort against representative OpenAI, Alibaba/Qwen, and DeepSeek mock contracts.
- Unknown-gateway calibration is cached and invalidated by URL/model changes.
- Responsive widths, keyboard flow, live-region feedback, and console/network errors are checked.

## 10. Non-goals

- No user-visible provider/dialect selector.
- No arbitrary SQL events.
- No remote preset download or executable configuration.
- No automatic overwrite of an existing preset row.
- No hard deletion of tools or historical conversations.
- No cloud synchronization of the OPFS tools table.
- No provider test message stored as conversation history.
