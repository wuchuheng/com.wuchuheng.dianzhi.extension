---
paths:
  - 'src/**/*.ts'
  - 'src/**/*.tsx'
  - 'tests/**/*.ts'
---

# Comment And Documentation Rules

Comments must improve understanding. Do not add comments to decorate code.

## Required Comments

- Public cross-module types and functions need concise TSDoc when their contract is not obvious from the name and signature.
- Non-obvious invariants, ordering constraints, browser-context assumptions, security boundaries, and failure mappings should have short comments.
- Any intentional limitation must say why it exists and where the durable contract lives.

## Forbidden Comments

- Do not restate the code.
- Do not leave stale `TODO`, speculative future plans, or vague notes.
- Do not explain deferred architecture inside implementation files unless current code depends on that boundary.
- Do not use comments to excuse unclear code. Improve the code first.

## Review Rule

If a comment is needed because code is hard to follow, first ask whether a better name, smaller function, or clearer type would remove the need for the comment.
