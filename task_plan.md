# Task Plan: Provider settings UX refinement

## Goal

Make the AI provider settings easy to configure: separate connection, response behavior, and advanced JSON; keep connection feedback next to the test action; and preserve accessible, correctly associated field errors.

## Current Phase

Phase 4 — complete

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

## Decisions Made

| Decision                                                        | Rationale                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Keep one provider page                                          | The user wants compatibility hidden, not a provider-specific setup wizard.         |
| Use Connection, Response behavior, and Advanced settings groups | Matches the user’s task flow and removes advanced JSON from the default scan path. |
| Keep reasoning strength after the reasoning switch              | It is useful, but should be shown only when it can be acted upon.                  |
| Use inline test status                                          | A connection result must be distinguishable from automatic save status.            |

## Errors Encountered

| Error                                      | Attempt | Resolution                                                                       |
| ------------------------------------------ | ------: | -------------------------------------------------------------------------------- |
| Initial plan-file path typo                |       1 | Corrected before creating project files.                                         |
| Repository-wide lint scans unrelated trees |       1 | Verify changed production files separately and report the repository limitation. |
