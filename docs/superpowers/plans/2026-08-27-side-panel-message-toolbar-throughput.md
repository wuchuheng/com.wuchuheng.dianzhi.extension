# Side Panel Message Toolbar + Final Throughput Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Side Panel stream text paint immediately while scroll alone follows smoothly, and move pending/status/copy/final-throughput/retry feedback into a permanent toolbar beneath each message.

**Architecture:** Persist a nullable final estimated throughput on each assistant message, calculated by the provider runner from first output to terminal state. Keep the shared message renderer adapter-agnostic and let the Side Panel supply only its retry callback. Remove the height-clipping stream wrapper; reuse its continuous acceleration/deceleration math as a generic scroll-position controller observed from natural content growth.

**Tech Stack:** React 19, TypeScript 5.8, Vitest 4 + jsdom/node:sqlite, Chrome Extension Side Panel APIs, web-sqlite-js release migrations, requestAnimationFrame, ResizeObserver.

**Spec:** `docs/superpowers/specs/2026-08-27-dianzhi-side-panel-message-toolbar-throughput-design.md`

## Global Constraints

- Side Panel stream text must paint at natural height in the same React commit; no height wrapper, clipping, debounce, or 300–500ms visibility delay.
- The Side Panel auto-follows only when the last user-controlled pre-growth distance from the bottom is strictly `< 150px`; exactly `150px` is outside the guard.
- The continuous acceleration/deceleration curve may animate `scrollTop` only, never message visibility.
- Pending dots render immediately for an empty `streaming` assistant message and retain `aria-label="正在生成"`.
- `t/s` remains hidden while streaming and appears only in terminal states with generated output; it is explicitly an estimate, not billing usage.
- Final throughput uses all generated `content + reasoningContent`, first-output-to-terminal monotonic duration, and persists across reloads.
- Retry appears only on the latest assistant message with `status === 'error'`; stopped and historical failed messages do not expose retry.
- The metadata toolbar is always visible, outside the bubble, background-free, border-free, shadow-free, keyboard accessible, and uses tabular numerals.
- The content-script popover's dimensions, copy placement, and 50px scroll guard remain unchanged.
- Preserve unrelated dirty-worktree changes. Stage only the exact files listed in each task; never use `git add -A` during implementation.
- Follow red-green-refactor TDD for every task and run the focused test before each task commit.

---

## File Structure

### New files

- `src/dianzhi/provider/throughput.ts` — dependency-free output-token estimate and final integer `t/s` calculation.
- `tests/unit/dianzhi/provider/throughput.spec.ts` — deterministic estimator tests.
- `tests/unit/background/provider-runner.spec.ts` — terminal lifecycle/timing tests at the runner owner boundary.
- `tests/unit/offscreen/migration-2-2-0.spec.ts` — upgrade test proving existing messages receive a nullable throughput column.
- `tests/unit/offscreen/conversation-store.spec.ts` — finalization and reload round-trip of the persisted value.

### Modified files

- `src/dianzhi/domain/protocol.ts` — add required nullable `MessageRecord.estimatedThroughputTps`.
- `src/offscreen/database/schema.ts` — add immutable release `MESSAGE_THROUGHPUT_RELEASE` version `2.2.0`.
- `src/offscreen/main.ts` — register the 2.2.0 release after 2.1.0.
- `src/offscreen/database/store.ts` — select/default/finalize the throughput column.
- `src/offscreen/database/rpc.ts` — validate the new finalization input.
- `src/background/conversation-manager.ts` — set throughput to null during crash recovery.
- `src/background/provider-runner.ts` — record monotonic first-output/terminal time and finalize all terminal paths with the estimate.
- `src/dianzhi/ui/MessageList.tsx` — pending/status/throughput/copy/retry toolbar and conditional item wrapper.
- `src/dianzhi/ui/message-time.ts` — render the approved `HH:mm:ss` precision.
- `src/dianzhi/ui/streaming-value-controller.ts` — generalize the locally added continuous height controller into a scalar controller for `scrollTop`.
- `src/sidepanel/scroll-follow.ts` — observe natural history growth and animate only `scrollTop` under the strict guard.
- `src/sidepanel/App.tsx` — wire retry into messages, remove composer status/retry and height-growth props, provide a natural content host ref.
- `src/sidepanel/App.css` — permanent background-free toolbar, item/bubble layout, natural-height stream content, and cleanup of obsolete composer status rules.
- `tests/unit/dianzhi/ui/message-time.spec.ts` — lock valid timestamps to `HH:mm:ss` and preserve malformed-date fallback.
- `tests/unit/dianzhi/ui/MessageList.spec.tsx` — replace height-wrapper cases with the approved toolbar matrix and pending assertion.
- `tests/unit/dianzhi/ui/streaming-value-controller.spec.ts` — rename/generalize continuous-controller cases for scalar scroll use.
- `tests/unit/sidepanel/scroll-follow.spec.ts` — strict guard and scroll-only curve tests.
- `tests/unit/sidepanel/App.spec.tsx` — Side Panel integration: toolbar retry, no composer status/retry, no clipping wrapper, natural growth follow.
- `tests/unit/content/views/App.spec.tsx` — add nullable throughput to typed message fixtures and assert the popover remains metadata-free.
- `tests/unit/offscreen/sqlite-helper.ts` — apply the full 1.0.0 → 2.2.0 release chain for store tests.
- `eslint.config.js` — allow the three new TypeScript spec files plus the throughput spec in project-service linting.

