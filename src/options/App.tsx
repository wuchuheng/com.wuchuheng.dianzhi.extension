import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, rowDataFromSettings, validateSettings } from '@/dianzhi/domain/settings'
import type { DianzhiSettings, SettingsProblem } from '@/dianzhi/domain/types'
import { settingsCommand } from '@/events/config'
import { ToolsWorkspace } from './tools/ToolsWorkspace'
import './App.css'

export type OptionsSection = 'provider' | 'tools' | 'interaction'

export interface OptionsViewProps {
  section: OptionsSection
  settings: DianzhiSettings
  status: string
  errors: SettingsProblem[]
  testing: boolean
  revealKey: boolean
  onSectionChange(section: OptionsSection): void
  onSettingsChange(settings: DianzhiSettings): void
  onRevealKey(): void
  onSave(): void
  onTest(): void
}

function FieldError({ problem, full }: { problem?: SettingsProblem; full?: boolean }) {
  if (!problem) return null
  return (
    <p
      id={`${problem.path}-error`}
      className={full ? 'field-error field-error--full' : 'field-error'}
    >
      {problem.message}
    </p>
  )
}

export function OptionsView(props: OptionsViewProps) {
  const { settings } = props
  const errorBoxRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (props.errors.length > 0) errorBoxRef.current?.focus()
  }, [props.errors])
  const updateProvider = (patch: Partial<DianzhiSettings['provider']>) =>
    props.onSettingsChange({ ...settings, provider: { ...settings.provider, ...patch } })
  const updateUi = (patch: Partial<DianzhiSettings['ui']>) =>
    props.onSettingsChange({ ...settings, ui: { ...settings.ui, ...patch } })
  const updateShortcuts = (patch: Partial<DianzhiSettings['shortcuts']>) =>
    props.onSettingsChange({ ...settings, shortcuts: { ...settings.shortcuts, ...patch } })

  const errorFor = (path: string): SettingsProblem | undefined =>
    props.errors.find((error) => error.path === path)
  const fieldProps = (path: string) => ({
    id: path,
    'aria-describedby': errorFor(path) ? `${path}-error` : undefined,
  })

  return (
    <div className="options-shell">
      <aside>
        <div className="options-brand">
          <span>点</span>
          <div>
            <strong>点知</strong>
            <small>Dianzhi</small>
          </div>
        </div>
        <nav aria-label="设置导航">
          {(
            [
              ['provider', 'AI 服务'],
              ['tools', '查询工具'],
              ['interaction', '交互与快捷键'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={props.section === id ? 'active' : ''}
              onClick={() => props.onSectionChange(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        {props.section === 'provider' && (
          <section>
            <h1>AI 服务</h1>
            <p className="lead">
              连接任意 OpenAI 兼容服务。密钥只保存在本地数据库中，不会同步到云端。
            </p>
            <div className="settings-card grid-two">
              <label className="span-two">
                API 地址
                <input
                  {...fieldProps('provider.baseUrl')}
                  value={settings.provider.baseUrl}
                  onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                />
              </label>
              <FieldError problem={errorFor('provider.baseUrl')} full />
              <label>
                API Key
                <span className="secret">
                  <input
                    {...fieldProps('provider.apiKey')}
                    type={props.revealKey ? 'text' : 'password'}
                    autoComplete="off"
                    value={settings.provider.apiKey}
                    onChange={(e) => updateProvider({ apiKey: e.target.value })}
                  />
                  <button type="button" onClick={props.onRevealKey}>
                    {props.revealKey ? '隐藏' : '显示'}
                  </button>
                </span>
              </label>
              <label>
                模型
                <input
                  {...fieldProps('provider.model')}
                  value={settings.provider.model}
                  onChange={(e) => updateProvider({ model: e.target.value })}
                />
              </label>
              <FieldError problem={errorFor('provider.model')} />
              <label>
                温度 <output>{settings.provider.temperature.toFixed(1)}</output>
                <input
                  {...fieldProps('provider.temperature')}
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.provider.temperature}
                  onChange={(e) => updateProvider({ temperature: Number(e.target.value) })}
                />
              </label>
              <label>
                思考开关参数
                <select
                  value={settings.provider.thinkingParam}
                  onChange={(e) =>
                    updateProvider({
                      thinkingParam: e.target.value as DianzhiSettings['provider']['thinkingParam'],
                    })
                  }
                >
                  <option value="">不使用（仅发送 reasoning_effort）</option>
                  <option value="enable_thinking">
                    enable_thinking（百炼 / Qwen / DeepSeek 网关）
                  </option>
                </select>
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={settings.provider.reasoningEnabled}
                  onChange={(e) => updateProvider({ reasoningEnabled: e.target.checked })}
                />
                推理模式
              </label>
              <p className="field-hint">
                未勾选时，网关模式（enable_thinking）会发送 enable_thinking:false 明确关闭推理；
                “不使用”模式（OpenAI 兼容）无关闭参数，不发送任何字段，服务商默认行为仍会生效。
              </p>
              <label>
                推理强度
                <select
                  value={settings.provider.reasoningEffort}
                  disabled={
                    !settings.provider.reasoningEnabled || Boolean(settings.provider.thinkingParam)
                  }
                  onChange={(e) =>
                    updateProvider({
                      reasoningEffort: e.target
                        .value as DianzhiSettings['provider']['reasoningEffort'],
                    })
                  }
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label className="span-two">
                额外请求字段（JSON）
                <textarea
                  {...fieldProps('provider.extraBody')}
                  value={settings.provider.extraBody}
                  onChange={(e) => updateProvider({ extraBody: e.target.value })}
                  placeholder='{"top_p": 0.9}'
                />
              </label>
              <FieldError problem={errorFor('provider.extraBody')} full />
            </div>
            <button
              type="button"
              className="secondary"
              onClick={props.onTest}
              disabled={props.testing}
            >
              {props.testing ? '测试中…' : '测试连接'}
            </button>
          </section>
        )}
        {props.section === 'tools' && (
          <section>
            <h1>查询工具</h1>
            <p className="lead">选择一个工具进行配置，或拖动排序。标签顺序也会用于弹窗和侧边栏。</p>
            <ToolsWorkspace provider={settings.provider} />
          </section>
        )}
        {props.section === 'interaction' && (
          <section>
            <h1>交互与快捷键</h1>
            <p className="lead">控制选词触发、上下文范围和页面操作。</p>
            <div className="settings-card grid-two">
              <label>
                选词触发
                <select
                  {...fieldProps('shortcuts.triggerMode')}
                  value={settings.shortcuts.triggerMode}
                  onChange={(e) =>
                    updateShortcuts({
                      triggerMode: e.target.value as DianzhiSettings['shortcuts']['triggerMode'],
                    })
                  }
                >
                  <option value="mouseup">松开鼠标</option>
                  <option value="alt-mouseup">Alt + 松开鼠标</option>
                </select>
              </label>
              <label>
                目标上下文词数
                <input
                  {...fieldProps('ui.contextTargetWords')}
                  type="number"
                  value={settings.ui.contextTargetWords}
                  onChange={(e) => updateUi({ contextTargetWords: Number(e.target.value) })}
                />
              </label>
              <label>
                最大上下文词数
                <input
                  {...fieldProps('ui.contextMaxWords')}
                  type="number"
                  value={settings.ui.contextMaxWords}
                  onChange={(e) => updateUi({ contextMaxWords: Number(e.target.value) })}
                />
              </label>
              <label>
                最大文本块数
                <input
                  {...fieldProps('ui.contextMaxBlocks')}
                  type="number"
                  value={settings.ui.contextMaxBlocks}
                  onChange={(e) => updateUi({ contextMaxBlocks: Number(e.target.value) })}
                />
              </label>
              {(['tabLeft', 'tabRight', 'toggleChat', 'dock', 'expand', 'close'] as const).map(
                (key) => (
                  <label key={key}>
                    {key}
                    <input
                      {...fieldProps(`shortcuts.${key}`)}
                      value={settings.shortcuts[key]}
                      onChange={(e) => updateShortcuts({ [key]: e.target.value })}
                    />
                  </label>
                )
              )}
            </div>
          </section>
        )}
        {props.errors.length > 0 && (
          <div className="form-errors" role="alert" tabIndex={-1} ref={errorBoxRef}>
            <p className="form-errors-title">请修正以下问题</p>
            {props.errors.map((error) => (
              <p key={error.path}>
                <a
                  href={`#${error.path}`}
                  onClick={(event) => {
                    event.preventDefault()
                    document.getElementById(error.path)?.focus()
                  }}
                >
                  {error.path}：{error.message}
                </a>
              </p>
            ))}
          </div>
        )}
        <footer className="save-bar">
          <span role="status">{props.status}</span>
          <button type="button" className="primary" onClick={props.onSave}>
            保存设置
          </button>
        </footer>
      </main>
    </div>
  )
}

function requestId(prefix: string) {
  return `${prefix}-${Date.now()}`
}

export default function App() {
  const [section, setSection] = useState<OptionsSection>('provider')
  const [settings, setSettings] = useState<DianzhiSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState('正在加载…')
  const [errors, setErrors] = useState<SettingsProblem[]>([])
  const [revealKey, setRevealKey] = useState(false)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    void settingsCommand
      .dispatch({ type: 'settings.get', requestId: requestId('load') })
      .then((value) => {
        setSettings(value)
        setStatus('')
      })
      .catch(() => setStatus('设置加载失败'))
  }, [])
  const save = () => {
    const validation = validateSettings(settings)
    setErrors(validation.errors)
    if (!validation.ok) {
      setStatus('请修正标记的问题')
      return
    }
    setStatus('正在保存…')
    void settingsCommand
      .dispatch({
        type: 'settings.save',
        requestId: requestId('save'),
        settings: rowDataFromSettings(settings),
      })
      .then((value) => {
        setSettings(value)
        setStatus('已保存')
      })
      .catch(() => setStatus('保存失败'))
  }
  const test = () => {
    const validation = validateSettings(settings)
    setErrors(validation.errors)
    if (!validation.ok) {
      setStatus('请先修正配置')
      return
    }
    setTesting(true)
    setStatus('正在测试连接…')
    void settingsCommand
      .dispatch({ type: 'settings.testProvider', requestId: requestId('test'), settings })
      .then(() => setStatus('连接成功'))
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : '连接失败'))
      .finally(() => setTesting(false))
  }
  return (
    <OptionsView
      section={section}
      settings={settings}
      status={status}
      errors={errors}
      testing={testing}
      revealKey={revealKey}
      onSectionChange={setSection}
      onSettingsChange={setSettings}
      onRevealKey={() => setRevealKey((value) => !value)}
      onSave={save}
      onTest={test}
    />
  )
}
