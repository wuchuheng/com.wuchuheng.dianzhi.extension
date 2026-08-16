# CLAUDE.md

This file provides guidance to Claude Code and Gemini CLI when working with code in this repository.

Treat this file and `.claude/rules/` as the project contract. The local
`.claude/settings.json` file adds Claude Code hooks for dangerous shell command
blocking, generated-path protection, and completion evidence checks.

## Claude Operating Rules

- Anchor every task to the user request, documented spec, or specific module before editing.
- Do not implement adjacent or future scope unless the user approves the scope change.
- Use TDD for production behavior changes when a practical automated test exists.
- Keep construction quality high: readable decomposition, explicit boundaries, typed data, structured errors, and useful comments only.
- Preserve Chrome extension context boundaries between popup, side panel, options, content script, background service worker, and offscreen document.
- Report exact verification commands and results before claiming completion.
- Use `/drift-check` before claiming source, test, config, or new-file work is complete.
- Use `/quality-review` before finishing TypeScript, React, or Chrome extension implementation work.
- Use `/comment-review` whenever adding or changing comments, TSDoc, or public APIs.

Do not edit generated, external, or build-output paths unless the user explicitly requests that path: `node_modules/`, `dist/`, `release/`, `coverage/`, `playwright-report/`, `.chromiumCache/`, and `1.30.3_0/`.

## Overview

Chrome Manifest V3 extension for the WareFlow JinCheng platform. Built with **React 19 + TypeScript 5.8 + Vite 7 + CRXJS + Tailwind CSS 4**.

The extension runs across multiple Chrome contexts, each with its own entry point:

| Context        | Entry Point                | Description                                     |
| -------------- | -------------------------- | ----------------------------------------------- |
| Popup          | `src/popup/index.html`     | Browser action popup                            |
| Side Panel     | `src/sidepanel/index.html` | Chrome side panel UI                            |
| Options        | `src/options/index.html`   | Full-page settings (opens in tab)               |
| Content Script | `src/content/main.tsx`     | Injected into web pages (Shadow DOM isolated)   |
| Background     | `src/background/index.ts`  | Service worker (Manifest V3)                    |
| Offscreen      | `src/offscreen/index.html` | Offscreen document for SQLite/WASM/localStorage |

Key dependencies: `web-sqlite-js` (SQLite via WASM), `react-icons`.

Path alias: `@/` -> `src/`.

## Development Commands

```bash
npm run dev              # Start Vite dev server
npm run build            # TypeScript check + production build
npm run build:debug      # Debug build
npm run typecheck        # TypeScript type checking only
npm run lint             # ESLint + typecheck
npm run lint:fix         # ESLint auto-fix
npm run format           # Prettier format
npm run format:check     # Prettier check
npm run test             # Vitest unit tests
npm run test:coverage    # Vitest with coverage
npm run test:e2e         # Playwright E2E tests
npm run test:e2e:ui      # Playwright with UI
npm run test:e2e:headed  # Playwright headed mode
npm run watch            # nodemon watch + Chromium auto-refresh
```

Hot reload: `./start-chromuim.sh start|refresh`
Build output: `release/crx-{name}-{version}.zip`

## Project Structure

```
src/
├── popup/          # Extension popup UI
├── sidepanel/      # Chrome side panel UI
├── options/        # Full-page settings
├── content/        # Content scripts (Shadow DOM isolation)
├── background/     # Service worker (Manifest V3)
├── offscreen/      # Offscreen document for SQLite/WASM/localStorage
├── events/         # Unified event messaging system
│   ├── internal/   # Core messaging, port-relay, callback-map, factories
│   ├── background/ # Background context adapter
│   ├── extensionPage/ # Extension page context adapter
│   └── contentScript/ # Content script context adapter
├── components/     # Shared React components
├── hooks/          # Custom React hooks
└── utils/          # Shared utilities
```

## Extension Communication

The `src/events/` system provides type-safe messaging across all Chrome extension contexts. Every channel uses a `<source>2<target>` naming convention.

### Context Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                             │
│                                                                     │
│  ┌──────────────┐         ┌──────────────────┐                     │
│  │  Content      │ cs2bg   │  Background (SW)  │                   │
│  │  Scripts      │────────>│                   │                   │
│  │              <──────────│  bg2cs            │                   │
│  └──────┬───────┘ cs2ep   └──┬───────────────┘                     │
│         │────────────────────│─ bg2ep            │                   │
│         │                    │                    │                   │
│         │ ep2cs (via relay)  │  bg2bg (in-memory)│                   │
│         │<=================>│                    │                   │
│         │                    │                    │                   │
│  ┌──────┴───────┐           │  ┌──────────────┐ │                   │
│  │ cs2cs        │           │  │ ep2bg         │ │                   │
│  │ (in-memory)  │           │  │               │ │                   │
│  └──────────────┘           │  └──────────────┘ │                   │
│                             └────────────────────┘                   │
│                                                                     │
│  ┌──────────────────────────────────────────┐                       │
│  │  Extension Pages (popup / sidepanel /     │                     │
│  │  options / offscreen)                     │                     │
│  │                                           │                     │
│  │  ep2bg ──────> Background                 │                     │
│  │  ep2cs ──────> Content Scripts (relay)    │                     │
│  └──────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Available Channels

