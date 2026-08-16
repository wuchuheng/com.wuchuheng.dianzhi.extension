import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

const crxManifest = defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  minimum_chrome_version: '141',
  icons: {
    48: 'public/logo.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
    },
    default_popup: 'src/popup/index.html',
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  permissions: ['storage', 'offscreen', 'sidePanel'],
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

export const dianzhiManifest = Object.assign(crxManifest, {
  cross_origin_opener_policy: { value: 'same-origin' as const },
  cross_origin_embedder_policy: { value: 'require-corp' as const },
})

export default dianzhiManifest
