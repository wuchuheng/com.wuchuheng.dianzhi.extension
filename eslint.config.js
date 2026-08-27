import eslintJS from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-plugin-prettier'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '.chromiumCache',
      '.chrome-data',
      '.claude/skills',
      '.opencode',
      '.superpowers',
      '.worktrees',
      'src/vendor/web-sqlite',
      'src/vendor/web-sqlite-v2',
      'web-sqlite-js/**',
      '.agents/**',
      '*.config.ts',
      'manifest.config.ts',
    ],
  },
  eslintJS.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      prettier,
      'unused-imports': unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'prettier/prettier': 'error',
      'no-unused-vars': 'off', // or "@typescript-eslint/no-unused-vars": "off",
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
      parserOptions: {
        projectService: {
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 100,
          allowDefaultProject: [
            'eslint.config.js',
            '*.config.js',
            '*.config.ts',
            'tests/unit/background/conversation-manager.spec.ts',
            'tests/unit/background/ui-session-coordinator.spec.ts',
            'tests/unit/background/provider-runner.spec.ts',
            'tests/unit/events/side-panel-event.spec.ts',
            'tests/unit/domain/shortcuts.spec.ts',
            'tests/unit/content/selection/words.spec.ts',
            'tests/unit/content/selection/context.spec.ts',
            'tests/unit/content/views/scroll-guard.spec.ts',
            'tests/unit/content/views/useScrollGuard.spec.tsx',
            'tests/unit/content/views/App.spec.tsx',
            'tests/unit/dianzhi/presets.spec.ts',
            'tests/unit/dianzhi/protocol.spec.ts',
            'tests/unit/dianzhi/provider/client.spec.ts',
            'tests/unit/dianzhi/provider/request.spec.ts',
            'tests/unit/dianzhi/provider/sse.spec.ts',
            'tests/unit/dianzhi/provider/throughput.spec.ts',
            'tests/unit/dianzhi/settings.spec.ts',
            'tests/unit/dianzhi/ui/Composer.spec.tsx',
            'tests/unit/dianzhi/ui/message-time.spec.ts',
            'tests/unit/dianzhi/ui/markdown-text.spec.ts',
            'tests/unit/dianzhi/ui/MessageList.spec.tsx',
            'tests/unit/dianzhi/ui/Markdown.spec.tsx',
            'tests/unit/dianzhi/ui/MarkdownStyles.spec.tsx',
            'tests/unit/dianzhi/ui/ToolTabs.spec.tsx',
            'tests/unit/dianzhi/ui/ProviderSetup.spec.tsx',
            'tests/unit/dianzhi/ui/streaming-value-controller.spec.ts',
            'tests/unit/dianzhi/ui/use-streaming-height.spec.tsx',
            'tests/unit/offscreen/config-store.spec.ts',
            'tests/unit/offscreen/database-rpc.spec.ts',
            'tests/unit/offscreen/migration-2-1-0.spec.ts',
            'tests/unit/offscreen/migration-2-2-0.spec.ts',
            'tests/unit/offscreen/migration-2-3-0.spec.ts',
            'tests/unit/offscreen/conversation-store.spec.ts',
            'tests/unit/offscreen/sqlite-helper.ts',
            'tests/unit/options/App.spec.tsx',
            'tests/unit/options/ToolList.spec.tsx',
            'tests/unit/options/ToolConfig.spec.tsx',
            'tests/unit/sidepanel/App.spec.tsx',
            'tests/unit/sidepanel/scroll-follow.spec.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  }
)
