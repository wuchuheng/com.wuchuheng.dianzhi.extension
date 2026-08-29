import { defineManifest, type ManifestV3Export } from '@crxjs/vite-plugin'
import pkg from './package.json'

const crxManifest = defineManifest({
  manifest_version: 3,
  name: '点知 - 划词即懂｜AI 结合上下文，精准解释你选中的英文',
  short_name: '点知',
  version: pkg.version,
  minimum_chrome_version: '141',
  description:
    '基于上下文的 AI 英文划词阅读助手。选中网页中的英文，即可获得贴合当前语境的释义、词典、同义词与翻译，并在 Chrome 侧边栏继续追问。',
  icons: {
    16: 'public/logo-16.png',
    32: 'public/logo-32.png',
    48: 'public/logo-48.png',
    128: 'public/logo-128.png',
  },
  action: {
    default_icon: {
      16: 'public/logo-16.png',
      32: 'public/logo-32.png',
      48: 'public/logo-48.png',
      128: 'public/logo-128.png',
    },
    default_popup: 'src/popup/index.html',
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  permissions: ['storage', 'offscreen', 'sidePanel'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      js: ['src/content/main.tsx'],
      matches: ['https://*/*'],
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self';",
  },
})

// defineManifest returns ManifestV3Export (a union with Promise/function variants).
// The runtime value is a plain object; narrow the export to the concrete manifest
// shape so consumers can read manifest fields without a double-cast.
type CrxManifestV3 = Extract<ManifestV3Export, { manifest_version: number }>

export const dianzhiManifest = Object.assign(crxManifest, {
  cross_origin_opener_policy: { value: 'same-origin' as const },
  cross_origin_embedder_policy: { value: 'require-corp' as const },
}) as CrxManifestV3 & {
  cross_origin_opener_policy: { value: 'same-origin' }
  cross_origin_embedder_policy: { value: 'require-corp' }
}

export default dianzhiManifest
