import { defineConfig } from '@playwright/test'
// Do not let a developer's system HTTP proxy answer the local readiness probe.
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost', '127.0.0.1'].filter(Boolean).join(',')
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5439',
    channel: process.env.WEBP_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined)
  },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:5439', reuseExistingServer: !process.env.CI },
  reporter: [['list']],
  timeout: 30000
})
