/**
 * Vitest Configuration
 *
 * Test runner configuration for unit and integration tests.
 *
 * @module vitest.config
 */

import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  esbuild: {
    // Match tsconfig.app.json `jsx: react-jsx` so test JSX files use the
    // automatic runtime instead of requiring `React` in scope.
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.spec.{ts,tsx}', 'tests/integration/**/*.spec.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: ['node_modules/', 'dist/', 'tests/', '**/*.config.{ts,js}', '**/types.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
