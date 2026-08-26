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
