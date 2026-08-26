# Dianzhi Side Panel Message Toolbar + Final Throughput Design

Status: approved via collaborative brainstorming (2026-08-27). Makes streamed text
visible without an artificial height-follow delay, moves generation state and recovery
actions from the composer into each message's metadata row, and shows a persisted final
estimated throughput after an assistant run reaches a terminal state.

## 1. Goal

The Side Panel currently places `ConversationStatus` and a separate retry button above
the composer. Its shared `MessageList` already renders time and two copy actions, but the
metadata is a hover-only floating card. A locally modified streaming-growth wrapper also
clips the newest assistant message while its displayed height chases the natural height
with a 400ms follow target. That makes scrolling look continuous, but a newly wrapped
line can exist in the DOM before it becomes visible.

The approved experience has four requirements:

1. An empty streaming assistant message immediately shows the same three pending dots as
   the content-script UI.
2. Message state, copy actions, final throughput, and retry live in a permanent,
   background-free row directly under the corresponding message.
3. `t/s` is hidden during generation and appears only after completion, failure, or a
   user stop. Failure/stop use the generated partial result when one exists.
4. Streamed text is never delayed for animation. The message takes its natural height
   immediately; only the Side Panel scroll position glides, and only when the pre-growth
   distance from the bottom is strictly less than 150px.

Scope is the native Side Panel. Shared `MessageList` receives reusable presentation
capabilities, but the content-script popover keeps its current layout and controls.

## 2. Approved behavior

| Message state                                | Body                                  | Background-free row beneath the bubble                |
| -------------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| User                                         | Prompt text                           | `HH:mm:ss [copy plain] [copy Markdown]`               |
| Assistant, streaming, empty                  | Three animated dots immediately       | `HH:mm:ss 正在生成`                                   |
| Assistant, streaming, content present        | Content immediately, without clipping | `HH:mm:ss 正在生成`                                   |
| Assistant, completed                         | Final content                         | `HH:mm:ss 65t/s [copy plain] [copy Markdown]`         |
| Latest assistant, failed with partial output | Partial output plus inline error      | `HH:mm:ss 48t/s [copy plain] [copy Markdown] [retry]` |
| Latest assistant, failed before any output   | Inline error                          | `HH:mm:ss [retry]`                                    |
| Assistant, stopped with partial output       | Partial output                        | `HH:mm:ss 48t/s 已停止 [copy plain] [copy Markdown]`  |

Only the latest assistant message may expose retry, and only when its status is `error`.
Although the command contract also permits retrying a stopped response, the approved UI
keeps `stopped` distinct from failure and does not show the refresh action there. Copy
actions remain disabled/absent when there is no content. Icon-only actions have a title
and accessible name. The row uses muted text, tabular figures for time/speed, no border,
no shadow, and no filled background; user rows align to the user's bubble edge and
assistant rows align to the assistant edge.

The Side Panel removes the status label and separate retry button above the composer.
Provider-configuration recovery remains in its existing inline setup/error area.

## 3. Throughput semantics

The current OpenAI-compatible SSE adapter only publishes content/reasoning deltas and
does not request or parse provider usage. Therefore the displayed value is a UI estimate,
not billing usage and not a provider-authoritative token count.

### 3.1 Estimate

At finalization, estimate output tokens from `content + reasoningContent` with one small,
deterministic helper:

- each CJK code point counts as one estimated token;
- remaining UTF-8 bytes count as `ceil(bytes / 4)` estimated tokens;
- empty output produces no throughput value.

This is deliberately dependency-free and provider-neutral. The UI label stays compact
(`65t/s`); code/tests name the value `estimatedThroughputTps` so it cannot be confused
with authoritative usage.

### 3.2 Timing

The provider runner records a monotonic timestamp on the first non-empty content or
reasoning delta. On `completed`, `error`, or `stopped`, it computes elapsed time from that
first output to terminal finalization, with a small positive lower bound to avoid division
by zero. It rounds `estimatedTokens / elapsedSeconds` to the nearest integer.

The runner receives an injectable monotonic `now()` dependency for deterministic tests.
It captures the terminal timestamp as soon as the stream resolves, throws, or is aborted,
before checkpoint/finalization I/O, so SQLite latency is not counted as generation time.

If no output delta arrived, `estimatedThroughputTps` is `null` and the row omits `t/s`.
The value is not published during streaming, so there is no flickering live counter.

### 3.3 Persistence

Add a nullable `estimated_throughput_tps INTEGER` message column in schema release
`2.2.0`. `MessageRecord` exposes it as `estimatedThroughputTps: number | null`.
Assistant finalization writes it with content/status/error fields, so the final result
survives Side Panel reloads and historical conversation sync. User and active streaming
messages store `NULL`.

No provider request format changes are required.

## 4. Immediate content and smooth scrolling

### 4.1 Remove the visibility delay

The Side Panel stops passing `smoothStreamingGrowth` to `MessageList`. The
`StreamingMessageGrowth` wrapper and its `overflow: hidden` CSS are removed if no other
consumer remains. New text therefore participates in normal layout and paints in the
same React commit that receives `stream.delta`.

