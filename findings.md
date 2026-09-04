# Findings: Provider settings UX refinement

## 2026-09-04 Side Panel follow-up lifecycle audit

- User requested a whole-project analysis followed by an appropriate implementation plan for the newly diagnosed Side Panel follow-up streaming failure.
- Scope is architectural because correctness spans MV3 worker startup/suspension, two Side Panel ports, UI-session ownership, command routing, provider publication, authoritative snapshots, and test/runtime verification.
- No runtime code will change during the audit and design-approval stages.
- Initial source-backed hypothesis: after Background suspension, the already-open Side Panel does not reconnect its typed ports or repeat its appeared report; coordinator initialization restores persisted presence but not `panelActiveTab` or the transient Side Panel delivery route. A one-shot follow-up command still returns a streaming snapshot, while live updates fall back toward destroyed Content and their delivery failure is swallowed.
- A stop command later returns the newest authoritative snapshot, explaining why accumulated text and terminal status appear on click.
- Repository inventory confirms five runtime contexts: MV3 Background service worker, Content Script React UI, native Side Panel React page, Options/Popup extension pages, and an offscreen SQLite owner. The affected path is Background + Content + Side Panel + offscreen persistence; Options and Popup are not stream owners.
- Event configuration uses one-shot `cs2bg`/`ep2bg` channels for commands, a content-specific update relay, and two independent `bg2sp` ports for Side Panel control and conversation updates.
- `src/background/index.ts` installs command and runtime listeners synchronously, then starts reconciliation and `coordinator.initialize()` in a detached async task. A wake-up command can therefore be handled before stored UI-session state has finished loading.
- Current Git history places the new symptom directly after `db79f8a`, the lossless warm-handoff fix; later commits only affect store posters and the English prompt.
- Working tree contained only the three planning files changed for this audit; no pre-existing product-code edits were present.
- Coordinator state has two layers: `TabSessionState` is persisted in `chrome.storage.session`, while `panelWindows`, `panelActiveTab`, `deliveryRoutes`, handoff epochs, queues, and current-page caches are process-local maps/sets.
- `initialize()` restores `tabStates`, `currentPages`, `panelWindows`, and Content routes. For a stored Side Panel owner it restores only `panelWindows`; it does not restore `panelActiveTab` or a Side Panel delivery route.
- `publish()` first uses a transient route, then falls back to `panelOwnsTab`, which requires the missing `panelActiveTab`. A restored panel state consequently returns `false` until a new panel status or tab-activation event reconstructs ownership.
- Runtime registration accepts Side Panel ports but treats port binding as transport-only evidence; it does not notify the coordinator that the newly bound panel owns its tab/window.
- `onPanelOpened()` records only window-level presence and marks every state in that window as appeared. It does not establish the active tab or delivery route, so replaying an open event alone is insufficient.
- Reconciliation validates stored tab/window/URL identity but does not query or reconcile the currently active tab per open panel window.
- `bg2sp.handle()` creates exactly one `chrome.runtime.connect` port, posts one binding, and returns a cancel function. It has no client-side `port.onDisconnect` listener, reconnect loop, readiness callback, or resynchronization request.
- Background-side `bg2sp.accept()` correctly removes dead bindings and rejects pending deliveries on disconnect, but recovery depends on the Side Panel creating and binding a replacement port.
- The command and update event families each create their own port and independent `panelInstanceId`. Panel lifecycle/status uses the command-port capability; update readiness uses the update port. Recovery must coordinate both without assuming cross-port ordering.
- Side Panel command results are always reconciled through `conversation.sync`; this is a valid command acknowledgement path but also masks missing live transport by revealing Background's accumulated authoritative snapshot on the next command.
- Side Panel reducer tests prove `stream.delta` and terminal updates render correctly when delivered. They do not simulate port disconnect/reconnect, Background reconstruction, or a follow-up command after worker suspension.
- Existing port tests cover ordering, acknowledgement, targeted windows, disconnect rejection, and readiness waits only on the Background endpoint. They do not cover client reconnection or post-rebind snapshot synchronization.
- Content and Side Panel share the same command semantics and reducer, but only Content has a tab-addressable fallback transport. After successful handoff Content is deliberately destroyed, so falling back to Content is invalid for a persisted Side Panel owner.
- Conversation Manager deliberately applies every update to `liveSnapshots` before attempting UI delivery, then suppresses any owner-delivery rejection. This preserves recoverable state but makes transport loss invisible to the provider runner and operator.
- Follow-up creation publishes `stream.started` before starting the provider request and returns a live snapshot through the one-shot command response. Thus the Side Panel can show the new pending assistant even when its update port is absent.
- Provider deltas publish asynchronously and terminal updates publish after SQLite finalization. Because manager publication absorbs delivery errors, provider completion and persistence remain successful while the visible UI stays stale.
- `stream.stop` loads the current live snapshot, requests abort, and immediately returns that pre/post-run snapshot without waiting for finalization. If the provider already completed, this fresh command snapshot includes completed text/status; if it has not, the panel may still require a later terminal event.
- SQLite/offscreen persistence is not the loss point: append, checkpoint, and finalization remain authoritative and survive Background reconstruction. A restart during an active provider run is separately recovered as `stopped`; the reported issue concerns a new run started after a prior handoff.
- Manager tests cover follow-up conversation normalization, snapshot precedence, stopping, and publisher invocation, but treat `publishToOwner` as an always-successful stub. They do not combine a cold coordinator, destroyed Content, an open panel, and live provider events.
- The original approved architecture explicitly requires the Side Panel page to connect, load the active snapshot, subscribe to live events, and support follow-ups across worker recovery. It also requires real-Chrome verification of OPFS restart recovery and Side Panel follow-ups.
- The later coordinator design says `chrome.storage.session` is the recovery store for service-worker suspension while window-panel presence is runtime-only and must be reconstructed from Side Panel events and port lifecycle. Current code reconstructs neither the active-tab owner nor the live route from a new port binding.
- The 2026-08-29 lossless-handoff design explicitly declared persistence of transient delivery routes across a worker restart out of scope. The new issue is therefore an uncovered lifecycle boundary, not a regression inside the warm-handoff algorithm.
- Existing coordinator owner-publication tests call `reportPanelStatus('appeared')` after `initialize()` before asserting panel delivery. This manually supplies the recovery event missing from the real already-mounted panel after worker restart.
- Existing runtime tests verify that both port families are accepted on `runtime.onConnect`, but not that a binding reconstructs coordinator ownership, waits for initialization, or triggers snapshot replay.
- No automated test mentions Side Panel client reconnect, Background suspension, or a follow-up after restart. The current green suite cannot reject the observed failure.
- Current Chrome documentation confirms MV3 service workers are repeatedly terminated after inactivity and global variables must not be treated as durable state. Since Chrome 114, opening a long-lived port no longer resets the worker timer; sending messages does.
- Chrome's Side Panel is a persistent extension page that can remain open across active-tab changes. `sidePanel.getOptions()` reports configuration, not whether a particular panel page currently has a usable bound update channel, so port binding remains the correct live-capability evidence.
- `storage.session` survives service-worker suspension but is cleared on extension reload/update/disable and browser restart. It is appropriate for tab-session intent, but a stored `sidePanelAppeared` flag cannot by itself prove a currently connected panel port.
- A permanent Background keepalive is not the appropriate repair. The lifecycle-native design is to make ports reconnectable and reconstruct routing from live capability plus validated stored/current-tab state.
- The repository contract and README agree that Background owns authoritative conversation state and Side Panel handoff; the Side Panel is a renderer/command surface, so repairing this in React state alone would violate the existing architecture.
- The standard project gates are format, lint/typecheck, Vitest, production build, and Playwright E2E with a real unpacked extension, OPFS SQLite, and mock SSE provider. The final repair plan must include both deterministic lifecycle tests and real-Chromium acceptance.
- There is no Background-wide readiness barrier in the current entrypoint. Runtime listeners become callable before coordinator and manager initialization completes, which is a second cold-wake race independent of the missing Side Panel reconnect.
- The existing dual-port transport already preserves FIFO and acknowledgements independently per port, but its Side Panel client `handle()` is strictly single-use: disconnect removes the Background binding and nothing creates a replacement until the React page remounts.
- Side Panel marks itself connected and reports `appeared` immediately after calling `handle()`, before Background has acknowledged either binding. The UI therefore has no transport-ready state that can gate follow-up sends or trigger authoritative resynchronization.
- `runtime.onConnect` only delegates port acceptance and logs receipt. It does not await Background initialization, bind the live capability into coordinator ownership, or replay a snapshot.
- Chrome lifecycle callbacks also call the coordinator without awaiting startup restoration. A tab/panel event racing `initialize()` can mutate maps that `initialize()` subsequently clears.
- The configured Playwright test directory `tests/e2e` does not currently exist, despite the README describing an unpacked-extension/mock-SSE E2E path. Real-Chromium lifecycle coverage will need to be added or the documentation corrected as part of the eventual implementation plan.
- Full current baseline is green for TypeScript and unit/component tests: 42 Vitest files and 296 tests passed. This confirms the defect is an uncovered lifecycle scenario rather than a currently failing reducer, provider, or persistence test.
- Repository-wide `format:check` is already red in four committed source/test files plus the newly edited `task_plan.md`. These formatting findings are unrelated to the runtime defect and should be reported, not silently broadened into the repair.
- Phase 14 conclusion: the bug requires one lifecycle-safe Side Panel session contract that (1) reconnects after Background/port loss, (2) waits for Background restoration, (3) re-establishes the validated active-tab delivery route, and (4) replays an authoritative snapshot before accepting or displaying a send-ready state.
- Recovery scope selected for Phase 15: transparently recover ordinary MV3 Background suspension/restart while the already-open Side Panel remains alive. A full browser or extension restart may restore persisted conversation history, but an interrupted provider request is finalized/recovered as stopped rather than resumed as if its original network stream survived.
- Design self-review found that `ConversationManager.initialize()` is currently a no-op and only direct conversation loading converts an orphaned persisted `streaming` row to `stopped`; selection-session loading does not. The recovery design now explicitly unifies these load semantics so panel rebind cannot revive a permanently pending row after actual worker termination.
- The design distinguishes transport-only disconnect from worker termination: the former can replay all accumulated in-memory deltas, while the latter can only recover the latest persisted checkpoint as `stopped` because the original fetch and live snapshot are gone.
- The approved and self-reviewed architecture is recorded in `docs/superpowers/specs/2026-09-04-side-panel-worker-recovery-design.md` and committed as `b6171cc`. Runtime implementation remains gated on the required written-spec review and the subsequent detailed TDD plan.
- The user approved the written specification. The executable plan is `docs/superpowers/plans/2026-09-04-side-panel-worker-recovery.md`, decomposed into eight TDD units covering snapshot recovery, transport reconnect, logical session state, coordinator routing, startup/command admission, UI readiness, integrated regression, and real Chromium acceptance.
- Plan self-review corrected two interface gaps before execution: registry synchronization now records Background's current active-tab binding rather than the mount-time tab, and Conversation Manager receives/enforces a trusted `authorizedTabId` for Side Panel commands instead of treating all extension-page conversations as unrestricted.

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