| Channel | Direction                        | Transport                    | Type        | Defined In       |
| ------- | -------------------------------- | ---------------------------- | ----------- | ---------------- |
| `cs2cs` | Content Script -> Content Script | In-memory (globalThis)       | One-to-one  | `contentScript/` |
| `cs2bg` | Content Script -> Background     | `chrome.runtime.sendMessage` | One-to-one  | `contentScript/` |
| `cs2ep` | Content Script -> Extension Page | `chrome.runtime.sendMessage` | One-to-one  | `contentScript/` |
| `bg2bg` | Background -> Background         | In-memory (globalThis)       | One-to-one  | `background/`    |
| `bg2cs` | Background -> Content Script     | `chrome.tabs.sendMessage`    | One-to-one  | `background/`    |
| `bg2ep` | Background -> Extension Page     | `chrome.runtime.sendMessage` | One-to-one  | `background/`    |
| `ep2bg` | Extension Page -> Background     | `chrome.runtime.sendMessage` | One-to-one  | `extensionPage/` |
| `ep2cs` | Extension Page -> Content Script | Port relay via Background    | One-to-many | `unified-ep2cs`  |

### How to Define and Use an Event

**1. Define the event in `src/events/config.ts`:**

```ts
import * as events from '@/events/index'

// Content script -> Background
export const fetchUserData = events.cs2bg<string, UserData>('fetch:user')

// Background -> Content Script (needs tabId)
export const refreshContent = events.bg2cs<string, void>('refresh')

// Extension Page -> Background
export const getSettings = events.ep2bg<void, Settings>('get:settings')

// Extension Page/Offscreen -> Content Scripts (one-to-many, relayed)
export const notifyContent = events.ep2cs<string, void>('notify:content')
```

**2. Register handlers (the receiving side):**

```ts
// In background service worker (src/background/index.ts):
import { fetchUserData, relayService } from '@/events/config'
import { bg2cs } from '@/events'

fetchUserData.handle(async (userId) => {
  return db.getUser(userId)
})

// Must call once for ep2cs relay to work
relayService()

// In content script (src/content/main.tsx):
import { notifyContent } from '@/events/config'

notifyContent.handle(async (message) => {
  console.log('Got notification:', message)
})

// In extension page (e.g. popup):
import { getSettings } from '@/events/config'

getSettings.handle(async () => {
  return loadSettings()
})
```

**3. Dispatch events (the sending side):**

```ts
// From content script:
const user = await fetchUserData.dispatch('user-123')

// From background to specific tab:
await refreshContent.dispatch({ tabId: 42, data: 'refresh-now' })
// or shorthand: await refreshContent.dispatch(['refresh-now', 42])

// From extension page to background:
const settings = await getSettings.dispatch()

// From extension page/offscreen to ALL content scripts:
const responses = await notifyContent.dispatch('hello all tabs')
```

### How ep2cs Relay Works

Extension pages cannot directly message content scripts. The `ep2cs` channel solves this via a **port relay** through the background service worker:

```
Extension Page ──connect──> Background Relay ──forward──> Content Script 1
                                  │                    ├──> Content Script 2
                                  │                    └──> Content Script N
                            aggregates responses <──────┘
                            resolves promise
```

1. **Background init:** Call `relayService()` once during background startup
2. **Content script:** Calls `.handle()` which opens a long-lived `chrome.runtime.connect` port to background
3. **Extension page:** Calls `.dispatch()` which opens a port to background; background relays the message to all connected content scripts and aggregates responses

**Key:** `ep2cs` uses runtime detection (`ep2cs-env.ts`) so the same event definition works in both contexts — no manual context switching needed.

### Rules

- Always use factory functions from `internal/factories.ts`. Never create event listeners at module level.
- Event names are auto-prefixed with the channel (e.g. `cs2bg:fetch:user`) to prevent collisions.
- Call `relayService()` once in background initialization for `ep2cs` to work.
- Use `events/logger.ts` for logging — no `console.log` in production.

## Code Quality Rules

- TypeScript strict mode — no `any` types
- Prefer pure functions over classes
- Use Tailwind CSS utility classes for styling
- Content scripts must use Shadow DOM for CSS isolation
- Use `events/logger.ts` for logging — no `console.log` in production code
- Use `@/` path alias for imports
- Run `lint:fix` and `format` before committing

## Testing Conventions

- **Unit tests:** Vitest, co-located with source files (`*-test.ts` suffix)
- **E2E tests:** Playwright
- Run `npm run lint && npm run test` before every commit
