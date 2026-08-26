# Shared Smooth Height + Provider Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the popover's smooth panel-height animation into a shared `useStreamingHeight` hook (with an optional max, default unbounded), and add an inline provider-setup panel that both the popover (capped growth) and the Side Panel (uncapped growth via the shared hook) render when the provider is unconfigured.

**Architecture:** Split the existing `useStreamingHeightController` (popover-private) into a shared React hook in `src/dianzhi/ui/` that any caller can reference; migrate the popover unchanged. Add an adapter-agnostic `ProviderSetup` form and host it in both surfaces, reusing the existing `settings.get` / `settings.save` event adapters (`contentSettingsCommand`, `settingsCommand`) — no new protocol/background work.

**Tech Stack:** TypeScript, React 19, vitest + jsdom. No manifest or permission changes.

**Spec:** `docs/superpowers/specs/2026-08-27-dianzhi-shared-smooth-height-provider-setup-design.md` (approved 2026-08-27).

---

### Task 1: Shared `useStreamingHeight` hook + popover migration

**Files:**

- Create: `src/dianzhi/ui/use-streaming-height.ts`
- Delete: `src/content/views/use-streaming-height-controller.ts`
- Modify: `src/content/views/App.tsx` (import + call site)
- Test: `tests/unit/dianzhi/ui/use-streaming-height.spec.tsx` (new)
- Modify: `eslint.config.js`

- [ ] **Step 1: Write the failing hook tests**

Create `tests/unit/dianzhi/ui/use-streaming-height.spec.tsx` with the following full content:

```tsx
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreamingHeight } from '@/dianzhi/ui/use-streaming-height'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface HarnessProps {
  visible: boolean
  targetVersion: unknown
  minimumHeight?: number
  maximumHeight?: number
  reducedMotion: boolean
  onHeightChange(height: number): void
}

function Harness(props: HarnessProps) {
  const elementRef = useRef<HTMLDivElement | null>(null)
  useStreamingHeight({ elementRef, ...props })
  return <div ref={elementRef} className="grow" />
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let frameCallback: ((now: number) => void) | null

const base = (overrides: Partial<HarnessProps> = {}): HarnessProps => ({
  visible: true,
  targetVersion: 1,
  reducedMotion: false,
  onHeightChange: vi.fn(),
  ...overrides,
})

async function render(props: HarnessProps): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(<Harness {...props} />)
  })
  return host.firstElementChild as HTMLDivElement
}

async function update(props: HarnessProps) {
  await act(async () => {
    root?.render(<Harness {...props} />)
  })
}

function defineOffsetHeight(element: HTMLElement, value: number) {
  Object.defineProperty(element, 'offsetHeight', { value, configurable: true })
}

const driveFrames = (count = 300) => {
  let now = 1_000
  for (let i = 0; i < count && frameCallback !== null; i++) {
    const cb = frameCallback
    frameCallback = null
    cb(now)
    now += 33
  }
}

beforeEach(() => {
  frameCallback = null
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    frameCallback = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frameCallback = null
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('useStreamingHeight', () => {
  it('applies the measured height instantly the first time it becomes visible', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: false, targetVersion: 1, onHeightChange }))
    defineOffsetHeight(element, 240)
    await update(base({ visible: true, targetVersion: 1, onHeightChange }))
    expect(frameCallback).toBeNull()
    expect(onHeightChange).toHaveBeenLastCalledWith(240)
  })

  it('clamps the measured height to maximumHeight', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: false, maximumHeight: 560, onHeightChange }))
    defineOffsetHeight(element, 900)
    await update(base({ visible: true, maximumHeight: 560, onHeightChange }))
    expect(onHeightChange).toHaveBeenLastCalledWith(560)
  })

  it('grows without a cap when maximumHeight is omitted', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: false, onHeightChange }))
    defineOffsetHeight(element, 900)
    await update(base({ visible: true, targetVersion: 2, onHeightChange }))
    expect(onHeightChange).toHaveBeenLastCalledWith(900)
  })

  it('glides toward a new measured height across animation frames', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: true, targetVersion: 1, onHeightChange }))
    expect(onHeightChange).toHaveBeenLastCalledWith(0)
    defineOffsetHeight(element, 240)
    await update(base({ visible: true, targetVersion: 2, onHeightChange }))
    expect(frameCallback).not.toBeNull()
    driveFrames()
    expect(onHeightChange).toHaveBeenLastCalledWith(240)
  })

  it('jumps instantly instead of animating under reduced motion', async () => {
    const onHeightChange = vi.fn()
    const element = await render(
      base({ visible: true, targetVersion: 1, reducedMotion: true, onHeightChange })
    )
    defineOffsetHeight(element, 240)
    await update(base({ visible: true, targetVersion: 2, reducedMotion: true, onHeightChange }))
    expect(frameCallback).toBeNull()
    expect(onHeightChange).toHaveBeenLastCalledWith(240)
  })

  it('leaves the height untouched while not visible', async () => {
    const onHeightChange = vi.fn()
    await render(base({ visible: false, targetVersion: 1, onHeightChange }))
    expect(onHeightChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/use-streaming-height.spec.tsx`
