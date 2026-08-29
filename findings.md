# Findings: Provider settings UX refinement

## Requirements

- Implement the approved Provider settings UX audit recommendations.
- Keep provider-specific request dialects hidden from users.
- Keep useful reasoning strength control while preserving a simple flow.

## Research Findings

- The current Provider form has one flat `grid-two` card: endpoint, key, model, temperature, reasoning controls, and raw JSON share a visual level.
- The connection test sends its result through the same global toast used for autosave, so users cannot distinguish save state from connectivity state.
- A `FieldError` is a separate grid child; a non-full model error can appear under a neighboring input instead of its own field.
- UI/UX guidance supports visible form labels, inline error feedback, loading/success feedback, native controls, and progressive disclosure for complex inputs.

## Technical Decisions

| Decision                                           | Rationale                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Use semantic `fieldset` and `legend` groups        | They convey grouping to visual and assistive-technology users.                |
| Use native `details`/`summary` for advanced JSON   | Keyboard-accessible progressive disclosure without a custom disclosure state. |
| Pass a distinct connection status to `OptionsView` | Prevents autosave toast text from being presented as a connection result.     |
| Wrap field and error together                      | Preserves layout and associates every error with the correct control.         |

## Resources

- `src/options/App.tsx`
- `src/options/App.css`
- `tests/unit/options/App.spec.tsx`

## 2026-08-27 Side Panel message-toolbar findings

- `MessageList` already renders three pending dots for an empty assistant message whose
  status is `streaming`; `conversation-manager.startProvider` publishes that record before
  starting the provider fetch.
- The locally modified `StreamingMessageGrowth` clips natural content with
  `overflow: hidden`; its default `followTimeMs` is 400ms, creating an effective visual
  delay even though no timer delays the stream delta.
- The provider runner's 250ms/1KiB checkpoint is persistence-only and does not gate
  `stream.delta` publication.
- Current SSE parsing exposes only content/reasoning deltas and no provider usage. Final
  `t/s` therefore requires an explicitly named UI estimate plus persisted duration/result.
- `MessageList` already owns time, plain-text copy, and raw-Markdown copy. The Side Panel
  currently owns composer-level `ConversationStatus` and retry; those actions should move
  into the latest assistant message metadata.
- Existing SQLite releases end at 2.1.0; a persisted nullable throughput field requires a
  2.2.0 migration and updates to message row mapping/finalization.
- Offscreen initialization explicitly lists each release in `src/offscreen/main.ts`; the
  2.2.0 release must be added there and to the unit SQLite helper's release sequence.
- Provider timing must be injectable into `ProviderRunnerDependencies`; capturing the
  terminal monotonic time before checkpoint/finalization keeps database latency out of
  the result.
- Current `MessageList` tests include an entire streaming-height suite and all fixtures
  omit throughput. The plan must remove those wrapper tests, add terminal-toolbar states,
  and update typed fixtures when `MessageRecord` grows.
- Current Side Panel scroll tests assert there is no animation because height and
  `scrollTop` are committed synchronously. They must be replaced with natural-growth
  observer/rAF assertions rather than incrementally edited around the old model.
- There is no existing direct provider-runner unit spec. The plan should create
  `tests/unit/background/provider-runner.spec.ts` so completed/error/stopped timing is
  tested at the owner boundary instead of only through conversation-manager mocks.
- The Node SQLite helper currently applies only releases 1.0.0 and 2.0.0, even though a
  dedicated 2.1.0 migration test applies the third release manually. Store round-trip
  tests for throughput need the helper to apply 2.1.0 and 2.2.0, or a focused migration
  fixture must apply the exact chain explicitly.
- Scroll following must use the natural history growth and a strict pre-growth `<150px`
  guard. Only `scrollTop` should be interpolated.
- A required finalization field also affects crash recovery in
  `conversation-manager.loadSnapshot`; recovered streaming messages must finalize with
  `estimatedThroughputTps: null` because their original first-output monotonic timestamp
  is unavailable after a background restart.
- Database RPC validation must accept only `null` or a non-negative finite integer for
  `estimatedThroughputTps`; otherwise the new store contract would be rejected before it
  reaches SQLite.
- The current Side Panel metadata is absolute, hover-only, bordered, shadowed, and filled.
  A wrapper/bubble/meta structure is required for an always-visible toolbar outside the
  bubble. Keeping that wrapper conditional on `showMeta` can preserve the content
  popover's existing markup and CSS.