## 2026-08-31 Chrome Web Store screenshot revision

- Five 1280x800 screenshots exist under `public/`; their editorial cream and terracotta campaign
  is visually consistent, but the internal browser scenes are conceptual rather than verified
  captures of the current extension.
- Chrome Web Store guidance says screenshots should demonstrate the current actual user experience
  and are downscaled to 640x400, so small explanatory copy and dense UI must not carry the message.
- Approved upload narrative: core selection flow, context differentiation, continued questioning,
  English immersion, then advanced custom-tool creation.
- Screenshot 4 currently proves prompt editing but does not prove that users can add a new custom
  tool. The revision must show an add action, tool naming, template editing, and a saved custom tool.
- Screenshot 5 contains generated IPA typography that is not reliable enough for a store asset;
  it must be typeset deterministically or removed.
- Final implementation uses a deterministic HTML/CSS source and Playwright element screenshots,
  keeping exact Chinese, English, prompt variables, one-line product headers, and brand tokens.
- Upload order is encoded visually as 01 context, 02 contrast, 03 Side Panel, 04 English
  immersion, 05 custom tools; the historical filenames for images 04 and 05 remain unchanged.
- The custom-tools composition shows all five built-ins, one created custom tool, the new-tool
  control, tool configuration, exact template variables, and autosave state.