Expected: FAIL — `Cannot find module '@/dianzhi/ui/use-streaming-height'` (6 tests).

- [ ] **Step 3: Create the shared hook**

Create `src/dianzhi/ui/use-streaming-height.ts` with the following full content:

```ts
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createStreamingValueController } from './streaming-value-controller'

export interface UseStreamingHeightOptions {
  elementRef: RefObject<HTMLElement | null>
  visible: boolean
  /** Any change re-measures the element's natural height and re-chases it. */
  targetVersion: unknown
  minimumHeight?: number
  maximumHeight?: number
  reducedMotion: boolean
  onHeightChange(height: number): void
}

/**
 * Smoothly sizes an element toward its natural content height whenever content
 * changes, at a rate adapted to recent growth — the content popover's panel and
 * the Side Panel's provider-setup panel both use it. `minimumHeight` defaults to
 * 0 and `maximumHeight` to unbounded, so callers that need no cap (the Side
 * Panel) simply omit it. The caller owns where the height is applied.
 */
export function useStreamingHeight({
  elementRef,
  visible,
  targetVersion,
  minimumHeight = 0,
  maximumHeight = Number.POSITIVE_INFINITY,
  reducedMotion,
  onHeightChange,
}: UseStreamingHeightOptions) {
  const controllerRef = useRef(
    createStreamingValueController(minimumHeight, { min: minimumHeight, max: maximumHeight })
  )
  const animationFrameRef = useRef<number | null>(null)
  const previouslyVisibleRef = useRef(false)

  useLayoutEffect(() => {
    const stopAnimation = () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
    stopAnimation()
    const element = elementRef.current
    if (!visible || !element) {
      previouslyVisibleRef.current = false
      return stopAnimation
    }

    const now = performance.now()
    const previousHeight = controllerRef.current.getValue()
    element.style.height = 'auto'
    const targetHeight = Math.min(Math.max(element.offsetHeight, minimumHeight), maximumHeight)
    element.style.height = `${previousHeight}px`

    if (!previouslyVisibleRef.current) {
      controllerRef.current = createStreamingValueController(targetHeight, {
        min: minimumHeight,
        max: maximumHeight,
      })
      onHeightChange(targetHeight)
      previouslyVisibleRef.current = true
      return stopAnimation
    }

    controllerRef.current.observeTarget(targetHeight, now)
    if (reducedMotion) {
      onHeightChange(controllerRef.current.jumpToTarget())
      return stopAnimation
    }

    const animate = (frameNow: number) => {
      onHeightChange(controllerRef.current.advance(frameNow))
      if (!controllerRef.current.isSettled()) {
        animationFrameRef.current = window.requestAnimationFrame(animate)
      }
    }
    animationFrameRef.current = window.requestAnimationFrame(animate)
    return stopAnimation
  }, [
    elementRef,
    maximumHeight,
    minimumHeight,
    onHeightChange,
    reducedMotion,
    targetVersion,
    visible,
  ])

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    },
    []
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/use-streaming-height.spec.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Migrate the popover call site**

In `src/content/views/App.tsx`:

1. Replace the `useStreamingHeightController({...})` call (currently lines 469–479) with:

```tsx
useStreamingHeight({
  elementRef: panelRef,
  visible: state.visible,
  targetVersion: [state.snapshot, state.expanded, state.mode],
  minimumHeight: 280,
  maximumHeight: maximumPanelHeight,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  onHeightChange: setPanelHeight,
})
```

2. Replace the import (line 27) `import { useStreamingHeightController } from './use-streaming-height-controller'` with:
   `import { useStreamingHeight } from '@/dianzhi/ui/use-streaming-height'`.
   NOTE: if the `PostToolUse` auto-fix removes the new import because it was momentarily unused, re-add it after the call-site edit lands.

- [ ] **Step 6: Delete the old hook + update the eslint allow-list**

```bash
rm src/content/views/use-streaming-height-controller.ts
```

In `eslint.config.js`, inside `allowDefaultProject`, add
`'tests/unit/dianzhi/ui/use-streaming-height.spec.tsx'` right after
`'tests/unit/dianzhi/ui/streaming-value-controller.spec.ts'`.

- [ ] **Step 7: Verify**

Run: `pnpm exec tsc -b` → exit 0.
Run: `pnpm exec vitest run tests/unit/dianzhi/ui/use-streaming-height.spec.tsx tests/unit/content/views/App.spec.tsx` → all PASS (popover behavior-neutral).

- [ ] **Step 8: Commit**

```bash
git add src/dianzhi/ui/use-streaming-height.ts \
        src/content/views/use-streaming-height-controller.ts \
        src/content/views/App.tsx \
        tests/unit/dianzhi/ui/use-streaming-height.spec.tsx \
        eslint.config.js
