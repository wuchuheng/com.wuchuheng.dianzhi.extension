# Task Plan: Provider settings UX refinement

## Goal

Make the AI provider settings easy to configure: separate connection, response behavior, and advanced JSON; keep connection feedback next to the test action; and preserve accessible, correctly associated field errors.

## Current Phase

Phase 8 — complete

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

## Decisions Made

| Decision                                                        | Rationale                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Keep one provider page                                          | The user wants compatibility hidden, not a provider-specific setup wizard.         |
| Use Connection, Response behavior, and Advanced settings groups | Matches the user’s task flow and removes advanced JSON from the default scan path. |
| Keep reasoning strength after the reasoning switch              | It is useful, but should be shown only when it can be acted upon.                  |
| Use inline test status                                          | A connection result must be distinguishable from automatic save status.            |
| Render Side Panel stream content at natural height              | Text must paint immediately; smooth scrolling must not gate visibility.            |
| Show throughput only after a terminal state                     | Avoid a noisy live estimate and preserve one stable result.                        |
| Retry only the latest failed assistant message                  | Matches the approved recovery affordance and avoids branching old history.         |
| Implement directly on `main`                                    | Explicit user instruction after worktree isolation was offered.                    |
| Log terminal lifecycle metadata without generated text          | Gives actionable diagnostics without leaking prompts, responses, or credentials.   |

## Errors Encountered

| Error                                                           | Attempt | Resolution                                                                             |
| --------------------------------------------------------------- | ------: | -------------------------------------------------------------------------------------- |
| Initial plan-file path typo                                     |       1 | Corrected before creating project files.                                               |
| Repository-wide lint scans unrelated trees                      |       1 | Verify changed production files separately and report the repository limitation.       |
| Large plan self-review patch missed formatted context           |       1 | Split the correction into small, line-local patches after inspecting exact text.       |
| Combined provider-plan correction assumed duplicated sed output |       2 | Inspect numbered source lines and patch the test and implementation blocks separately. |
| Plan audit shell pattern contained a raw backtick               |       1 | Remove the backtick from the regex and rerun the read-only audit.                      |
