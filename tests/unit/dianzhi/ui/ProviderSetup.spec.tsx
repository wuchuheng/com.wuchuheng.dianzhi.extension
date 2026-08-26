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