The controller's `followTimeMs: 400` was a height-chase target, not a timer, but clipping
made it an effective visual delay. It is not used for message visibility after this
change. The provider runner's 250ms/1KiB database checkpoint cadence remains unchanged;
it does not gate publishing or rendering deltas.

### 4.2 Scroll-only continuity

`useScrollFollow` observes the history content's natural height. When height grows, it
computes the distance from the bottom using the measurements from immediately before
growth:

```text
previousDistance = previousScrollHeight - scrollTop - clientHeight
```

- If `previousDistance < 150`, update the scroll controller's target to the new bottom
  and animate `scrollTop` on `requestAnimationFrame`.
- If `previousDistance >= 150`, do nothing; the user's reading position is preserved.
- A real user scroll outside the guard cancels the active chase immediately.
- Returning inside the guard re-arms following for subsequent growth.
- Entering a conversation or switching tools anchors to the latest content immediately.
- Reduced-motion mode jumps directly to the new bottom.
- At stream completion the controller drains the final target and lands exactly at the
  bottom; it does not delay or hold message content.

The existing continuous acceleration/deceleration controller may drive `scrollTop`, but
message height is never driven by it. The scrollbar range can update immediately with
natural layout; only the viewport position is interpolated.

## 5. Pending lifecycle

`conversation-manager.startProvider` already publishes `stream.started` before starting
the provider fetch. Its assistant record has empty content and `status: 'streaming'`.
`MessageList` already maps that shape to `.dz-thinking` with three dots.

Implementation must preserve that path in the Side Panel and cover the handoff/sync
case. No 300–500ms debounce is introduced: once the streaming record is present, pending
renders immediately. The dots disappear naturally when the first content delta arrives.
`aria-label="正在生成"` and the existing reduced-motion treatment remain.

## 6. Component and data flow

### 6.1 `MessageList`

Extend the shared component with optional callbacks/data needed by the Side Panel rather
than coupling it to the conversation command adapter:

```ts
interface MessageListProps {
  // existing props omitted
  showMeta?: boolean
  latestAssistantId?: number
  onRetryMessage?(message: MessageRecord): void
}
```

The renderer separates each item into an alignment wrapper, a `.dz-message-bubble`, and
a sibling `.dz-message-meta` row. This keeps the toolbar outside the bordered/filled
bubble without relying on absolute positioning or hover state. The renderer determines
toolbar content from role/status and `estimatedThroughputTps`. Retry renders only when
`message.id === latestAssistantId`, status is `error`, and `onRetryMessage` is present.
The callback delegates to the host's existing `onRetry`; it does not send commands
directly.

Copy behavior remains shared and unchanged: one action writes rendered plain text and
the other writes the original Markdown source.

### 6.2 Side Panel host

`SidePanelView` passes `latestAssistantId` and `onRetryMessage={() => onRetry()}` to
`MessageList`. It removes `ConversationStatus`, the footer retry button, and the
`smoothStreamingGrowth` props. The composer keeps only composing/sending/stopping.

### 6.3 Background and storage

`provider-runner` owns first-output timing and throughput calculation because it sees
every delta and every terminal path. It passes the nullable final value through
`FinalizeAssistantInput`; the store writes it atomically with the terminal message.
Terminal `stream.done`, `stream.error`, and `stream.stopped` messages therefore carry the
persisted result through the existing protocol shape.

## 7. Accessibility and visual rules

- Pending container exposes an accessible busy label; dots are decorative.
- Copy buttons use the existing SVG family. Retry uses an outline refresh glyph, never
  emoji, with `aria-label`/`title="重新生成"`.
- Toolbar controls retain keyboard focus indicators and disabled semantics.
- Time and speed use `font-variant-numeric: tabular-nums`.
- The toolbar is always visible, wraps safely on narrow panels, and has no surface,
  border, or shadow.
- Animation respects `prefers-reduced-motion`; pending remains understandable without
  relying on motion because its accessible label and status text remain.

## 8. Tests

- Throughput helper: CJK, ASCII, mixed text, empty content, duration floor, and rounding.
- Provider runner: records the first output time; persists throughput on completed,
  stopped, and partial-error paths; leaves it null when failure occurs before output.
- Schema/store: migration adds the nullable column; reads and finalization round-trip it;
  existing rows become null.
- `MessageList`: immediate empty-stream dots; status mapping; final speed hidden while
  streaming and shown for all terminal partial/full results; user toolbar; copy actions;
  retry only on the latest failed assistant; accessible names.
- Side Panel: composer-level status/retry are absent; retry toolbar dispatches the
  existing command; natural content is not wrapped/clipped.
- Scroll follow: strict `<150px` pre-growth guard, exact 150px rejection, continuous
  target updates, cancellation after user scroll-away, final landing, view switch, and
  reduced motion.
- Gates: `pnpm run format:check`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, then
  a real Chrome Side Panel pass checking pending-to-first-token latency, message toolbar,
  retry, reload persistence, and scrollbar behavior.

## 9. Non-goals

- Provider-authoritative billing token counts.
- A live or continuously changing `t/s` value during generation.
- Changing the content-script popover's dimensions, copy placement, or 50px scroll guard.
- Retrying an older assistant message or introducing message branching.
- Delaying pending to avoid a short flash.