- The locally added continuous-growth controller has no consumer beyond
  `StreamingMessageGrowth`; both can be removed together while retaining the older
  `createStreamingValueController` for popover height and scroll-position interpolation.
- Only about 20 message fixture/object sites contain `reasoningContent`, concentrated in
  content App, MessageList, and Side Panel tests; making throughput non-optional is
  manageable and gives a reliable persisted contract.
- New direct specs (`provider-runner`, migration 2.2.0, conversation store, throughput
  helper if separate) must be added to ESLint's explicit `allowDefaultProject` list.
- Side Panel owns `.dz-status` and `.dz-secondary` rules next to its composer; after moving
  recovery into metadata, remove only unused Side Panel rules while leaving content
  popover status/retry styling intact.
- `formatMessageTime` currently emits only hour/minute; the approved toolbar explicitly
  requires seconds, so its helper and deterministic locale tests belong in the toolbar
  task.
- Side Panel commands are fire-and-forget and do not insert an optimistic assistant row.
  The authoritative pending transition is the existing `stream.started` event published
  after the assistant row is appended and before provider fetch. Integration tests should
  emit that event and assert dots immediately; no separate temporary ID/state is needed.
- Generic stream errors currently exist both on `latestAssistant.errorMessage` and
  `state.error`; after moving recovery into the message, keep the global banner only for
  errors that are not already owned by the latest assistant, while provider setup keeps
  its dedicated recovery panel.
- `ToolDefinition` uses `isDefault`, `promptMode`, and `customPrompt`, not a `prompt`
  property. Conversation-store plan fixtures should import `DEFAULT_TOOLS[0]` rather than
  hand-author an invalid tool object.

## Side Panel design resource

- `docs/superpowers/specs/2026-08-27-dianzhi-side-panel-message-toolbar-throughput-design.md`

## 2026-08-27 Provider terminal-state debugging

- The captured OpenRouter stream includes both `finish_reason: "stop"` and `data: [DONE]`,
  so the provider is supplying an explicit terminal signal.
- `streamChat` currently awaits `reader.cancel()` after parsing `[DONE]`; a cancellation
  promise that does not settle prevents provider-runner finalization and `stream.done`.
- Provider-runner terminal failures are swallowed by `conversation-manager`'s detached
  `handle.done.catch`, which leaves the visible message in `streaming` without enough
  lifecycle evidence.
- Diagnostic output must include phase, conversation/message IDs, elapsed time, terminal
  status, byte counts, and safe error fields, but never API keys, prompts, or generated text.

## 2026-08-29 CS-to-Side-Panel live-stream handoff investigation

- User-observed symptom: after switching from the Content Script UI to the Side Panel while
  generation continues, the Side Panel receives neither real-time message growth nor the
  terminal transition from `streaming` to `completed`.
- The repository contract assigns authoritative provider runs and Side Panel handoff to the
  background; both UI surfaces render snapshots and live updates.
- Initial hypothesis only: the Side Panel may receive a handoff snapshot but fail to join the
  active live-event route, which would account for both missing deltas and the missing terminal
  event. This must be proven by tracing the publisher, routing identity, port lifecycle, and
  reducer before any product-code fix is proposed.
- `conversation-manager.publish` first applies every update to its in-memory authoritative
  snapshot, then resolves the conversation's tab and calls `publishToOwner`; delivery rejection
  is swallowed. Therefore a later sync can be correct even when every live UI delivery failed.
- Side Panel commands and conversation updates use separate long-lived typed-event ports. The
  panel binds the command port first, then the update port, reports `appeared` using the command
  port's capability, and applies update-port events directly to the conversation reducer.
- `deliverPanel` waits for a Side Panel ready signal only while opening, sends the snapshot
  command, and ownership is committed separately. Whether its readiness dependency covers both
  ports, and whether publication begins before the update port is usable, remains to be checked.
- Confirmed readiness mismatch: `src/background/index.ts` implements `sidePanel.ready` with
  `sidePanelCommand.waitForWindow` only. The separate `sidePanelConversationUpdate` port can still
  be absent when `openPanelWithSnapshot` marks the Side Panel as stream owner.
- Once the panel is marked owner, coordinator publication targets only the update port. A missing
  update port rejects delivery; `conversation-manager.publish` catches and discards that failure,
  so neither the Content Script nor a later reconciliation receives the lost update.
