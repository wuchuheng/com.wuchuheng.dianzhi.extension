# Progress Log: Provider settings UX refinement

## 2026-08-22

### Phase 1: Discovery

- **Status:** complete
- Reviewed Provider form code, form styles, automatic save flow, and connection test flow.
- Confirmed that the user approved the proposed three-group layout and inline test feedback.

### Phase 2 and 3: UI specification and implementation

- **Status:** complete
- Added failing Options tests for semantic provider groups, collapsed advanced JSON, progressive reasoning strength, and inline connection feedback.
- Implemented native fieldsets, a native advanced-settings disclosure, field-and-error pairing, and a separate connection-test status.

## Test Results

| Test                           | Status                                             |
| ------------------------------ | -------------------------------------------------- |
| Options UI regression tests    | 4 passed                                           |
| Full Vitest suite              | 82 passed                                          |
| TypeScript typecheck           | passed                                             |
| Changed production-file ESLint | passed                                             |
| Production build               | passed outside sandbox; tsx needs a local IPC pipe |

## Error Log

| Error                                                      | Resolution                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Initial plan-file path typo                                | Corrected before any product file was written.                                         |
| Full repository lint includes unrelated skill/vendor trees | Scope verification to changed production files; do not modify unrelated configuration. |
| Large plan correction patch did not match Prettier output  | No partial edit occurred; switch to small exact-context patches.                       |

## 2026-08-27

### Side Panel message toolbar and throughput design

- **Status:** design complete; implementation-plan drafting in progress.
- Confirmed that `followTimeMs: 400` plus `overflow: hidden` delays newly wrapped text.
- Approved natural-height message rendering with scroll-only interpolation and the strict
  `<150px` pre-growth guard.
- Approved immediate pending dots, permanent background-free message metadata, terminal
  estimated `t/s`, and retry only on the latest failed assistant response.
- Added and committed the design document in commit `92234e7` without staging unrelated
  workspace changes.
- Mapped the release registration, message store finalization, current toolbar tests, and
  the locally modified synchronous scroll/height test model for plan decomposition.
- Confirmed there is no direct provider-runner spec and identified the SQLite helper's
  incomplete release chain as a test-harness concern for the new migration.
- Identified the crash-recovery and RPC validation call sites required by a strict final
  throughput field, plus the conditional message-wrapper strategy that avoids changing
  the content popover's no-metadata rendering.
- Counted typed message fixtures, confirmed ESLint's explicit test allow-list, and scoped
  Side Panel-only status/retry CSS cleanup.
- Added the missing `HH:mm:ss` scope, authoritative `stream.started` pending coverage, and
  duplicate message/global-error suppression to the implementation plan.
- Corrected the plan's test-fixture strategy after verifying the exact `ToolDefinition`
  contract.
- Completed the five-task TDD implementation plan and self-reviewed spec coverage,
  placeholder absence, type/signature consistency, whitespace, and dirty-worktree scope.
- User explicitly selected direct implementation on `main`; worktree creation was skipped.

### Side Panel message toolbar and throughput implementation

- **Status:** complete
- Persisted terminal estimated throughput, calculated it at the provider-runner boundary,
  and rendered it after terminal assistant messages.
- Moved message status, copy controls, and latest-failure retry into a permanent
  background-free toolbar under each Side Panel message.
- Removed streaming-message clipping so content paints immediately; Side Panel follows
  natural content growth only while the pre-growth bottom distance is strictly below 150px.
- Verified `pnpm run lint`, `pnpm run test` (33 files / 169 tests), and `pnpm run build`.

### Provider terminal-state hardening

- **Status:** in progress
- Confirmed from the captured OpenRouter SSE that `finish_reason: "stop"` and `[DONE]`
  are both present; investigation moved downstream to reader cleanup and finalization.
- Approved bounded design: non-blocking cancellation, compatible terminal recognition,
  safe stage-by-stage logs, and visible terminal failure evidence.
- RED confirmed: focused tests fail because cancellation blocks completion,
  `finish_reason` is ignored, and terminal persistence rejection escapes without a
  published error state.
- GREEN confirmed: all three focused suites pass after non-blocking cancellation,
  finish-reason completion, terminal fallback publication, and lifecycle logging.
- Full verification passed: lint/typecheck, 34 Vitest files with 172 tests,
  formatting, and the production extension build.

## 2026-08-29

### CS-to-Side-Panel live-stream handoff regression

