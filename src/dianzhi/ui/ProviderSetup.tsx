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