- Provider deltas call publication fire-and-forget, while terminal publication is awaited at the
  provider runner but still appears successful because the manager swallows owner-delivery
  failures. This explains why provider generation and persistence can complete while the panel
  remains on its earlier `streaming` snapshot.
- The reducer itself correctly appends streaming deltas and replaces the assistant row on
  `stream.done`; no rendering-state defect is evident in that layer.
- The handoff snapshot is loaded before panel opening/readiness. `deliverPanel` then destroys the
  Content UI, waits for the command port, sends that stale snapshot, and only after its
  acknowledgement calls `markPanelOwner`. Updates in this interval have no usable destination and
  are not replayed; a terminal event in the interval leaves the panel's snapshot permanently
  `streaming` even though background memory and SQLite are terminal.
- The current focused coordinator/runtime/transport/panel suites all pass (4 files, 89 tests), but
  they test static owner publication and command-port readiness independently; none exercises a
  provider update racing with CS-to-panel handoff.
- The approved product contract requires registration and live updates to share one ordered Side
  Panel channel. The pre-coordinator implementation subscribed the panel before snapshot loading,
  reconciled the current live snapshot, waited for render acknowledgement, and only then hid
  Content. The coordinator refactor removed this ordered handoff barrier.
- Because a correct repair must restore ordering across snapshot delivery, live updates, ownership,
  and Content destruction, the task has upgraded from a bounded fix to an architectural repair.
- Selected design: use one FIFO Side Panel delivery port for snapshot commands and live updates,
  plus an in-memory per-tab handoff route. Content remains the durable owner while the panel opens;
  after readiness, Background posts a fresh snapshot, installs the transient route without yielding,
  waits for render acknowledgement, then removes Content and commits panel ownership.
- Rejected a timing-only dual-port wait because it cannot prove snapshot/update order. Deferred a
  versioned reconciliation protocol because the existing ordered Chrome port can satisfy the
  requirement with less protocol and reducer complexity.
- Design: `docs/superpowers/specs/2026-08-29-lossless-cs-side-panel-stream-handoff-design.md`.
- Implementation plan: `docs/superpowers/plans/2026-08-29-lossless-cs-side-panel-stream-handoff.md`.

## 2026-08-29 project-documentation audit

- Inventory: 35 project Markdown documents plus five preset-prompt Markdown files. The preset
  prompts define provider content, not UI lifecycle. Settings, tool-management, migration, and
  visual-animation documents were scanned for handoff terms and classified as non-authoritative
  for CS-to-Side-Panel ownership.
- `README.md` says `Ctrl+[` hands the current live conversation to the native Side Panel;
  Background owns authoritative state and handoff, while the Side Panel displays the current
  selection's full history.
- The top-level approved product contract (`2026-08-17-dianzhi-complete-extension-design.md`)
  explicitly requires: panel connects and subscribes, loads/reconciles current state, acknowledges
  its first render, and only then Content hides the popover. The provider request continues
  unchanged. It also requires readiness and live updates to share one ordered port.
- The native Side Panel design repeats the same order: subscribe before loading the snapshot;
  persisted snapshot followed by current in-memory state; render acknowledgement; then Content
  hides. Real Chrome acceptance requires no gaps or duplicate stream data.
- The later Content restoration design does not reverse this rule. It says CS-to-Side-Panel
  handoff completes panel rendering first, then atomically sets `latestUI = sidePanel` and clears
  the CS-only restore bookmark. Closing the old CS surface is therefore part of successful
  ownership transfer, not an optional persistent duplicate UI.
- The 2026-08-28 ready-handshake document was deliberately narrower: it fixed command delivery
  before command-port binding and declared streaming `publish` and close flows unchanged. It did
  not validate or restore the original ordered streaming handoff contract.
- The contradiction entered in the 2026-08-27 coordinator implementation plan: its task order
  became open panel, destroy Content, then send the Side Panel render command. That sequence
  conflicts with both the approved 2026-08-17 product contract and the coordinator design's
  failure rule that render failure falls back to Content.
- Documentation precedence for this repair is therefore: approved product behavior and explicit
  ownership invariants first; implementation task ordering and narrow follow-up patches second.
  The repaired success state is unambiguous: Side Panel rendered, Content destroyed,
  `sidePanelAppeared = true`, `contentUIAppeared = false`, `latestUI = sidePanel`, and no
  `contentRestore`. Content survives only during the pre-acknowledgement safety window.