### Deleted file

- `src/dianzhi/ui/StreamingMessageGrowth.tsx` — obsolete height-clipping presentation gate.

---

### Task 1: Persist the terminal throughput contract

**Files:**

- Modify: `src/dianzhi/domain/protocol.ts`
- Modify: `src/offscreen/database/schema.ts`
- Modify: `src/offscreen/main.ts`
- Modify: `src/offscreen/database/store.ts`
- Modify: `src/offscreen/database/rpc.ts`
- Modify: `src/background/conversation-manager.ts`
- Modify: `tests/unit/offscreen/sqlite-helper.ts`
- Create: `tests/unit/offscreen/migration-2-2-0.spec.ts`
- Create: `tests/unit/offscreen/conversation-store.spec.ts`
- Modify: `tests/unit/content/views/App.spec.tsx`
- Modify: `tests/unit/dianzhi/ui/MessageList.spec.tsx`
- Modify: `tests/unit/sidepanel/App.spec.tsx`
- Modify: `eslint.config.js`

**Interfaces:**

- Produces: `MessageRecord.estimatedThroughputTps: number | null`.
- Produces: `FinalizeAssistantInput.estimatedThroughputTps: number | null`.
- Produces: `MESSAGE_THROUGHPUT_RELEASE = { version: '2.2.0', migrationSQL: string }`.
- Consumes: existing release ordering, database RPC, and conversation store contracts.

- [ ] **Step 1: Write the failing migration and store tests**

Create `tests/unit/offscreen/migration-2-2-0.spec.ts` with a pre-2.2 database, one existing
message, the new release applied, and these assertions:

```ts
// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  CONFIG_RELEASE,
  MESSAGE_THROUGHPUT_RELEASE,
  SCHEMA_RELEASE,
  TOOL_ID_RELEASE,
} from '@/offscreen/database/schema'

describe('MESSAGE_THROUGHPUT_RELEASE 2.2.0', () => {
  it('adds a nullable estimated throughput to existing messages', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(SCHEMA_RELEASE.migrationSQL)
    db.exec(CONFIG_RELEASE.migrationSQL)
    db.exec(TOOL_ID_RELEASE.migrationSQL)
    db.exec(`
      INSERT INTO conversations (
        selection_key, tab_id, tool_id, tool_name, title, selected_text,
        context_text, prompt_snapshot, created_at, updated_at
      ) VALUES (1, 9, 1, '词典', 'run', 'run', 'run fast', 'Explain run', '2026-08-27', '2026-08-27');
      INSERT INTO messages (
        conversation_id, sequence, role, content, reasoning_content, status,
        error_code, error_message, created_at, updated_at
      ) VALUES (1, 1, 'assistant', 'hello', '', 'completed', NULL, NULL, '2026-08-27', '2026-08-27');
    `)

    db.exec(MESSAGE_THROUGHPUT_RELEASE.migrationSQL)

    expect(MESSAGE_THROUGHPUT_RELEASE.version).toBe('2.2.0')
    const row = db
      .prepare('SELECT estimated_throughput_tps AS value FROM messages WHERE id = 1')
      .get() as { value: number | null }
    expect(row.value).toBeNull()
  })
})
```

Create `tests/unit/offscreen/conversation-store.spec.ts`: create a selection with a small
test tool, append an assistant, finalize it with `estimatedThroughputTps: 65`, reload the
conversation, and assert the terminal message returns `65`:

```ts
// @vitest-environment node
import { expect, it } from 'vitest'
import { DEFAULT_TOOLS } from '@/dianzhi/domain/settings'
import { createConversationStore } from '@/offscreen/database/store'
import { createNodeDatabase } from './sqlite-helper'

it('round-trips terminal estimated throughput', async () => {
  const { connection } = createNodeDatabase()
  const store = createConversationStore(connection, () => '2026-08-27T00:00:00.000Z')
  const created = await store.createSelection({
    tabId: 9,
    tool: DEFAULT_TOOLS[0],
    selectedText: 'run',
    contextText: 'run fast',
    promptSnapshot: 'Explain run',
  })
  const assistant = await store.appendAssistant(created.conversation.id)
  await store.finalizeAssistant(assistant.id, {
    status: 'completed',
    content: 'hello',
    reasoningContent: '',
    estimatedThroughputTps: 65,
  })

  const reloaded = await store.getConversation(created.conversation.id)
  expect(reloaded?.messages.at(-1)?.estimatedThroughputTps).toBe(65)
})
```