git commit -m "refactor(ui): extract shared useStreamingHeight hook"
```

---

### Task 2: `ProviderSetup` inline form component

**Files:**

- Create: `src/dianzhi/ui/ProviderSetup.tsx`
- Test: `tests/unit/dianzhi/ui/ProviderSetup.spec.tsx` (new)
- Modify: `eslint.config.js`

- [ ] **Step 1: Write the failing component tests**

Create `tests/unit/dianzhi/ui/ProviderSetup.spec.tsx` with the following full content:

```tsx
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderSetup, type ProviderSetupProps } from '@/dianzhi/ui/ProviderSetup'
import type { ProviderSettings } from '@/dianzhi/domain/types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const provider: ProviderSettings = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
  temperature: 0.7,
  reasoningEnabled: false,
  reasoningEffort: 'medium',
  extraBody: '',
}

let root: Root | undefined
let host: HTMLDivElement | undefined

function renderSetup(props: Partial<ProviderSetupProps> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onSave = vi.fn().mockResolvedValue(undefined)
  act(() => {
    root?.render(<ProviderSetup provider={provider} onSave={onSave} {...props} />)
  })
  return { onSave }
}

function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('ProviderSetup', () => {
  it('prefills the fields from the current provider settings', () => {
    renderSetup()
    expect(host?.querySelector<HTMLInputElement>('[aria-label="API 地址"]')?.value).toBe(
      'https://api.example.com/v1'
    )
    expect(host?.querySelector<HTMLInputElement>('[aria-label="API 密钥"]')?.value).toBe('sk-test')
    expect(host?.querySelector<HTMLInputElement>('[aria-label="模型"]')?.value).toBe('gpt-4o')
  })

  it('saves the edited provider on submit', async () => {
    const { onSave } = renderSetup()
    act(() => {
      setValue(host!.querySelector<HTMLInputElement>('[aria-label="模型"]')!, 'claude-opus-4-8')
    })
    await act(async () => {
      host
        ?.querySelector<HTMLFormElement>('.dz-provider-setup')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith({ ...provider, model: 'claude-opus-4-8' })
  })

  it('renders an inline error when saving fails and keeps the panel open', async () => {
    renderSetup({ onSave: vi.fn().mockRejectedValue(new Error('网络错误')) })
    await act(async () => {
      host
        ?.querySelector<HTMLFormElement>('.dz-provider-setup')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(host?.querySelector('.dz-provider-setup-error')?.textContent).toContain('网络错误')
  })

  it('renders the optional full-settings action', () => {
    const onOpenSettings = vi.fn()
    renderSetup({ onOpenSettings })
    act(() => {
      host?.querySelector<HTMLButtonElement>('.dz-provider-setup-actions .dz-secondary')?.click()
    })
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/ProviderSetup.spec.tsx`
Expected: FAIL — `Cannot find module '@/dianzhi/ui/ProviderSetup'` (4 tests).

- [ ] **Step 3: Create the component**

Create `src/dianzhi/ui/ProviderSetup.tsx` with the following full content:

```tsx
import { useState, type FormEvent } from 'react'
import type { ProviderSettings } from '@/dianzhi/domain/types'

export interface ProviderSetupProps {
  /** Current provider settings used to prefill the form. */
  provider: ProviderSettings
  /** Persists the edited provider. Resolves on success, rejects on failure. */
  onSave(provider: ProviderSettings): Promise<void>
  /** Opens the full Options settings page (optional secondary action). */
  onOpenSettings?(): void
}

export function ProviderSetup({ provider, onSave, onOpenSettings }: ProviderSetupProps) {
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [apiKey, setApiKey] = useState(provider.apiKey)
  const [model, setModel] = useState(provider.model)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({ ...provider, baseUrl, apiKey, model })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="dz-provider-setup" onSubmit={(event) => void submit(event)}>
      <h3 className="dz-provider-setup-title">配置 AI 服务</h3>
      <label className="dz-provider-setup-field">
        <span>API 地址</span>
        <input aria-label="API 地址" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="dz-provider-setup-field">
        <span>API 密钥</span>
        <input
          aria-label="API 密钥"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <label className="dz-provider-setup-field">
        <span>模型</span>
        <input aria-label="模型" value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      {error !== null && (
        <p className="dz-provider-setup-error" role="alert">
          {error}
        </p>
      )}
      <div className="dz-provider-setup-actions">
        <button type="submit" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        {onOpenSettings && (
          <button type="button" className="dz-secondary" onClick={onOpenSettings}>
            打开设置
          </button>
        )}
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/ProviderSetup.spec.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the spec to the eslint allow-list**

In `eslint.config.js`, inside `allowDefaultProject`, add
`'tests/unit/dianzhi/ui/ProviderSetup.spec.tsx'` right after
`'tests/unit/dianzhi/ui/use-streaming-height.spec.tsx'`.

- [ ] **Step 6: Commit**

```bash
git add src/dianzhi/ui/ProviderSetup.tsx tests/unit/dianzhi/ui/ProviderSetup.spec.tsx eslint.config.js
git commit -m "feat(ui): add ProviderSetup inline provider form"
```

---

### Task 3: Popover hosts `ProviderSetup` (capped growth)

**Files:**

- Modify: `src/content/views/App.tsx` (ContentApp props + banner branch + container wiring)
- Modify: `src/content/views/App.css`
- Modify: `tests/unit/content/views/App.spec.tsx`

- [ ] **Step 1: Add baseUrl/App.css styles**

In `src/content/views/App.css` (near the `.dz-error` rules), append:

```css
.dz-provider-setup {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  border: 1px solid var(--d-danger-border);
  border-radius: var(--d-radius-md);
  padding: 10px;
  background: var(--d-surface);
}
.dz-provider-setup-title {
  margin: 0;
  font-size: 13px;
}
.dz-provider-setup-field {
  display: grid;
  gap: 3px;
  font-size: 12px;
  color: var(--d-text-muted);
}
.dz-provider-setup-field input {
  border: 1px solid var(--d-border-strong);
  border-radius: var(--d-radius-sm);
  padding: 4px 6px;
  color: var(--d-text);
  background: var(--d-surface);
}
.dz-provider-setup-error {
  margin: 0;
  color: var(--d-danger);
  font-size: 12px;
}
.dz-provider-setup-actions {
  display: flex;
  gap: 8px;
}
.dz-provider-setup-actions button[type='submit'] {
  border: 0;
  border-radius: var(--d-radius-sm);
  padding: 5px 10px;
  color: var(--d-text-on-brand);
  background: var(--d-brand);
  cursor: pointer;
}
.dz-provider-setup-actions button[type='submit']:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 2: Grow ContentApp to host the setup panel**

In `src/content/views/App.tsx`:

1. Add `ProviderSetup` and `ProviderSettings` to the imports:
   `import { ProviderSetup } from '@/dianzhi/ui/ProviderSetup'`
   `import type { ProviderSettings } from '@/dianzhi/domain/types'`

2. In `ContentAppProps`, add two required props (after `onOpenSettings(): void`, line 127):

```ts
  providerSettings: ProviderSettings
  onSaveProvider(provider: ProviderSettings): Promise<void>
```

3. In `ContentApp`'s destructuring (near line 151), add `providerSettings` and `onSaveProvider`.

4. After the `needsSettings` computation (line 163), add local dismissal state:

```ts
const [setupDismissed, setSetupDismissed] = useState(false)
useEffect(() => {
  if (!needsSettings) setSetupDismissed(false)
}, [needsSettings])
const showSetup = needsSettings && !setupDismissed
```

5. Replace the error-banner block (lines 261–270) with:

```tsx
{
  showSetup ? (
    <ProviderSetup
      provider={providerSettings}
      onSave={(provider) => onSaveProvider(provider).then(() => setSetupDismissed(true))}
      onOpenSettings={onOpenSettings}
    />
  ) : state.error || latestAssistant?.errorMessage ? (
    <div className="dz-error" role="alert">
      <span>{state.error?.message ?? latestAssistant?.errorMessage}</span>
    </div>
  ) : null
}
```

- [ ] **Step 3: Wire the container App**

In `src/content/views/App.tsx`, in the default `App` component, add a `saveProvider` callback next to the other callbacks (after `withConversation`):

```ts
const saveProvider = useCallback(
  async (provider: ProviderSettings) => {
    const saved = await contentSettingsCommand.dispatch({
      type: 'settings.save',
      requestId: requestId('settings'),
      settings: { ...settings, provider },
    })
    setSettings(saved)
  },
  [requestId, settings]
)
```

and pass it into `ContentApp` (in the render around lines 555–597):

```tsx
      providerSettings={settings.provider}
      onSaveProvider={saveProvider}
```

- [ ] **Step 4: Update + extend the content App spec**

In `tests/unit/content/views/App.spec.tsx`:

1. Add the two new props to all 3 existing `<ContentApp` renders. In the shared `render` helper (around line 70) and the two inline renders (lines 127, 169), add after `onOpenSettings=...`:

```tsx
      providerSettings={DEFAULT_SETTINGS.provider}
      onSaveProvider={async () => undefined}
```

2. Append a new describe block at the end of the file:

```tsx
describe('ContentApp provider setup', () => {
  it('renders the inline setup panel instead of the banner when unconfigured', async () => {
    const unconfigured = visibleState()
    unconfigured.error = { code: 'PROVIDER_NOT_CONFIGURED', message: 'provider missing' }
    const onSaveProvider = vi.fn().mockResolvedValue(undefined)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root.render(
        <ContentApp
          state={unconfigured}
          placement={placement}
          reasoningEnabled={false}
          shortcuts={DEFAULT_SETTINGS.shortcuts}
          onToolSelect={() => undefined}
          onModeChange={() => undefined}
          onExpand={() => undefined}
          onClose={() => undefined}
          onDock={() => undefined}
          onSend={() => undefined}
          onStop={() => undefined}
          onRetry={() => undefined}
          onOpenSettings={() => undefined}
          providerSettings={DEFAULT_SETTINGS.provider}
          onSaveProvider={onSaveProvider}
        />
      )
    })
    expect(host?.querySelector('.dz-provider-setup')).not.toBeNull()
    expect(host?.querySelector('.dz-error')).toBeNull()

    await act(async () => {
      host
        ?.querySelector<HTMLFormElement>('.dz-provider-setup')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSaveProvider).toHaveBeenCalledTimes(1)
    // Dismissed after a successful save.
    expect(host?.querySelector('.dz-provider-setup')).toBeNull()
  })
})
```

- [ ] **Step 5: Verify**

Run: `pnpm exec tsc -b` → exit 0.
Run: `pnpm exec vitest run tests/unit/content/views/App.spec.tsx tests/unit/dianzhi/ui/ProviderSetup.spec.tsx` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/content/views/App.tsx src/content/views/App.css tests/unit/content/views/App.spec.tsx
git commit -m "feat(popover): show inline provider setup panel when unconfigured"
```

---

### Task 4: Side Panel hosts `ProviderSetup` (uncapped via shared hook)

**Files:**

- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.css`
- Modify: `tests/unit/sidepanel/App.spec.tsx`

- [ ] **Step 1: Add styles**

In `src/sidepanel/App.css` (near the `.dz-error` rules), append the same `.dz-provider-setup*` rules as Task 3 Step 1, plus:

```css
.dz-provider-setup-host {
  overflow: hidden;
}
```

- [ ] **Step 2: Grow `SidePanelView`**

In `src/sidepanel/App.tsx`:

1. Add imports:

```ts
import { ProviderSetup } from '@/dianzhi/ui/ProviderSetup'
import { useStreamingHeight } from '@/dianzhi/ui/use-streaming-height'
import type { ProviderSettings } from '@/dianzhi/domain/types'
```

2. In `SidePanelViewProps`, add two required props:

```ts
  providerSettings: ProviderSettings
  onSaveProvider(provider: ProviderSettings): Promise<void>
```

3. In `SidePanelView`'s destructuring, add `providerSettings` and `onSaveProvider`.

4. Next to the existing `reducedMotion` / hook block (where `useScrollFollow` is called), add the setup state, dismissal reset, and the shared (uncapped) height hook:

```ts
const setupRef = useRef<HTMLDivElement | null>(null)
const [setupHeight, setSetupHeight] = useState(0)
const [setupDismissed, setSetupDismissed] = useState(false)
const showSetup = needsSettings && !setupDismissed

useEffect(() => {
  if (!needsSettings) setSetupDismissed(false)
}, [needsSettings])

useStreamingHeight({
  elementRef: setupRef,
  visible: showSetup,
  targetVersion: snapshot,
  reducedMotion,
  onHeightChange: setSetupHeight,
})
```

(`snapshot` and `reducedMotion` are already computed in `SidePanelView`.)

5. Replace the error-banner branch in the history `<main>` (currently the `{(state.error || latestAssistant?.errorMessage) && (...)}` block) with:

```tsx
{
  showSetup ? (
    <div ref={setupRef} className="dz-provider-setup-host" style={{ height: setupHeight }}>
      <ProviderSetup
        provider={providerSettings}
        onSave={(provider) => onSaveProvider(provider).then(() => setSetupDismissed(true))}
        onOpenSettings={onOpenSettings}
      />
    </div>
  ) : state.error || latestAssistant?.errorMessage ? (
    <div className="dz-error" role="alert">
      <span>{state.error?.message ?? latestAssistant?.errorMessage}</span>
      {needsSettings && (
        <button type="button" onClick={onOpenSettings}>
          打开设置
        </button>
      )}
    </div>
  ) : null
}
```

- [ ] **Step 3: Wire the container App**

In the default `App` component (sidepanel `src/sidepanel/App.tsx`), add a `saveProvider` callback and pass both new props into `SidePanelView`:

```ts
const saveProvider = useCallback(
  async (provider: ProviderSettings) => {
    const saved = await settingsCommand.dispatch({
      type: 'settings.save',
      requestId: requestId('settings'),
      settings: { ...settings, provider },
    })
    setSettings(saved)
  },
  [requestId, settings]
)
```

In the `<SidePanelView ... />` render add:

```tsx
      providerSettings={settings.provider}
      onSaveProvider={saveProvider}
```

- [ ] **Step 4: Extend the Side Panel App spec**

In `tests/unit/sidepanel/App.spec.tsx`, append a new `describe` block at the end of the file:

```tsx
describe('Side Panel provider setup panel', () => {
  const unconfigured = (content: string) => {
    const next = snapshot()
    next.messages = [
      {
        id: 1,
        conversationId: 22,
        sequence: 1,
        role: 'assistant',
        content,
        reasoningContent: '',
        status: 'error',
        errorCode: 'PROVIDER_NOT_CONFIGURED',
        errorMessage: content,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    ]
    return next
  }

  it('renders the inline setup panel instead of the banner when unconfigured', async () => {
    await renderApp()
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup') })
      await Promise.resolve()
    })
    expect(host?.querySelector('.dz-provider-setup')).not.toBeNull()
    expect(host?.querySelector('.dz-error')).toBeNull()
  })

  it('dismisses the panel after a successful save', async () => {
    settingsDispatch.mockResolvedValue(DEFAULT_SETTINGS)
    await renderApp()
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup') })
      await Promise.resolve()
    })
    expect(host?.querySelector('.dz-provider-setup')).not.toBeNull()
    await act(async () => {
      host
        ?.querySelector<HTMLFormElement>('.dz-provider-setup')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(settingsDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings.save' })
    )
    expect(host?.querySelector('.dz-provider-setup')).toBeNull()
  })

  it('drives the setup panel height to the content height with no cap', async () => {
    let frameCallback: ((now: number) => void) | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      frameCallback = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      frameCallback = null
    })

    await renderApp()
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup') })
      await Promise.resolve()
    })
    const panel = host?.querySelector<HTMLDivElement>('.dz-provider-setup-host')
    expect(panel).not.toBeNull()
    Object.defineProperty(panel as HTMLDivElement, 'offsetHeight', {
      value: 900,
      configurable: true,
    })

    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup again') })
      await Promise.resolve()
    })
    expect(frameCallback).not.toBeNull()

    act(() => {
      let now = 1_000
      for (let i = 0; i < 300 && frameCallback !== null; i++) {
        const cb = frameCallback
        frameCallback = null
        cb(now)
        now += 33
      }
    })
    expect(panel?.style.height).toBe('900px')
  })
})
```

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run tests/unit/sidepanel/App.spec.tsx tests/unit/sidepanel/scroll-follow.spec.ts` → all PASS.
Run: `pnpm exec tsc -b` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/App.tsx src/sidepanel/App.css tests/unit/sidepanel/App.spec.tsx
git commit -m "feat(sidepanel): show uncapped provider setup panel via shared height hook"
```

---

### Task 5: Gates and final verification

**Files:** none expected.

- [ ] **Step 1: Format check**

Run: `pnpm run format:check`
Expected: PASS. If only feature files need fixes, run prettier on them and re-check.

- [ ] **Step 2: Lint + type check**

Run: `pnpm exec tsc -b` → exit 0.
Run: `pnpm run lint`. Verify by classification that any errors are **not** in files this feature changed: `src/dianzhi/ui/use-streaming-height.ts`, `src/dianzhi/ui/ProviderSetup.tsx`, `src/content/views/App.tsx`, `src/content/views/App.css`, `src/sidepanel/App.tsx`, `src/sidepanel/App.css`, the two touched spec files, `tests/unit/dianzhi/ui/use-streaming-height.spec.tsx`, `tests/unit/dianzhi/ui/ProviderSetup.spec.tsx`, `eslint.config.js`. Report the classification; do not fix unrelated files.

- [ ] **Step 3: Unit tests**

Run: `pnpm run test`
Expected: all PASS (all spec files).

- [ ] **Step 4: Production build**

Run: `pnpm run build`
Expected: completes (vendors SQLite, `tsc -b`, vite build). Do not hand-edit `dist/`.

- [ ] **Step 5: Drift check**

Run `/drift-check` and resolve any findings that point at this feature.

- [ ] **Step 6: Commit any fixes (only if a gate above needed a fix to a feature file)**

```bash
git add -A
git commit -m "chore: post-gate fixes for shared smooth height and provider setup"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 shared hook + §3.2 popover migration ⇢ Task 1; §3.3 `ProviderSetup` ⇢ Task 2; §3.5 popover hosting / capped growth ⇢ Task 3; §3.4 Side Panel reference (uncapped via shared hook) + dismissal ⇢ Task 4; §4 behavior matrix ⇢ the spec tests; §5 tests across Tasks 1–4; §6 files all touched; §7 non-goals enforced (no protocol/background/manifest changes).
- **Placeholder scan:** no TBD/TODO; every step has full code or exact commands.
- **Type consistency:** `useStreamingHeight({ elementRef, visible, targetVersion, minimumHeight?, maximumHeight?, reducedMotion, onHeightChange })` is identical in Task 1 (module + spec + popover) and Task 4 (side panel, `maximumHeight` omitted). `ProviderSetupProps` = `{ provider, onSave, onOpenSettings? }` identical in Task 2 and both hosts. `onSaveProvider(provider): Promise<void>` is the host callback signature used consistently; ContentApp/SidePanelView props match the container wiring.
- **jsdom constraints encoded:** `offsetHeight` is instance-defined (jsdom has no layout); rAF/cAF stubbed for deterministic frames; `settingsCommand.dispatch` is already mocked in the side panel spec; content `App.spec.tsx` renders `ContentApp` directly and needs the two new props on all 3 existing sites.
- **Auto-fix pitfall:** the `PostToolUse` eslint-fix removes imports that are momentarily unused mid-task; Task 1 Step 5 and both wiring steps call this out.
- **Known tuning knob:** none new — the shared hook's easing comes from the existing `createStreamingValueController` (already tuned); the provider-setup fields are intentionally the minimum set.
