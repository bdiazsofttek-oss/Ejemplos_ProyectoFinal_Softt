import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { browserName: 'chromium', channel: 'msedge', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/test-beta-server.mjs', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 30000 }
});