- [ ] **Step 2: Run the new tests and verify red**

Run:

```bash
pnpm exec vitest run tests/unit/offscreen/migration-2-2-0.spec.ts tests/unit/offscreen/conversation-store.spec.ts
```

Expected: FAIL because `MESSAGE_THROUGHPUT_RELEASE` and the finalization field do not yet
exist.

- [ ] **Step 3: Add the typed field and immutable 2.2.0 release**

Add this required property to `MessageRecord`:

```ts
estimatedThroughputTps: number | null
```

Append—not rewrite—this release to `schema.ts`:

```ts
export const MESSAGE_THROUGHPUT_RELEASE = {
  version: '2.2.0',
  migrationSQL: `
ALTER TABLE messages
  ADD COLUMN estimated_throughput_tps INTEGER
  CHECK (estimated_throughput_tps IS NULL OR estimated_throughput_tps >= 0);
`,
} as const
```

Register it after `TOOL_ID_RELEASE` in `src/offscreen/main.ts` and apply the same full
release order in `tests/unit/offscreen/sqlite-helper.ts`.

- [ ] **Step 4: Carry the field through store creation, reads, finalization, and RPC validation**

Add the aliased column to `MESSAGE_COLUMNS`, return `null` from `messageRecord`, and make
finalization strict:

```ts
export interface FinalizeAssistantInput {
  status: Extract<MessageStatus, 'completed' | 'error' | 'stopped'>
  content: string
  reasoningContent: string
  estimatedThroughputTps: number | null
  errorCode?: string | null
  errorMessage?: string | null
}
```

Update the final SQL atomically:

```sql
UPDATE messages
SET content = ?, reasoning_content = ?, status = ?, error_code = ?,
    error_message = ?, estimated_throughput_tps = ?, updated_at = ?
WHERE id = ? AND role = 'assistant' AND status = 'streaming'
```

Extend `finalizeAssistant` RPC validation with:

```ts
args.input.estimatedThroughputTps === null ||
  (typeof args.input.estimatedThroughputTps === 'number' &&
    Number.isSafeInteger(args.input.estimatedThroughputTps) &&
    args.input.estimatedThroughputTps >= 0)
```

Crash recovery has no surviving monotonic start time, so finalize recovered streams with:

```ts
estimatedThroughputTps: null
```

- [ ] **Step 5: Update all typed message fixtures to the explicit null default**

Add this beside `reasoningContent` in content App, MessageList, and Side Panel test
fixtures that construct `MessageRecord` values:

```ts
estimatedThroughputTps: null,
```

Do not make the property optional to avoid fixture work; a required nullable field keeps
runtime snapshots and persisted rows consistent.

- [ ] **Step 6: Run storage, protocol, and type gates**

Run:

```bash
pnpm exec vitest run tests/unit/offscreen/migration-2-1-0.spec.ts tests/unit/offscreen/migration-2-2-0.spec.ts tests/unit/offscreen/conversation-store.spec.ts tests/unit/dianzhi/protocol.spec.ts
pnpm run typecheck
```

Expected: all focused tests pass and TypeScript reports no missing message field.

- [ ] **Step 7: Commit the persistence contract**

```bash
git add src/dianzhi/domain/protocol.ts src/offscreen/database/schema.ts src/offscreen/main.ts src/offscreen/database/store.ts src/offscreen/database/rpc.ts src/background/conversation-manager.ts tests/unit/offscreen/sqlite-helper.ts tests/unit/offscreen/migration-2-2-0.spec.ts tests/unit/offscreen/conversation-store.spec.ts tests/unit/content/views/App.spec.tsx tests/unit/dianzhi/ui/MessageList.spec.tsx tests/unit/sidepanel/App.spec.tsx eslint.config.js
git commit -m "feat(messages): persist final estimated throughput"
```

### Task 2: Calculate throughput at the provider-runner boundary

**Files:**

- Create: `src/dianzhi/provider/throughput.ts`
- Create: `tests/unit/dianzhi/provider/throughput.spec.ts`
- Modify: `src/background/provider-runner.ts`
- Create: `tests/unit/background/provider-runner.spec.ts`
- Modify: `eslint.config.js`

**Interfaces:**

- Consumes: `FinalizeAssistantInput.estimatedThroughputTps` from Task 1.
- Produces: `estimateOutputTokens(text: string): number`.
- Produces: `calculateEstimatedThroughputTps(text: string, durationMs: number): number | null`.
- Produces: optional `ProviderRunnerDependencies.now?: () => number`, defaulting to `performance.now()`.

- [ ] **Step 1: Write failing estimator tests**

Create `tests/unit/dianzhi/provider/throughput.spec.ts` with exact cases:

