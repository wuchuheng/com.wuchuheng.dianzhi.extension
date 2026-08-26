# Dianzhi Shared Smooth Height + Provider Setup Design

Status: approved via collaborative brainstorming (2026-08-27). Extracts the content
popover's smooth panel-height animation into a shared hook and adds an inline
provider-setup ("login") panel that both the popover and the Side Panel render — the
popover keeps its max-height cap, the Side Panel grows without one.

## 1. Goal

The content-script popover animates its panel height smoothly as content grows
(`createStreamingValueController` driving `onHeightChange`). Today that animation logic
is a hook private to the popover (`src/content/views/use-streaming-height-controller.ts`),
and when the AI provider is unconfigured both surfaces only show a banner with an
"打开设置" button — there is no in-place setup.

Two requirements:

1. **Share the smooth-height logic**: extract the popover's height animation into a
   shared hook that any caller can reference, with the **max-height cap optional** (the
   popover caps at 560px; the Side Panel is a full-height page and needs no cap).
2. **Handle provider setup from the UI**: when the provider is unconfigured
   (`PROVIDER_NOT_CONFIGURED`), both the popover and the Side Panel render a compact
   inline setup panel in place of the plain banner. The popover grows smoothly to fit it
   (capped); the Side Panel's panel grows to fit it with no cap, via the same shared hook.

## 2. Decisions

| Decision              | Choice                                                                                     | Rationale                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Shared unit           | `useStreamingHeight` extracted from `use-streaming-height-controller.ts` (deleted)          | One animation model for every "grow to fit content" surface                                          |
| Bounds                | `minimumHeight?: number` = 0, `maximumHeight?: number` = `Infinity`                         | "No cap needed in the Side Panel" is the default; the popover passes its 280/560 anyway              |
| Consumer component    | `ProviderSetup` rendered by both surfaces on `PROVIDER_NOT_CONFIGURED`                     | A shared grow-capable React element is the Side Panel's reason to reference the hook                 |
| Setup fields          | `apiKey` + `baseUrl` + `model` (minimum to unblock a provider run)                          | Full Options-page parity is a non-goal                                                               |
| Settings plumbing     | Reuse `settings.get` / `settings.save` via each host's adapter                              | `contentSettingsCommand` (popover) and `settingsCommand` (Side Panel) already exist; no new protocol |
| After save            | Host dismisses the panel; the user presses 重试 to re-run with the new config               | Existing retry path re-drives the provider run                                                       |
| Popover cap           | Unchanged (`minimumHeight` 280, `maximumHeight` `min(560, innerHeight − 16)`)               | Existing behavior preserved                                                                          |
| Reduced motion        | Jump straight to the measured height, no rAF glide                                          | Same rule as today                                                                                   |

## 3. Architecture

No protocol, background, offscreen, or manifest changes. Pure UI: one shared hook, one
shared component, and wiring in the two hosts.

### 3.1 Shared hook (`src/dianzhi/ui/use-streaming-height.ts`, new)

