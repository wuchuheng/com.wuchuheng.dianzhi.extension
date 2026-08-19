import { formatShortcut } from '@/dianzhi/domain/shortcuts'

interface ShortcutRow {
  label: string
  keys: string
  fixed?: boolean
}

const SHORTCUT_ROWS: ShortcutRow[] = [
  { label: '上一个工具', keys: formatShortcut('Control+ArrowLeft') },
  { label: '下一个工具', keys: formatShortcut('Control+ArrowRight') },
  { label: '继续对话（卡片 / 对话切换）', keys: formatShortcut('Control+Enter') },
  { label: '侧边面板（开 / 关）', keys: formatShortcut('Control+bracketleft') },
  { label: '展开 / 收起宽屏', keys: formatShortcut('Control+Shift+Enter') },
  { label: '关闭浮层', keys: formatShortcut('Escape') },
  { label: '直接切换到第 N 个工具', keys: 'Ctrl+Shift+1…9', fixed: true },
]

/**
 * Static usage handbook for the Options page. Explains the end-to-end flow
 * (select → popover → tool switching → side panel) and lists the default
 * shortcuts. Intentionally prop-free so it renders anywhere.
 */
export function UsageGuide() {
  return (
    <section aria-label="使用指南">
      <h1>使用指南</h1>
      <p className="lead">三步上手：选中英文 → 查看结果 → 切换工具。下面说明完整用法。</p>

      <div className="settings-card guide-card">
        <h2>快速开始</h2>
        <ol className="guide-steps">
          <li>
            在任意网页中<strong>选中英文</strong>单词或短语（只有英文选区会触发）。
          </li>
          <li>
            <strong>松开鼠标</strong>，浮层出现在选区旁，用第一个启用的工具（排序见「查询工具」）
            给出解释。
          </li>
          <li>
            按标签上的数字快速切换工具，或把对话<strong>移交到侧边栏</strong>继续。
          </li>
        </ol>
      </div>

      <div className="settings-card guide-card">
        <h2>选词触发</h2>
        <ul className="guide-list">
          <li>
            默认「松开鼠标」触发；改为「Alt + 松开鼠标」后，只有按住 <kbd>Alt</kbd>{' '}
            松开才会弹出浮层。
          </li>
          <li>
            默认把选区扩展为<strong>整词</strong>；按住 <kbd>Ctrl</kbd> 选词可保留精确选区。
          </li>
          <li>浮层打开期间选区高亮会保留在页面上，方便对照阅读。</li>
        </ul>
      </div>

      <div className="settings-card guide-card">
        <h2>工具切换</h2>
        <ul className="guide-list">
          <li>
            每个工具标签右下角有<strong>数字序号</strong>，按 <kbd>Ctrl+Shift+1…9</kbd>{' '}
            直接切换到对应工具（固定快捷键）。
          </li>
          <li>
            也可以用 <kbd>Ctrl+←</kbd> / <kbd>Ctrl+→</kbd> 循环切换上一个 / 下一个工具。
          </li>
          <li>标签顺序与「查询工具」页面中的排序一致，拖动排序后序号随之更新。</li>
          <li>标签上的主题色小圆点表示该工具已有会话记录；没有圆点表示尚未使用。</li>
        </ul>
      </div>

      <div className="settings-card guide-card">
        <h2>浮层操作</h2>
        <ul className="guide-list">
          <li>
            浮层默认以<strong>宽屏</strong>打开；<kbd>{formatShortcut('Control+Shift+Enter')}</kbd>{' '}
            在宽屏 / 紧凑之间切换。
          </li>
          <li>
            <kbd>{formatShortcut('Control+Enter')}</kbd>{' '}
            在「卡片」（结果）与「对话」（追问）之间切换。
          </li>
          <li>
            <kbd>{formatShortcut('Control+bracketleft')}</kbd> 把当前对话
            <strong>移交到 Chrome 侧边栏</strong>，继续提问不占页面空间。
          </li>
          <li>
            <kbd>{formatShortcut('Escape')}</kbd> 或点击浮层外部关闭；侧边栏内再按{' '}
            <kbd>{formatShortcut('Escape')}</kbd> /{' '}
            <kbd>{formatShortcut('Control+bracketleft')}</kbd> 可关闭面板。
          </li>
        </ul>
      </div>

      <div className="settings-card guide-card">
        <h2>侧边栏与弹窗</h2>
        <ul className="guide-list">
          <li>
            侧边栏延续当前标签页的对话，工具标签与浮层一致，同样支持 <kbd>Ctrl+Shift+1…9</kbd>{' '}
            切换。
          </li>
          <li>
            工具栏图标弹窗显示配置状态；未配置服务时先到「AI 服务」填写 API 地址、密钥和模型。
          </li>
        </ul>
      </div>

      <div className="settings-card guide-card">
        <h2>快捷键速查</h2>
        <table className="guide-table">
          <thead>
            <tr>
              <th>功能</th>
              <th>快捷键</th>
              <th>是否可改</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUT_ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  <kbd>{row.keys}</kbd>
                </td>
                <td className={row.fixed ? 'guide-fixed' : undefined}>
                  {row.fixed ? '固定' : '可修改'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="guide-note">
          除 <kbd>Ctrl+Shift+1…9</kbd> 为固定快捷键外，其余按键都可在「交互与快捷键」中修改。
        </p>
      </div>
    </section>
  )
}