- The English-immersion composition omits IPA rather than risking a wrong store asset and retains
  exactly one Chinese translation line inside the English explanation content.

## 2026-08-31 poster header fidelity follow-up

- The approved final subtitles now describe the learner outcome directly: one context-specific
  meaning, different meanings across contexts, contextual follow-up dialogue, user-created tools,
  and English-first immersion with one Chinese calibration line.
- The current poster mockups use placeholder square glyphs and omit toolbar controls. The real
  product header exposes copy, chat, expand, native Side Panel, and close as five consistent
  16px outline SVG icons.
- All five built-in labels must remain visible in poster headers: 语境, 同义词, 翻译, 词典,
  and 英英释义. Their small numeric shortcut markers sit at the lower-right of each tab.
- The local icon-design lookup had no result for a combined compact-toolbar query; a narrower
  lookup confirmed outline copy and close semantics. Exact product SVGs remain the authoritative
  source for every toolbar icon.
- The first re-export keeps all five labels and all five controls visible in one header row at
  both full resolution and the 640x400 store-preview size. The two-column context comparison
  remains immediately scannable after the added controls.
- The settings poster correctly remains a settings screen rather than inventing a popover toolbar;
  the other four product surfaces now use the complete authentic toolbar.
- Full-size review of posters 01 and 03 confirms the one-line header remains visually subordinate
  to the explanation/conversation content while preserving every tool and action. Widening the
  Side Panel to 535px prevents toolbar compression without obscuring the selected source phrase.
- Full-size review of posters 04 and 05 confirms the custom-tool variables remain prominent and
  the English-first explanation retains only one Chinese translation line. The longer approved
  subtitles fit on one line without competing with the headline.