```ts
import { describe, expect, it } from 'vitest'
import {
  calculateEstimatedThroughputTps,
  estimateOutputTokens,
} from '@/dianzhi/provider/throughput'

describe('estimated provider throughput', () => {
  it('counts each CJK code point and groups remaining UTF-8 bytes by four', () => {
    expect(estimateOutputTokens('你好')).toBe(2)
    expect(estimateOutputTokens('abcdefgh')).toBe(2)
    expect(estimateOutputTokens('你好abcd')).toBe(3)
  })

  it('returns no speed without generated output', () => {
    expect(calculateEstimatedThroughputTps('', 1_000)).toBeNull()
  })

  it('rounds a terminal average and floors tiny durations at 100ms', () => {
    expect(calculateEstimatedThroughputTps('abcdefgh', 1_000)).toBe(2)
    expect(calculateEstimatedThroughputTps('abcdefgh', 0)).toBe(20)
  })
})
```

- [ ] **Step 2: Run the estimator spec and verify red**

```bash
pnpm exec vitest run tests/unit/dianzhi/provider/throughput.spec.ts
```

Expected: FAIL because `throughput.ts` does not exist.

- [ ] **Step 3: Implement the dependency-free estimator**

Use Unicode script properties and one `TextEncoder`; ignore no generated bytes, but do
not attempt model-specific billing tokenization:

```ts
const MIN_DURATION_MS = 100
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const encoder = new TextEncoder()

export function estimateOutputTokens(text: string): number {
  let cjk = 0
  let remainder = ''
  for (const point of text) {
    if (CJK.test(point)) cjk += 1
    else remainder += point
  }
  return cjk + Math.ceil(encoder.encode(remainder).byteLength / 4)
}

export function calculateEstimatedThroughputTps(text: string, durationMs: number): number | null {
  const tokens = estimateOutputTokens(text)
  if (tokens === 0) return null
  return Math.max(1, Math.round(tokens / (Math.max(durationMs, MIN_DURATION_MS) / 1_000)))
}
```

- [ ] **Step 4: Write failing provider-runner terminal-path tests**

Create a `MessageRecord` fixture with `estimatedThroughputTps: null` and deterministic
dependencies:

```ts
const assistant: MessageRecord = {
  id: 7,
  conversationId: 22,
  sequence: 2,
  role: 'assistant',
  content: '',
  reasoningContent: '',
  estimatedThroughputTps: null,
  status: 'streaming',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}
const finalize = vi.fn(async (_messageId: number, input: FinalizeAssistantInput) => ({
  ...assistant,
  ...input,
  errorCode: input.errorCode ?? null,
  errorMessage: input.errorMessage ?? null,
}))
const publish = vi.fn()
const checkpoint = vi.fn(async () => assistant)
const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000)
```

The completed test emits an 8-byte ASCII delta and asserts exactly `2t/s`:

```ts
const runner = createProviderRunner({
  streamChat: vi.fn(async (_input, handlers) => {
    handlers.onDelta({ kind: 'content', delta: 'abcdefgh' })
    handlers.onDone()
  }),
  checkpoint,
  finalize,
  publish,
  now: clock,
})
await runner.start({
  conversationId: 22,
  assistant,
  provider: DEFAULT_SETTINGS.provider,
  messages: [],
}).done
expect(finalize).toHaveBeenCalledWith(
  assistant.id,
  expect.objectContaining({ status: 'completed', estimatedThroughputTps: 2 })
)
```

Use the same harness for three explicit terminal variants: a mock that emits the same
delta then throws `new Error('broken')` must finalize `status: 'error'` with `2`; an abort
mock must reject with `new DOMException('aborted', 'AbortError')` after `handle.stop()` and
finalize `status: 'stopped'` with `2`; a mock that throws before any delta must finalize
`estimatedThroughputTps: null`. Await `handle.done` in every case.

- [ ] **Step 5: Run the runner spec and verify red**

```bash
pnpm exec vitest run tests/unit/background/provider-runner.spec.ts
```

Expected: FAIL because the runner does not inject time or include throughput in finalization.

- [ ] **Step 6: Add first-output and terminal timing to all runner paths**

Add:

```ts
now?: () => number
```

and inside the runner:

```ts
const now = dependencies.now ?? (() => performance.now())
let firstOutputAt: number | null = null

const publishDelta = (delta: ProviderDelta) => {
  if (!isCurrent()) return
  if (delta.delta && firstOutputAt === null) firstOutputAt = now()
  if (delta.kind === 'content') content += delta.delta
  else reasoningContent += delta.delta
  void dependencies.publish({
    type: delta.kind === 'content' ? 'stream.delta' : 'stream.reasoning',
    conversationId: input.conversationId,
    messageId: input.assistant.id,
    content: delta.delta,
  })
  armCheckpoint()
}

const terminalThroughput = (terminalAt: number) =>
  firstOutputAt === null
    ? null
    : calculateEstimatedThroughputTps(content + reasoningContent, terminalAt - firstOutputAt)
```

Capture `terminalAt = now()` immediately when `runStream` resolves or enters the catch
path, before awaiting checkpoint/finalization I/O. Pass the result on completed, stopped,
and error finalization. Keep publish ordering and the 250ms/1KiB checkpoint unchanged.

