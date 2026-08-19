import { useEffect, useState } from 'react'
import { settingsCommand } from '@/events/config'
import './App.css'

export function PopupView({
  configured,
  onOpenSettings,
}: {
  configured: boolean
  onOpenSettings(): void
}) {
  return (
    <main className="popup-card">
      <header>
        <span className="popup-logo">点</span>
        <div>
          <strong>点知</strong>
          <small>Dianzhi reading assistant</small>
        </div>
      </header>
      <div className={`popup-status ${configured ? 'ready' : 'missing'}`}>
        <span aria-hidden="true" />
        <div>
          <strong>{configured ? 'AI 服务已配置' : '尚未配置 AI 服务'}</strong>
          <p>{configured ? '选择网页中的英文文本即可开始。' : '先填写 API 地址、密钥和模型。'}</p>
        </div>
      </div>
      <section className="popup-guide" aria-label="如何使用">
        <h2>如何使用</h2>
        <ol>
          <li>
            在网页中<strong>选中英文</strong>单词或短语，松开鼠标弹出浮层（仅英文选区触发）。
          </li>
          <li>
            按住 <kbd>Ctrl</kbd> 选词保留精确选区；默认会把选区扩展为整词。
          </li>
          <li>
            用标签上的数字 <kbd>Ctrl+Shift+1…9</kbd> 直接切换工具，对话可移交到侧边栏。
          </li>
        </ol>
      </section>
      <button type="button" onClick={onOpenSettings}>
        打开设置
      </button>
      <p className="popup-hint">选词后使用弹窗，或将对话移交到 Chrome 侧边栏。</p>
    </main>
  )
}

export default function App() {
  const [configured, setConfigured] = useState(false)
  useEffect(() => {
    void settingsCommand
      .dispatch({ type: 'settings.get', requestId: `popup-${Date.now()}` })
      .then((settings) =>
        setConfigured(Boolean(settings.provider.apiKey.trim() && settings.provider.model.trim()))
      )
  }, [])
  return (
    <PopupView
      configured={configured}
      onOpenSettings={() => void chrome.runtime.openOptionsPage()}
    />
  )
}
