# Task Plan: Dianzhi extension improvement work

## Goal

Track completed provider/settings work and restore lossless live-message delivery when a conversation moves from the Content UI to the Side Panel.

## Current Phase

Phase 16 — in progress

## Phases

### Phase 1: Confirm existing behavior and UX contract

- [x] Review the provider form, save/test flows, and responsive styles.
- [x] Confirm the user-approved grouping and progressive disclosure behavior.
- **Status:** complete

### Phase 2: Add failing UI tests

- [x] Specify section grouping, advanced-field disclosure, and inline connection status.
- [x] Verify the tests fail against the current view.
- **Status:** complete

### Phase 3: Implement the provider settings refinements

- [x] Restructure the provider form and move test feedback inline.
- [x] Add accessible progressive disclosure for advanced JSON.
- [x] Add styles for the new visual hierarchy and field-error pairing.
- **Status:** complete

### Phase 4: Verify

- [x] Run focused UI tests, full tests, typecheck, targeted lint, formatting, and build.
- [x] Inspect the final diff for unrelated changes.
- **Status:** complete

### Phase 5: Approve Side Panel message-toolbar design

- [x] Confirm pending, terminal throughput, toolbar states, and retry scope.
- [x] Remove artificial message-height reveal delay from the approved architecture.
- [x] Commit the approved design as `92234e7`.
- **Status:** complete

### Phase 6: Write implementation plan

- [x] Map current Side Panel, shared message UI, provider runner, and SQLite boundaries.
- [x] Write the TDD implementation plan with exact interfaces, tests, and commits.
- [x] Self-review the plan against the approved design.
- **Status:** complete

### Phase 7: Implement Side Panel message toolbar and throughput

- [x] Task 1: Persist the terminal throughput contract.
- [x] Task 2: Calculate throughput at the provider-runner boundary.
- [x] Task 3: Build the permanent message toolbar.
- [x] Task 4: Remove message clipping and animate scroll only.
- [x] Task 5: Run automated gates and build verification.
- **Status:** complete

### Phase 8: Make provider terminal delivery observable and non-blocking

- [x] Add failing tests for a non-resolving stream cancellation and terminal lifecycle logs.
- [x] Complete on `finish_reason`/`[DONE]` without awaiting stream cancellation.
- [x] Log stream parsing, checkpoint, finalization, publication, and terminal failures safely.
- [x] Verify focused tests, full quality gates, and the production build.
- **Status:** complete

### Phase 9: Diagnose CS-to-Side-Panel live-stream handoff regression

- [x] Trace one active request from provider publication through UI-session routing and Side Panel state reduction.
- [x] Compare snapshot synchronization with live delta and terminal-event subscription during the handoff.
- [x] Confirm the existing focused suites pass while omitting concurrent midstream handoff coverage.
- [x] Identify the root cause and upgrade the repair from bounded to architectural scope.
- **Status:** complete

### Phase 10: Design a lossless ordered handoff repair

- [x] Confirm the required behavior: current message, later tokens, and terminal status must survive the switch.
- [x] Compare ordered single-channel restoration with timing-only and versioned-reconciliation alternatives.
- [x] Select one ordered panel channel plus a transient background handoff barrier.
- [x] Write and self-review the design specification and executable TDD implementation plan.
- **Status:** complete

### Phase 11: Audit project documentation and resolve handoff semantics

- [x] Inventory every project Markdown document and classify its relevance to UI ownership.
- [x] Read every relevant product contract, design, implementation plan, and follow-up repair.
- [x] Locate the destroy-before-render contradiction in the coordinator implementation plan.
- [x] Amend the repair design and tests with the mandatory final state: Side Panel owns and CS is closed.
- **Status:** complete

### Phase 12: Revise five Chrome Web Store screenshots

- [x] Capture or reconstruct the current extension UI from real product components.
- [x] Recompose all five 1280x800 screenshots with the approved user-focused copy.
- [x] Make custom-tool creation explicit and correct the English-immersion typography.
- [x] Verify full-size files, 640x400 readability, color mode, alpha, and final ordering.
- **Status:** complete

### Phase 13: Align poster copy and toolbars with the approved product message

- [x] Replace all five subtitles with the approved context-first learning benefits.
- [x] Restore the full built-in tool labels and their compact index markers.
- [x] Add the real copy, chat, expand, Side Panel, and close SVG controls to every product header.
- [x] Re-export and inspect all five posters at 1280x800 and the 640x400 store-preview size.
- **Status:** complete

### Phase 14: Audit the complete runtime lifecycle for Side Panel follow-ups

