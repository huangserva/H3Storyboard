import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const e2eDirectory = process.env.H3_E2E_DIRECTORY ??
  mkdtempSync(join(tmpdir(), 'h3-storyboard-e2e-'));
const databasePath = process.env.H3_E2E_DB ??
  join(e2eDirectory, 'storyboard.db');
process.env.H3_E2E_DIRECTORY = e2eDirectory;
process.env.H3_E2E_DB = databasePath;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec tsx apps/api/src/main.ts',
      env: { H3_STORYBOARD_DB: databasePath, H3_STORYBOARD_PORT: '4187',
        H3_WORKER: '0' },
      port: 4187,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @h3storyboard/studio dev:serve',
      port: 5174,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