- [ ] **Step 7: Run focused runner and estimator tests**

```bash
pnpm exec vitest run tests/unit/dianzhi/provider/throughput.spec.ts tests/unit/background/provider-runner.spec.ts
pnpm run typecheck
```

Expected: both specs and typecheck pass.

- [ ] **Step 8: Commit provider timing and estimation**

```bash
git add src/dianzhi/provider/throughput.ts src/background/provider-runner.ts tests/unit/dianzhi/provider/throughput.spec.ts tests/unit/background/provider-runner.spec.ts eslint.config.js
git commit -m "feat(provider): calculate terminal response throughput"
```

### Task 3: Build the permanent message toolbar

**Files:**

- Modify: `src/dianzhi/ui/MessageList.tsx`
- Modify: `src/dianzhi/ui/message-time.ts`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.css`
- Modify: `tests/unit/dianzhi/ui/MessageList.spec.tsx`
- Modify: `tests/unit/dianzhi/ui/message-time.spec.ts`
- Modify: `tests/unit/sidepanel/App.spec.tsx`

**Interfaces:**

- Consumes: `MessageRecord.estimatedThroughputTps` from Task 1.
- Produces: optional `MessageListProps.latestAssistantId?: number`.
- Produces: optional `MessageListProps.onRetryMessage?(message: MessageRecord): void`.
- Preserves: existing plain-text and raw-Markdown clipboard behavior.

- [ ] **Step 1: Replace metadata expectations with the approved state matrix**

In `MessageList.spec.tsx`, keep the clipboard tests and add these focused assertions:

```tsx
it('shows pending dots and status immediately before the first content delta', async () => {
  await renderMessageList(true, assistantMessage({ content: '', status: 'streaming' }))
  expect(host?.querySelector('[aria-label="正在生成"]')).not.toBeNull()
  expect(host?.querySelector('.dz-message-meta')?.textContent).toContain('正在生成')
  expect(host?.querySelector('.dz-message-copy')).toBeNull()
})

it('shows only final throughput after completion', async () => {
  await renderMessageList(
    true,
    assistantMessage({ status: 'completed', estimatedThroughputTps: 65 })
  )
  expect(host?.querySelector('.dz-message-meta')?.textContent).toContain('65t/s')
  expect(host?.querySelector('.dz-message-meta')?.textContent).not.toContain('正在生成')
})
```

Add cases for user toolbar without speed, stopped partial output with `已停止` and speed,
latest failed assistant with retry, older failed assistant without retry, and error before
output with time + retry but no copy/speed. Use two assistant messages in the historical
failure case and expose only the second ID:

```tsx
const onRetryMessage = vi.fn()
root.render(
  <MessageList
    messages={[
      assistantMessage({ id: 1, status: 'error' }),
      assistantMessage({ id: 2, sequence: 2, status: 'error' }),
    ]}
    mode="chat"
    reasoningEnabled={false}
    showMeta
    latestAssistantId={2}
    onRetryMessage={onRetryMessage}
  />
)
expect(host?.querySelectorAll('[aria-label="重新生成"]')).toHaveLength(1)
```

Update `message-time.spec.ts` to require seconds:

```ts
function localIso(hour: number, minute: number, second: number) {
  return new Date(2026, 2, 5, hour, minute, second).toISOString()
}

expect(formatMessageTime(localIso(14, 7, 9), 'en-GB')).toBe('14:07:09')
```

- [ ] **Step 2: Run MessageList tests and verify red**

```bash
pnpm exec vitest run tests/unit/dianzhi/ui/MessageList.spec.tsx
```

Expected: FAIL because metadata is hover-only, streaming copy buttons remain, and no
throughput/retry/status content exists in the row.

- [ ] **Step 3: Refactor only `showMeta` messages into item/bubble/toolbar siblings**

Preserve the popover path by keeping its existing bare bubble when `showMeta` is false.
For Side Panel metadata, render this semantic shape:

```tsx
<article className={`dz-message-item is-${message.role}`} data-status={message.status}>
  <div className={`dz-message is-${message.role}`}>{body}</div>
  <div className="dz-message-meta">{toolbar}</div>
</article>
```

Build toolbar fields in this order: `<time>`, terminal throughput, status, plain copy,
Markdown copy, conditional retry. Do not render copy controls while streaming or when
content is empty. Retry condition is exactly:

```ts
message.role === 'assistant' &&
  message.status === 'error' &&
  message.id === latestAssistantId &&
  onRetryMessage !== undefined
