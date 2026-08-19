/**
 * About page for the Options surface: extension identity, feature summary,
 * privacy story and a short architecture table. Facts mirror the manifest,
 * README and the approved design specs. Version is injected by the container
 * so this component stays presentational.
 */
export function About({ version }: { version: string }) {
  return (
    <section aria-label="关于">
      <div className="about-hero">
        <span aria-hidden="true">点</span>
        <div>
          <h1>点知 Dianzhi</h1>
          <p>网页选词 AI 阅读助手 · 版本 {version} · 最低 Chrome 141</p>
        </div>
      </div>
      <p className="lead">
        选中英文即得基于语境的精准释义、词典卡片、同义词辨析与翻译，并可继续对话。
      </p>

      <div className="settings-card guide-card">
        <h2>核心功能</h2>
        <ul className="guide-list">
          <li>
            选中英文单词或短语，浮层给出<strong>语境释义、词典卡片、同义词辨析或翻译</strong>
            （四个内置工具，也可添加自定义工具）。
          </li>
          <li>浮动气泡支持工具标签、卡片 / 对话模式、宽屏、推理过程、停止与重试。</li>
          <li>
            把当前会话移交到 <strong>Chrome 原生侧边栏</strong> 继续提问，不占用页面空间。
          </li>
          <li>
            连接任意 <strong>OpenAI 兼容</strong> 的流式接口，支持推理控制。
          </li>
        </ul>
      </div>

      <div className="settings-card guide-card">
        <h2>隐私与数据</h2>
        <ul className="guide-list">
          <li>
            API 密钥与所有设置<strong>只保存在本地数据库</strong>（OPFS SQLite），不同步到云端。
          </li>
          <li>
            会话与消息同样保存在本地；扩展<strong>无账户、无遥测</strong>，不向任何第三方发送数据。
          </li>
          <li>
            选词与上下文只在<strong>当前页面内</strong>处理；网络请求仅发往你配置的 API 服务。
          </li>
        </ul>
      </div>

      <div className="settings-card guide-card">
        <h2>工作原理</h2>
        <table className="guide-table">
          <thead>
            <tr>
              <th>组件</th>
              <th>职责</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Content script</td>
              <td>选区、上下文、锚点定位与浮层气泡</td>
            </tr>
            <tr>
              <td>Background</td>
              <td>会话权威状态、提供商流与侧边栏移交</td>
            </tr>
            <tr>
              <td>Offscreen document</td>
              <td>本地 SQLite 与全部数据存储</td>
            </tr>
            <tr>
              <td>Side Panel / Options</td>
              <td>对话历史 / 设置与使用指南</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="guide-note">点知 Dianzhi · 版本 {version} · Chrome 141+</p>
    </section>
  )
}