- [x] Inventory entry points, event transports, durable/transient state, provider execution, persistence, and UI reducers.
- [x] Trace cold-start, warm handoff, worker suspension/restart, port disconnect/reconnect, follow-up, stop, and terminal delivery.
- [x] Compare implementation, tests, prior designs, and Chrome MV3 lifecycle requirements.
- [x] Confirm the root cause and identify every affected contract without changing runtime code.
- **Status:** complete

### Phase 15: Design and plan the lifecycle-safe repair

- [x] Present repair approaches and trade-offs for user review.
- [x] Obtain approval for the architectural design before writing the specification.
- [x] Write and self-review the approved design specification.
- [x] Obtain user review of the written specification.
- [x] Produce a detailed TDD implementation plan using the writing-plans workflow.
- **Status:** complete

### Phase 16: Implement and verify the lifecycle-safe repair

- [x] Recover orphaned selection-session streams.
- [x] Add reconnectable shared-identity Side Panel ports.
- [x] Join both ports into a generation-safe logical session.
- [x] Add recovering routes and ordered panel attachment.
- [x] Gate Background commands on restored, ready sessions.
- [x] Expose real readiness in the Side Panel UI.
- [x] Prove the restart-follow-up path through composed recovery, admission, and UI tests.
- [ ] Add real Chromium lifecycle acceptance and run final verification.
- **Status:** in_progress

## Decisions Made

| Decision                                                        | Rationale                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Keep one provider page                                          | The user wants compatibility hidden, not a provider-specific setup wizard.           |
| Use Connection, Response behavior, and Advanced settings groups | Matches the user’s task flow and removes advanced JSON from the default scan path.   |
| Keep reasoning strength after the reasoning switch              | It is useful, but should be shown only when it can be acted upon.                    |
| Use inline test status                                          | A connection result must be distinguishable from automatic save status.              |
| Render Side Panel stream content at natural height              | Text must paint immediately; smooth scrolling must not gate visibility.              |
| Show throughput only after a terminal state                     | Avoid a noisy live estimate and preserve one stable result.                          |
| Retry only the latest failed assistant message                  | Matches the approved recovery affordance and avoids branching old history.           |
| Implement directly on `main`                                    | Explicit user instruction after worktree isolation was offered.                      |
| Log terminal lifecycle metadata without generated text          | Gives actionable diagnostics without leaking prompts, responses, or credentials.     |
| Use one ordered Side Panel delivery channel                     | Snapshot render and later deltas need one FIFO boundary to avoid gaps or duplicates. |
| Keep Content until panel render acknowledgement                 | A failed open or render must leave the active conversation usable.                   |
| Recover normal MV3 worker suspension, not an in-flight network request after full restart | An open Side Panel must self-heal after Background wake; browser/extension restart restores persisted terminal state and treats interrupted work as stopped. |
| Reconnect the existing two ports as one logical panel session | Preserves the ordered conversation channel while adding shared identity, readiness, replay, and lifecycle recovery with less regression risk than a universal-port migration. |

## Errors Encountered

| Error                                                           | Attempt | Resolution                                                                             |
| --------------------------------------------------------------- | ------: | -------------------------------------------------------------------------------------- |
| Initial plan-file path typo                                     |       1 | Corrected before creating project files.                                               |
| Repository-wide lint scans unrelated trees                      |       1 | Verify changed production files separately and report the repository limitation.       |
| Large plan self-review patch missed formatted context           |       1 | Split the correction into small, line-local patches after inspecting exact text.       |
| Combined provider-plan correction assumed duplicated sed output |       2 | Inspect numbered source lines and patch the test and implementation blocks separately. |
| Plan audit shell pattern contained a raw backtick               |       1 | Remove the backtick from the regex and rerun the read-only audit.                      |
| Combined self-review patch mixed design and plan contexts       |       1 | Split corrections into small file-specific patches; no partial edit occurred.          |
| Sandboxed build blocked tsx IPC pipe with EPERM                 |       1 | Re-run the existing build outside the sandbox; no source failure was observed.         |
| Renderer imported unavailable direct `playwright` package       |       1 | Use the installed `@playwright/test` package export instead.                           |
| Playwright Chromium was terminated by the managed sandbox       |       1 | Re-run only the renderer outside the sandbox with its isolated temporary profile.      |
| Final source-format check reported three unformatted files      |       1 | Apply project Prettier, re-render, and repeat image and source verification.           |
| One combined HTML patch targeted the same file twice            |       1 | Split the no-op rejected patch into small CSS and markup patches.                      |
| Combined Phase 14 planning patch used the template progress heading | 1 | Inspect the project-specific heading and apply small file-specific patches.         |
| Combined Phase 15 tracking patch assumed completed checkboxes | 1 | Inspect the exact current phase text and apply an exact-context patch; no partial edit occurred. |
