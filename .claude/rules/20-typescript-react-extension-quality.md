---
paths:
  - 'src/**/*.ts'
  - 'src/**/*.tsx'
  - 'tests/**/*.ts'
  - 'manifest.config.ts'
  - 'vite.config.ts'
  - 'vitest.config.ts'
  - 'playwright.config.ts'
---

# TypeScript React Extension Quality Rules

Use Code Complete-style construction discipline for TypeScript, React, and Chrome extension code.

## Structure

- Keep modules cohesive and small enough to understand without paging through unrelated behavior.
- Prefer typed domain objects over loose strings, untyped maps, and positional tuples.
- Keep public module APIs narrow; keep implementation details private to the owning module.
- Separate parsing, validation, Chrome API access, storage, event transport, and UI rendering.
- Use the established `src/events/` factories for cross-context messaging.
- Keep content script UI mounting and Shadow DOM concerns out of shared React components.

## Readability

- Prefer straightforward control flow over clever abstractions.
- Use names that reveal intent and extension context.
- Make error paths as readable as success paths.
- Avoid hidden global state except where a Chrome extension context requires it.
- Keep React components focused on rendering and interaction orchestration.

## Errors

- Validate inputs at module boundaries, especially messages crossing extension contexts.
- Return or throw structured errors with enough context for tests and users.
- Avoid `any`; use `unknown` plus narrowing when the input shape is not trusted.
- Avoid production `console.log`; use `src/events/logger.ts` or a local logging abstraction.

## Tests

- Unit-test pure logic and event adapters close to their modules.
- Use E2E tests for browser-context behavior that unit tests cannot model.
- Do not rely on an E2E test as the only proof of lower-level parsing, validation, or messaging behavior.
