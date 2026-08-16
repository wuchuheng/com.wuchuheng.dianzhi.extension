import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, effectivePrompt, validateSettings } from '@/dianzhi/domain/settings'
import type { DianzhiSettings, SettingsProblem } from '@/dianzhi/domain/types'
import { settingsCommand } from '@/events/config'
import { addCustomTool, moveTool, removeCustomTool } from './settings-form'
import './App.css'

export type OptionsSection = 'provider' | 'tools' | 'interaction'

export interface OptionsViewProps {
  section: OptionsSection
  settings: DianzhiSettings
  status: string
  errors: SettingsProblem[]
  revealKey: boolean
  onSectionChange(section: OptionsSection): void
  onSettingsChange(settings: DianzhiSettings): void
  onRevealKey(): void
  onSave(): void
  onTest(): void
}

export function OptionsView(props: OptionsViewProps) {
  const { settings } = props
  const updateProvider = (patch: Partial<DianzhiSettings['provider']>) =>
    props.onSettingsChange({ ...settings, provider: { ...settings.provider, ...patch } })
  const updateUi = (patch: Partial<DianzhiSettings['ui']>) =>
    props.onSettingsChange({ ...settings, ui: { ...settings.ui, ...patch } })
  const updateShortcuts = (patch: Partial<DianzhiSettings['shortcuts']>) =>
    props.onSettingsChange({ ...settings, shortcuts: { ...settings.shortcuts, ...patch } })
  const updateTool = (id: string, patch: Partial<DianzhiSettings['tools'][number]>) =>
    props.onSettingsChange({
      ...settings,
      tools: settings.tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool)),
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
            <p className="lead">连接任意 OpenAI 兼容服务。密钥只保存在 Chrome 同步存储中。</p>
            <div className="settings-card grid-two">
              <label className="span-two">
                API 地址
                <input
                  value={settings.provider.baseUrl}
                  onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                />
              </label>
              <label>
                API Key
                <span className="secret">
                  <input
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
                  value={settings.provider.model}
                  onChange={(e) => updateProvider({ model: e.target.value })}
                />
              </label>
              <label>
                温度 <output>{settings.provider.temperature.toFixed(1)}</output>
                <input
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
                  value={settings.provider.extraBody}
                  onChange={(e) => updateProvider({ extraBody: e.target.value })}
                  placeholder='{"top_p": 0.9}'
                />
              </label>
            </div>
            <button type="button" className="secondary" onClick={props.onTest}>
              测试连接
            </button>
          </section>
        )}
        {props.section === 'tools' && (
          <section>
            <div className="section-title">
              <div>
                <h1>查询工具</h1>
                <p className="lead">标签顺序也用于弹窗和侧边栏。</p>
              </div>
              <button type="button" onClick={() => props.onSettingsChange(addCustomTool(settings))}>
                添加自定义工具
              </button>
            </div>
            <label className="default-tool">
              默认工具
              <select
                value={settings.ui.defaultToolId}
                onChange={(e) => updateUi({ defaultToolId: e.target.value })}
              >
                {settings.tools
                  .filter((tool) => tool.enabled)
                  .map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="tool-list">
              {settings.tools.map((tool, index) => (
                <article className="settings-card tool-card" key={tool.id}>
                  <div className="tool-head">
                    <input
                      aria-label="启用工具"
                      type="checkbox"
                      checked={tool.enabled}
                      onChange={(e) => updateTool(tool.id, { enabled: e.target.checked })}
                    />
                    <input
                      aria-label="工具名称"
                      value={tool.name}
                      onChange={(e) => updateTool(tool.id, { name: e.target.value })}
                    />
                    <div>
                      <button
                        type="button"
                        aria-label="上移"
                        disabled={index === 0}
                        onClick={() => props.onSettingsChange(moveTool(settings, tool.id, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="下移"
                        disabled={index === settings.tools.length - 1}
                        onClick={() => props.onSettingsChange(moveTool(settings, tool.id, 1))}
                      >
                        ↓
                      </button>
                      {!tool.builtin && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            props.onSettingsChange(removeCustomTool(settings, tool.id))
                          }
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                  <label>
                    提示词模式
                    <select
                      value={tool.promptMode}
                      onChange={(e) =>
                        updateTool(tool.id, { promptMode: e.target.value as 'preset' | 'custom' })
                      }
                    >
                      <option value="preset" disabled={!tool.builtin}>
                        内置
                      </option>
                      <option value="custom">自定义</option>
                    </select>
                  </label>
                  <label>
                    提示词
                    <textarea
                      readOnly={tool.promptMode === 'preset'}
                      value={
                        tool.promptMode === 'preset' ? effectivePrompt(tool) : tool.customPrompt
                      }
                      onChange={(e) => updateTool(tool.id, { customPrompt: e.target.value })}
                    />
                  </label>
                </article>
              ))}
            </div>
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
                  type="number"
                  value={settings.ui.contextTargetWords}
                  onChange={(e) => updateUi({ contextTargetWords: Number(e.target.value) })}
                />
              </label>
              <label>
                最大上下文词数
                <input
                  type="number"
                  value={settings.ui.contextMaxWords}
                  onChange={(e) => updateUi({ contextMaxWords: Number(e.target.value) })}
                />
              </label>
              <label>
                最大文本块数
                <input
                  type="number"
                  value={settings.ui.contextMaxBlocks}
                  onChange={(e) => updateUi({ contextMaxBlocks: Number(e.target.value) })}
                />
              </label>
              {(['tabLeft', 'tabRight', 'toggleChat', 'dock'] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    value={settings.shortcuts[key]}
                    onChange={(e) => updateShortcuts({ [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </section>
        )}
        {props.errors.length > 0 && (
          <div className="form-errors" role="alert">
            {props.errors.map((error) => (
              <p key={error.path}>
                <strong>{error.path}</strong>：{error.message}
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
      .dispatch({ type: 'settings.save', requestId: requestId('save'), settings })
      .then(() => setStatus('已保存'))
      .catch(() => setStatus('保存失败'))
  }
  const test = () => {
    const validation = validateSettings(settings)
    setErrors(validation.errors)
    if (!validation.ok) {
      setStatus('请先修正配置')
      return
    }
    setStatus('正在测试连接…')
    void settingsCommand
      .dispatch({ type: 'settings.testProvider', requestId: requestId('test'), settings })
      .then(() => setStatus('连接成功'))
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : '连接失败'))
  }
  return (
    <OptionsView
      section={section}
      settings={settings}
      status={status}
      errors={errors}
      revealKey={revealKey}
      onSectionChange={setSection}
      onSettingsChange={setSettings}
      onRevealKey={() => setRevealKey((value) => !value)}
      onSave={save}
      onTest={test}
    />
  )
}