- **Status:** investigation in progress.
- Classified the diagnosis as an approved spike and the eventual repair as a bounded change
  requiring a short fix-design approval before product-code edits.
- Preserved unrelated `manifest.config.ts` and Chrome Web Store listing worktree changes.
- Confirmed the system boundary: background owns the run and handoff; the Content Script and
  Side Panel consume authoritative snapshots and live events.
- Mapped the initial publication path and found separate Side Panel command/update ports; next
  step is to inspect coordinator ownership timing and the exact ready dependency.
- Confirmed that the ready handshake covers only the command port, while live updates use a
  second port and failed owner delivery is intentionally swallowed upstream.
- Ruled out the Side Panel reducer: its delta and terminal transitions are correct when events
  arrive.
- Ran the current focused baseline: 4 test files and 89 tests passed. The suite has no concurrent
  midstream handoff case, so green status does not cover the reported regression.
- Compared the previous subscriber/handoff implementation and approved product contract. Both
  require an ordered registration/snapshot/live-update channel and render acknowledgement before
  hiding Content; the current coordinator no longer preserves that invariant.
- Upgraded the repair to architectural brainstorming before product-code edits.
- Wrote and self-reviewed the lossless handoff design and a three-task TDD implementation plan.
- The plan unifies Side Panel delivery, adds the transient handoff barrier, preserves Content on
  readiness/render failure, and requires focused, full-suite, build, and real Chrome verification.
- Audited all 35 project Markdown documents plus five preset-prompt Markdown files, then read all
  handoff-relevant contracts and plans in full. The original approved design requires Side Panel
  render acknowledgement before Content closes; the later coordinator implementation plan
  inverted that ordering and created the loss window.
- Clarified the repair's mandatory final state in the design and TDD plan: the temporary overlap
  ends by destroying Content, persisting Side Panel as the sole visible UI, and clearing the
  CS-only restore bookmark.
- **Status:** planning complete; no product code changed.

## 2026-08-31

### Chrome Web Store screenshot revision

- **Status:** complete.
- Reviewed all five existing PNG files at original resolution.
- User approved the consolidated revisions, including real-product UI, larger text, a clearer
  Side Panel benefit, explicit custom-tool creation, and corrected English-immersion typography.
- Re-checked current official Chrome Web Store screenshot guidance and recorded the 640x400
  downscale constraint.
- Initial `pnpm run build` was blocked before compilation because tsx could not create its IPC
  pipe in the sandbox (`listen EPERM`); the retry must use the approved unsandboxed build path.
- Added a deterministic HTML/CSS poster source and Playwright renderer. The first render attempt
  failed before launch because only `@playwright/test` is installed; the renderer now imports its
  Chromium export from that package.
- The corrected renderer reached browser launch, but Chromium was terminated by the managed
  sandbox (`sandbox_host_linux.cc: Operation not permitted`); no PNG was changed by that attempt.
- Exported all five final posters from the deterministic source and inspected each at 1280x800.
- Generated temporary 640x400 copies to verify current Chrome Web Store downscale readability.
- Corrected clipped callouts on posters 03 and 05, added the missing sixth tool row on poster 04,
  and increased poster 04/05 critical copy sizes after the thumbnail review.
- Verified every final file is 1280x800, 8-bit RGB PNG with no alpha channel.
- The first final gate found only Prettier drift in the new HTML/renderer and the accumulated
  task plan; image dimensions, color mode, and `git diff --check` were already clean.

### Planning error log

- A combined self-review patch mixed design-file and plan-file contexts and was rejected before
  any partial edit. Reapplied the corrections as small file-specific patches.

### Chrome Web Store poster header fidelity follow-up

- **Status:** complete.
- User approved the five final subtitles and requested the missing copy, chat, expand, Side Panel,
  and close controls be restored in every poster product header.
- Reconfirmed the exact built-in tool names, shortcut marker placement, and SVG paths from the
  current product source before editing the deterministic poster source.
- Replaced the five subtitles, restored all full tab labels and shortcut indices, and replaced
  placeholder glyphs with the real product SVGs for all five header controls.
- Re-exported all five PNGs and reviewed a 640x400 contact sheet plus the full-size context
  comparison. No label, control, or headline clipping is visible.
- Completed full-size review of the context, Side Panel, custom-tool, and English-immersion
  posters. The product header remains one line and the settings poster stays faithful to its
  separate surface.
- Final checks passed: renderer syntax, Prettier, `git diff --check`, five occurrences of every
  required toolbar icon, and all five outputs at 1280x800 RGB24 with no alpha channel.
