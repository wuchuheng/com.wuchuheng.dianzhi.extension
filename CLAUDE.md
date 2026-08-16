# CLAUDE.md

This repository is the Dianzhi Chrome reading assistant. Treat the approved design in `docs/superpowers/specs/2026-08-17-dianzhi-complete-extension-design.md` as the product contract.

## Commands

Use pnpm:

```bash
pnpm run format:check
pnpm run lint
pnpm run test
pnpm run build
pnpm run test:e2e
```

`pnpm run build` vendors the pinned `web-sqlite-js@2.3.0` assets before TypeScript and Vite. Do not hand-edit generated `dist/` output.

## Runtime boundaries

- Content owns selection/context/placement only.
- Background owns authoritative conversations, provider runs, tab identity and Side Panel handoff.
- Offscreen owns the OPFS SQLite connection and all SQL.
- Side Panel and popover render background snapshots and live updates.
- Options is the durable settings surface; popup only reports status.

Validate all runtime messages. Derive tab identity from Chrome sender metadata. Never add arbitrary-SQL events, remote executable code, Blob workers, an in-memory database fallback, an injected webpage sidebar, a conversation archive, or a new-chat button.

Persistent stream messages must end as `completed`, `error`, or `stopped`, and terminal SQLite writes must finish before terminal UI events are published. Keep API keys out of logs, conversation rows, and error context.
