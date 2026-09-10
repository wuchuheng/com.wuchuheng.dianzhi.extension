# 点知 Dianzhi

点知是一个 Chrome 141+ 阅读助手。选择网页中的英文文本后，它会在选区旁显示带箭头的 AI 查询气泡；你可以切换语境、同义词和翻译工具，也可以把当前实时会话移交到 Chrome 原生 Side Panel，并在那里查看完整历史和继续提问。

## 功能

- 只响应有效英文选区，并从页面正文提取有界上下文。
- 浮动气泡支持工具标签、卡片/对话模式、宽屏、推理过程、停止和重试。
- Chrome 原生 Side Panel 展示当前会话完整历史，支持继续提问和工具切换；没有新建会话或归档入口。
- 对话与消息由后台统一管理，并通过 offscreen document 保存到 OPFS SQLite。
- 支持 OpenAI 兼容的流式 `/chat/completions` 服务。
- 设置页支持内置/自定义工具、提示词、上下文限制、快捷键，以及 `reasoning_effort` 或 `enable_thinking`。

## 架构

| 上下文                    | 职责                                                  |
| ------------------------- | ----------------------------------------------------- |
| Content script            | 选区、上下文、锚点定位与 Shadow DOM 气泡              |
| Background service worker | 会话权威状态、提供商流、Side Panel 移交与跨上下文校验 |
| Offscreen document        | `web-sqlite-js@2.3.0`、OPFS SQLite 和全部 SQL         |
| Side Panel                | 当前选区会话的完整历史与后续提问                      |
| Options / Popup           | 持久设置、连接测试和配置状态                          |

数据库使用整数自增主键。`conversations` 保存选区、工具和提示词快照；`messages` 保存顺序、角色、内容、推理内容与终态。新选区会替换当前标签页的旧选区组。

## 安装与构建

```bash
pnpm install
pnpm run build
```

打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”，然后选择本项目的 `dist/` 目录。最低 Chrome 版本是 141。

首次使用时点击扩展图标并打开设置，填写：

1. OpenAI 兼容 API 地址（不包含或包含 `/chat/completions` 均可）。
2. API Key 与模型名。
3. 如需要，选择推理控制方式：默认发送 `reasoning_effort`；选择 `enable_thinking` 后只发送对应布尔值。
4. 点击“测试连接”，成功后保存。

扩展需要 `http://*/*` 和 `https://*/*` 主机权限，以便后台访问用户配置的 AI 服务；内容脚本本身只注入 HTTPS 页面。API Key 保存在 `chrome.storage.sync`，不会写入 SQLite 或日志。

`webNavigation` 权限用于校验划词消息是否来自标签页当前文档：单页应用切换路由后，Chrome 的消息来源 URL 可能仍是文档最初的 URL。后台核对文档 ID 后使用当前路由，并在会话缓存过期时重新同步；旧文档的请求仍返回 `UI_SESSION_STALE`。

## 快捷键

默认值可在设置中修改：

- `Ctrl+←` / `Ctrl+→`：切换查询工具。
- `Ctrl+Enter`：切换气泡卡片/对话模式。
- `Ctrl+[`：把当前会话移交到原生 Side Panel。
- Side Panel 中 `Ctrl+.`：停止生成。
- `Esc`：关闭当前气泡或 Side Panel。
- Composer 中 Enter 发送，Shift+Enter 换行。

## 开发与验证

```bash
pnpm run format:check
pnpm run lint
pnpm run test
pnpm run build
pnpm run test:e2e
```

E2E 使用真实 Chromium、解压后的扩展、OPFS SQLite 和本地 mock SSE 服务。若 Chromium 不在 `/snap/bin/chromium`，设置 `CHROMIUM_PATH`。

## 数据与安全

- SQLite 文件位于扩展源的 OPFS 中，由 offscreen document 独占连接。
- 扩展不执行远程脚本，不接受任意 SQL，也没有内存数据库降级路径。
- CSP 只允许本地脚本/worker和 WASM；`web-sqlite-js` worker 在构建时固定为 2.3.0 并打包到扩展。
- 删除扩展会由 Chrome 管理其扩展存储和 OPFS 数据；产品当前不提供会话归档浏览器。

## 排障

- `PROVIDER_NOT_CONFIGURED`：在设置中补全 API Key 和模型。
- `PROVIDER_HTTP_ERROR`：检查地址、密钥、模型以及服务端返回信息。
- `PROVIDER_STREAM_ERROR`：检查网络、CORS/网关和 SSE 格式。
- `DB_UNAVAILABLE`：确认 Chrome 141+、OPFS、SharedArrayBuffer 和打包 worker 可用，然后重新加载扩展。
- Side Panel 未打开：必须从网页气泡的 ⇥ 按钮或配置的快捷键触发，以保留 Chrome 的用户手势。
