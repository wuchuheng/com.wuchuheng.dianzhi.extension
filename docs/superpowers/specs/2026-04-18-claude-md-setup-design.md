# CLAUDE.md Setup Design

**Date:** 2026-04-18
**Status:** Approved

## Goal

Create a single source-of-truth AI instruction file (`CLAUDE.md`) for the project, with `GEMINI.md` as a symlink pointing to it. Both Claude Code and Gemini CLI will read the same content.

## Decisions

| Decision             | Choice                                        |
| -------------------- | --------------------------------------------- |
| Source-of-truth file | `CLAUDE.md`                                   |
| Symlink file         | `GEMINI.md -> CLAUDE.md`                      |
| Other AI tools       | Claude Code + Gemini CLI only                 |
| Language             | English                                       |
| Scope                | Comprehensive guide                           |
| Approach             | Single file with section anchors (Approach A) |
| SDLC reference       | Reference agent-docs/ from global plugin      |

## CLAUDE.md Structure

The file will contain these sections:

### Section 1 — Overview & Architecture

- Project identity: Chrome Manifest V3 extension for WareFlow JinCheng platform
- Tech stack: React 19 + TypeScript 5.8 + Vite 7 + CRXJS + Tailwind CSS 4
- Extension entry points: popup, sidepanel, options, content scripts, background service worker, offscreen document
- Key dependencies: `web-sqlite-js`, `react-icons`
- Path alias: `@` -> `src/`
- Multi-context architecture and how each entry point runs in a different Chrome context

### Section 2 — Development Commands

All npm scripts documented with descriptions:

- `dev`, `build`, `build:debug`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`
- `test`, `test:coverage`, `test:e2e`, `test:e2e:ui`, `test:e2e:headed`
- `watch` (nodemon + Chromium auto-refresh)
- Hot reload: `./start-chromuim.sh start|refresh`
- Build output: `release/crx-{name}-{version}.zip`

### Section 3 — Project Structure

Document `src/` directory layout with each directory's responsibility:

- `popup/`, `sidepanel/`, `options/` — Extension UI pages
- `content/` — Content scripts with Shadow DOM isolation
- `background/` — Service worker (Manifest V3)
- `offscreen/` — Offscreen document for SQLite/WASM/localStorage
- `events/` — Unified event messaging system (ep2cs pattern)
- `components/`, `hooks/`, `utils/` — Shared modules

### Section 4 — Extension Communication Pattern

Document the `src/events/` system:

- Unified `ep2cs` pattern: one API for all extension contexts
- Runtime environment detection via `ep2cs-env.ts`
- Internal modules: `factories.ts`, `messaging.ts`, `port-relay.ts`, `callback-map.ts`
- Rule: use factory functions, not module-level event creation

### Section 5 — Code Quality & AI Coding Rules

Practical rules:

- TypeScript strict mode, no `any`
- Functional preference: pure functions over classes
- Tailwind CSS utility classes
- Shadow DOM for content scripts
- Use `events/logger.ts`, no `console.log` in production
- Use `@/` path alias
- Run `lint:fix` and `format` before committing

### Section 6 — Testing Conventions

- Unit tests: Vitest, co-located with source (`*-test.ts` suffix)
- E2E tests: Playwright
- Run `lint && test` before commit

### Section 7 — Agent-Docs Reference

- Global 8-stage SDLC plugin available via `$CLAUDE_CONFIG_DIR`
- Project-level `agent-docs/` for stage outputs
- Follow spec-first workflow when available

### Section 8 — Symlink Setup

- `GEMINI.md -> CLAUDE.md` (relative symlink)
- One file to maintain, both tools read the same content

## Implementation Steps

1. Write `CLAUDE.md` at project root with all 8 sections
2. Create `GEMINI.md` as a relative symlink to `CLAUDE.md`
3. Verify symlink works for both tools