```

Add an outline refresh SVG consistent with the existing copy glyphs. The button must use:

```tsx
aria-label="重新生成"
title="重新生成"
```

Update the formatter to request the seconds field explicitly:

```ts
return date.toLocaleTimeString(locale, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
```

- [ ] **Step 4: Make the toolbar permanent and background-free in Side Panel CSS**

Replace absolute hover-card rules with static layout:

```css
.dz-message-item {
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  max-width: 92%;
  gap: 4px;
}
.dz-message-item.is-user {
  align-self: flex-end;
  align-items: flex-end;
}
.dz-message-item .dz-message {
  box-sizing: border-box;
  max-width: 100%;
}
.dz-message-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 24px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--d-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
```

Keep icon buttons transparent and focus-visible. Remove Side Panel-only opacity,
pointer-event, transform, border-card, and hover-reveal rules.

- [ ] **Step 5: Wire Side Panel retry into the latest message and remove composer controls**

Pass:

```tsx
latestAssistantId={latestAssistant?.id}
onRetryMessage={() => onRetry()}
```

Delete the Side Panel import/render of `ConversationStatus` and the footer `.dz-secondary`
retry button. Do not remove the content popover's status/retry use. Suppress the duplicate
global banner when the latest message already owns the same error:

```tsx
const showGlobalError = Boolean(state.error && !latestAssistant?.errorMessage)

{
  showGlobalError && (
    <div className="dz-error" role="alert">
      <span>{state.error?.message}</span>
    </div>
  )
}
```

Add a Side Panel integration assertion for the message retry control:

```tsx
expect(host?.querySelector('.dz-panel-composer .dz-status')).toBeNull()
expect(host?.querySelector('.dz-panel-composer .dz-secondary')).toBeNull()
await act(async () => host?.querySelector<HTMLButtonElement>('[aria-label="重新生成"]')?.click())
expect(conversationDispatch).toHaveBeenCalledWith(
  expect.objectContaining({ type: 'conversation.retry' })
)
```

Cover the authoritative pending transition separately by emitting the existing event:

```tsx
await act(async () => {
  port.emitMessage({
    type: 'stream.started',
    conversationId: 22,
    message: {
      id: 7,
      conversationId: 22,
      sequence: 2,
      role: 'assistant',
      content: '',
      reasoningContent: '',
      estimatedThroughputTps: null,
      status: 'streaming',
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
  })
  await Promise.resolve()
})
expect(host?.querySelector('[aria-label="正在生成"]')).not.toBeNull()
expect(host?.querySelector('.dz-message-meta')?.textContent).toContain('正在生成')
```

Do not add optimistic temporary IDs or host-local pending state.

- [ ] **Step 6: Run shared UI and Side Panel focused tests**

```bash
pnpm exec vitest run tests/unit/dianzhi/ui/MessageList.spec.tsx tests/unit/dianzhi/ui/message-time.spec.ts tests/unit/sidepanel/App.spec.tsx tests/unit/content/views/App.spec.tsx
pnpm run typecheck
```

Expected: toolbar matrix passes, Side Panel retry dispatch remains covered, and content
popover still renders without per-message metadata.

- [ ] **Step 7: Commit the message toolbar**

```bash
git add src/dianzhi/ui/MessageList.tsx src/dianzhi/ui/message-time.ts src/sidepanel/App.tsx src/sidepanel/App.css tests/unit/dianzhi/ui/MessageList.spec.tsx tests/unit/dianzhi/ui/message-time.spec.ts tests/unit/sidepanel/App.spec.tsx
git commit -m "feat(sidepanel): move response status and actions under messages"
```

### Task 4: Remove message clipping and animate scroll only

**Files:**

- Delete: `src/dianzhi/ui/StreamingMessageGrowth.tsx`
- Modify: `src/dianzhi/ui/MessageList.tsx`
- Modify: `src/dianzhi/ui/streaming-value-controller.ts`
- Modify: `src/sidepanel/scroll-follow.ts`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.css`
- Modify: `tests/unit/dianzhi/ui/MessageList.spec.tsx`
- Modify: `tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`
- Modify: `tests/unit/sidepanel/scroll-follow.spec.ts`
- Modify: `tests/unit/sidepanel/App.spec.tsx`

**Interfaces:**

- Produces: `createContinuousValueController(initialValue, options)` with
  `advance`, `getValue`, `getSpeed`, `isRunning`, `jumpToTarget`, `observeTarget`,
  `setStreaming`, and `setValue`.
- Produces: `useScrollFollow(containerRef, contentRef, { reducedMotion, streaming, viewKey })`.
- Produces: `ScrollFollowBindings = { onScroll(): void }`.
- Removes: `smoothStreamingGrowth`, `reducedMotion`, and `onStreamingHeightDelta` from
  `MessageListProps`.

- [ ] **Step 1: Rewrite controller tests around a generic scalar**

Rename the local `createContinuousGrowthController` expectations to
`createContinuousValueController`. Retain tests proving acceleration on stacked target
growth and post-stream deceleration, then add `setValue`:

```ts
it('reanchors both current value and target', () => {
  const controller = createContinuousValueController(0)
  controller.observeTarget(500)
  controller.setValue(320)
  expect(controller.getValue()).toBe(320)
  expect(controller.jumpToTarget()).toBe(320)
})
```

- [ ] **Step 2: Replace synchronous height-delta scroll tests with natural-growth tests**

In `scroll-follow.spec.ts`, retain `SCROLL_FOLLOW_THRESHOLD === 150` and change the
predicate boundary to strict behavior:

```ts
expect(isNearBottom(container({ scrollTop: 551 }))).toBe(true) // gap 149
expect(isNearBottom(container({ scrollTop: 550 }))).toBe(false) // gap 150
```

Remove `syncScrollForHeightGrowth` tests. Add hook/integration coverage that invokes a
stubbed `ResizeObserver`, grows `scrollHeight`, drives rAF frames, and verifies:

- message DOM is natural height and visible before the first animation frame;
- `scrollTop` advances over multiple frames rather than jumping;
- a second growth retargets the existing upward cycle;
- stream completion drains exactly to `scrollHeight - clientHeight`;
- a real user scroll to a gap of 150 cancels following;
- reduced motion jumps without scheduling a frame.

Capture the observer in the Side Panel spec and prove text visibility before the first
animation frame:

```tsx
let resizeCallback: ResizeObserverCallback | undefined
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
)

grow(1_040)
await syncMessages([message(1, 'first line\nsecond line')])
expect(host?.textContent).toContain('second line')
expect(host?.querySelector('.dz-streaming-message-growth')).toBeNull()
act(() =>
  resizeCallback?.(
    [{ target: historyContent(), contentRect: { height: 1_040 } } as ResizeObserverEntry],
    {} as ResizeObserver
  )
)
expect(frameCallback).not.toBeNull()
const before = history().scrollTop
act(() => frameCallback?.(1_033))
expect(history().scrollTop).toBeGreaterThan(before)
expect(history().scrollTop).toBeLessThan(740)
driveFrames()
expect(history().scrollTop).toBe(740)
```

Define `historyContent()` beside the existing `history()` helper:

```ts
const historyContent = () => {
  const element = host?.querySelector<HTMLDivElement>('.dz-panel-history-content')
  if (!element) throw new Error('.dz-panel-history-content not found')
  return element
}
```

- [ ] **Step 3: Run controller and scroll tests and verify red**

```bash
pnpm exec vitest run tests/unit/dianzhi/ui/streaming-value-controller.spec.ts tests/unit/sidepanel/scroll-follow.spec.ts tests/unit/sidepanel/App.spec.tsx
```

Expected: FAIL because the current Side Panel still clips message height and synchronizes
`scrollTop` by committed height deltas.

- [ ] **Step 4: Generalize the continuous controller without changing its curve**

Rename the exported interface/function from growth-specific to scalar terminology and
add:

```ts
setValue(nextValue: number) {
  value = Math.max(0, nextValue)
  target = value
  speed = 0
  lastAdvancedAt = null
}
```

Keep the existing defaults (`followTimeMs = 400`, `cruiseSpeed = 40`,
`maximumSpeed = 480`, acceleration `1_200px/s²`, deceleration `600px/s²`). The 400ms value
now affects viewport pursuit only; it cannot hide text.

- [ ] **Step 5: Rebuild `useScrollFollow` around natural content observation**

Use two refs and explicit options:

```ts
export interface ScrollFollowOptions {
  reducedMotion: boolean
  streaming: boolean
  viewKey: string
}

export function useScrollFollow(
  containerRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  options: ScrollFollowOptions
): { onScroll(): void }
```

The observer stores the previous `scrollHeight`. On growth, calculate the gap against the
previous height. Start/retarget only when the last real user position is inside the
strict guard. Programmatic scroll events must not flip the pinned state. A real scroll
outside the guard cancels rAF and calls `controller.setStreaming(false, now)`.

Each animation frame performs only:

```ts
container.scrollTop = controller.advance(now)
```

When the controller reaches the terminal target after `streaming` becomes false, set
`scrollTop` exactly to `Math.max(0, scrollHeight - clientHeight)` and stop scheduling.

- [ ] **Step 6: Remove the message-height presentation gate**

Delete `StreamingMessageGrowth.tsx`, its CSS selectors, its MessageList props/import, and
the entire `MessageList streaming growth` test block. In Side Panel, add a natural content
host:

```tsx
<main ref={historyRef} className="dz-panel-history" onScroll={onHistoryScroll}>
  <div ref={historyContentRef} className="dz-panel-history-content">
    <MessageList
      messages={snapshot.messages}
      mode="chat"
      reasoningEnabled={reasoningEnabled}
      showMeta
      latestAssistantId={latestAssistant?.id}
      onRetryMessage={() => onRetry()}
    />
    {showSetup ? (
      <div ref={setupRef} className="dz-provider-setup-host" style={{ height: setupHeight }}>
        <ProviderSetup
          provider={providerSettings}
          onSave={(provider) => onSaveProvider(provider).then(() => setSetupDismissed(true))}
          onOpenSettings={onOpenSettings}
        />
      </div>
    ) : showGlobalError ? (
      <div className="dz-error" role="alert">
        <span>{state.error?.message}</span>
      </div>
    ) : null}
  </div>
</main>
```

Pass `streaming={Boolean(streaming)}` to `useScrollFollow`. Do not apply `height`,
`max-height`, or `overflow: hidden` to streamed messages.

- [ ] **Step 7: Run the no-delay scroll suite**

```bash
pnpm exec vitest run tests/unit/dianzhi/ui/MessageList.spec.tsx tests/unit/dianzhi/ui/streaming-value-controller.spec.ts tests/unit/sidepanel/scroll-follow.spec.ts tests/unit/sidepanel/App.spec.tsx
pnpm run typecheck
```

Expected: tests prove content is visible before rAF, scroll glides under the strict guard,
and no `.dz-streaming-message-growth` element exists.

- [ ] **Step 8: Commit the scroll-only continuity fix**

```bash
git add src/dianzhi/ui/MessageList.tsx src/dianzhi/ui/streaming-value-controller.ts src/sidepanel/scroll-follow.ts src/sidepanel/App.tsx src/sidepanel/App.css tests/unit/dianzhi/ui/MessageList.spec.tsx tests/unit/dianzhi/ui/streaming-value-controller.spec.ts tests/unit/sidepanel/scroll-follow.spec.ts tests/unit/sidepanel/App.spec.tsx
git commit -m "fix(sidepanel): render stream text immediately and smooth only scroll"
```

### Task 5: Integration gates and real Chrome verification

**Files:**

- Modify only if a gate exposes a scoped defect: files already listed in Tasks 1–4.
- Do not modify: unrelated `.agents/**` files or older dirty design/plan documents.

**Interfaces:**

- Consumes: all Tasks 1–4 outputs.
- Produces: verified extension build and live Side Panel evidence.

- [ ] **Step 1: Run formatting and inspect only scoped changes**

```bash
pnpm exec prettier --write src/dianzhi/domain/protocol.ts src/dianzhi/provider/throughput.ts src/background/provider-runner.ts src/background/conversation-manager.ts src/offscreen/database/schema.ts src/offscreen/database/store.ts src/offscreen/database/rpc.ts src/offscreen/main.ts src/dianzhi/ui/MessageList.tsx src/dianzhi/ui/message-time.ts src/dianzhi/ui/streaming-value-controller.ts src/sidepanel/App.tsx src/sidepanel/App.css src/sidepanel/scroll-follow.ts tests/unit/background/provider-runner.spec.ts tests/unit/dianzhi/provider/throughput.spec.ts tests/unit/dianzhi/ui/MessageList.spec.tsx tests/unit/dianzhi/ui/message-time.spec.ts tests/unit/offscreen/migration-2-2-0.spec.ts tests/unit/offscreen/conversation-store.spec.ts tests/unit/offscreen/sqlite-helper.ts tests/unit/sidepanel/App.spec.tsx tests/unit/sidepanel/scroll-follow.spec.ts eslint.config.js
git diff --check
```

Expected: Prettier succeeds and `git diff --check` reports no whitespace errors.

- [ ] **Step 2: Run all automated quality gates**

```bash
pnpm run lint
pnpm run test
pnpm run build
```

Expected: lint/typecheck pass, all Vitest files pass, and the production extension bundle
and zip build successfully.

- [ ] **Step 3: Inspect the built extension in a real Chrome Side Panel**

Load the generated extension build, start a response slow enough to observe lifecycle,
and verify all of the following:

1. Three pending dots appear immediately after send and before the first provider text.
2. The first text and every newly wrapped line paint immediately; they are not clipped
   for roughly 400ms.
3. While within 149px of the bottom, the viewport follows continuously without abrupt
   start/stop cycles; at exactly 150px or farther, new content does not move the viewport.
4. During streaming the toolbar shows `HH:mm:ss 正在生成` and no `t/s`.
5. Completion replaces status with one stable integer such as `65t/s`; reload preserves it.
6. Plain copy and Markdown copy produce their existing formats.
7. A partial failed latest response shows its terminal speed and refresh icon; clicking
   refresh creates a new assistant run and immediately shows pending dots.
8. An older failed message and a stopped message have no refresh icon.
9. The composer has no duplicate status label or separate retry button.
10. Browser console has no React, ResizeObserver, or extension runtime errors.

- [ ] **Step 4: Review final scope and commit any gate-only corrections**

```bash
git status --short
git diff --stat
git diff --check
```

If Tasks 1–4 required no correction, create no empty commit. If a scoped correction was
required, stage only its exact files and use:

```bash
git commit -m "fix(sidepanel): address message toolbar verification findings"
```

- [ ] **Step 5: Record final evidence in the handoff**

Report exact test file/test counts, build status, Chrome lifecycle observations, the
strict 150px boundary result, and whether any process/browser session remains running.
Do not claim the feature complete if the real Chrome pass was skipped or partial.