Extracted verbatim from the popover's controller hook except the rename
`panelRef` → `elementRef` and optional bounds. The caller owns where the animated value
is applied (popover: `panelHeight` state → the panel's `style.height`; Side Panel: a local
`setupHeight` state → the setup element's `style.height`).

```ts
interface UseStreamingHeightOptions {
  elementRef: RefObject<HTMLElement | null>
  visible: boolean
  /** Any change re-measures the element's natural height and re-chases it. */
  targetVersion: unknown
  minimumHeight?: number // default 0
  maximumHeight?: number // default Infinity
  reducedMotion: boolean
  onHeightChange(height: number): void
}
export function useStreamingHeight(options: UseStreamingHeightOptions): void
```

Internals are unchanged: set `element.style.height = 'auto'`, read `offsetHeight`, restore
the previous height; clamp to `[minimumHeight, maximumHeight]`; on first visible instance
the target is applied instantly; otherwise `observeTarget` + a rAF `advance` loop (rate
adaptive through the shared `createStreamingValueController`); reduced motion jumps;
unmount cancels the frame.

### 3.2 Popover migration (`src/content/views/App.tsx`)

Replace the `useStreamingHeightController` call with:

```tsx
useStreamingHeight({
  elementRef: panelRef,
  visible: state.visible,
  targetVersion: [state.snapshot, state.expanded, state.mode],
  minimumHeight: 280,
  maximumHeight: maximumPanelHeight, // Math.min(560, innerHeight − 16)
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  onHeightChange: setPanelHeight,
})
```

`targetVersion` is an array so the effect re-runs on the same triggers as today (snapshot
content, expand/collapse, card↔chat). `ContentApp` receives `panelHeight`/`panelRef`
unchanged. Delete `src/content/views/use-streaming-height-controller.ts`.

### 3.3 Provider setup panel (`src/dianzhi/ui/ProviderSetup.tsx`, new)

A compact, adapter-agnostic form:

```ts
interface ProviderSetupProps {
  /** Current provider settings used to prefill the form. */
  provider: ProviderSettings
  /** Persists the edited provider. Resolves with the saved row. */
  onSave(provider: ProviderSettings): Promise<void>
  /** Opens the full Options settings page (optional secondary action). */
  onOpenSettings?(): void
}
```

Rendering: `apiKey` (password input), `baseUrl`, `model` fields; a 保存 button (Enter
submits); an inline status line for saving / rejection; an optional secondary
"打开设置" link that calls `onOpenSettings`. No logging of the apiKey.

### 3.4 Side Panel references the shared logic (`src/sidepanel/App.tsx`)

When `needsSettings` (`latestAssistant?.errorCode === 'PROVIDER_NOT_CONFIGURED'`) and the
host has not dismissed the panel, the history area renders `<ProviderSetup>` in place of
the plain error banner. The wrapper element is animated by the shared hook **without a
max** (`maximumHeight` omitted):

```tsx
const [setupHeight, setSetupHeight] = useState(0)
const [setupDismissed, setSetupDismissed] = useState(false)
const setupRef = useRef<HTMLDivElement | null>(null)
const showSetup = needsSettings && !setupDismissed

useStreamingHeight({
  elementRef: setupRef,
  visible: showSetup,
  targetVersion: snapshot,
  minimumHeight: 0, // maximumHeight omitted → Infinity
  reducedMotion,
  onHeightChange: setSetupHeight,
})
```

The popover renders the same panel inside its (capped) body; there the shared growing
element is still the outer panel, so `ProviderSetup` contributes to the popover's natural
height and the existing 280→560 animation fits it smoothly.

### 3.5 Data flow and dismissal

- Prefill: the host already holds settings (`settings.get` was dispatched at mount). It
  passes `settings.provider` down.
- Save: each host wraps `onSave` to dispatch `settings.save` with
  `{ ...currentSettings, provider }` via its own adapter and update its settings state:
  - popover — `contentSettingsCommand` (in `src/content/views/App.tsx`);
  - Side Panel — `settingsCommand` (in `src/sidepanel/App.tsx`).
- Dismissal: on successful save the host sets `setupDismissed = true` (panel hides, the
  existing 重试 affordance remains for the errored run). Any later snapshot whose
  `errorCode` is no longer `PROVIDER_NOT_CONFIGURED` resets `setupDismissed` to `false`.
- Errors: a rejected `settings.save` renders inline in the panel; the panel stays open.

## 4. Behavior matrix

| State                                             | Result                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Provider unconfigured, popover                     | `ProviderSetup` replaces the banner; panel glides taller (capped at `maximumHeight`) |
| Provider unconfigured, Side Panel                 | `ProviderSetup` grows to fit its content, no cap (`Infinity`), via the shared hook   |
| Save succeeds                                      | Panel dismissed; 重试 visible; retry re-runs with the new config                     |
| Save rejects                                       | Inline error; panel stays open                                                       |
| Secondary 打开设置 clicked                          | Full Options provider section opens                                                  |
| Setup panel content changes (e.g. error line)      | Height re-chases the new natural height with the rate-adaptive glide                 |
| Reduced motion                                     | Height jumped instantly to the measured target                                       |

## 5. Tests

- **`tests/unit/dianzhi/ui/use-streaming-height.spec.tsx`** (new): a Harness with a div
  whose `offsetHeight` is instance-defined. Glides toward the natural height across driven
  rAF frames; clamps at `maximumHeight`; grows unbounded when `maximumHeight` is omitted;
  reduced-motion jumps instantly; `visible: false` leaves the height untouched.
- **`tests/unit/dianzhi/ui/ProviderSetup.spec.tsx`** (new): prefills fields from
  `provider`; typing edits then 保存 calls `onSave` with the merged provider; a rejected
  `onSave` renders the error and keeps the panel; Enter submits.
- **`tests/unit/content/views/App.spec.tsx`** (extend): a `PROVIDER_NOT_CONFIGURED`
  snapshot renders `ProviderSetup` (not the plain banner); the popover's growth spec stays
  green.
- **`tests/unit/sidepanel/App.spec.tsx`** (extend): a `PROVIDER_NOT_CONFIGURED` snapshot
  renders `ProviderSetup`; the setup element's height animates to its content height
  (defined metrics + stubbed rAF) with no cap; a successful save dismisses the panel.
- **`tests/unit/sidepanel/scroll-follow.spec.ts`**, **`streaming-value-controller.spec.ts`**:
  unchanged and green.
- Gates: `pnpm run format:check`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

## 6. Files changed

| Path | Change |
| --- | --- |
| `src/dianzhi/ui/use-streaming-height.ts` | **new** shared hook (moved + generalized) |
| `src/dianzhi/ui/ProviderSetup.tsx` | **new** provider setup form |
| `src/content/views/use-streaming-height-controller.ts` | **deleted** (superseded) |
| `src/content/views/App.tsx` | migrate hook; render `ProviderSetup` on `PROVIDER_NOT_CONFIGURED`; wire `onSave`/`onOpenSettings` |
| `src/sidepanel/App.tsx` | render `ProviderSetup` + `useStreamingHeight` (uncapped); wire `onSave` |
| `src/content/views/App.css`, `src/sidepanel/App.css` | `.dz-provider-setup` styles beside the existing `.dz-error` rules |
| `eslint.config.js` | allow-list the two new spec paths |
| `tests/unit/dianzhi/ui/use-streaming-height.spec.tsx` | **new** |
| `tests/unit/dianzhi/ui/ProviderSetup.spec.tsx` | **new** |
| `tests/unit/content/views/App.spec.tsx`, `tests/unit/sidepanel/App.spec.tsx` | extended |
| `docs/superpowers/specs/2026-08-27-dianzhi-shared-smooth-height-provider-setup-design.md` | this document |

## 7. Non-goals

- Full Options provider-section parity (temperature, reasoning, `extraBody`, test button).
- No new protocol, background, offscreen, or manifest changes.
- No change to the popover's max-height cap or reduced-motion rules.
- No auto-retry after saving — the user presses 重试 (existing affordance).