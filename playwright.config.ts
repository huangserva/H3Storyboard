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
const apiPort = readPort(process.env.H3_E2E_API_PORT, 4187);
const studioPort = readPort(process.env.H3_E2E_STUDIO_PORT, 5174);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
process.env.H3_E2E_API_ORIGIN = apiOrigin;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${studioPort}`,
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
      env: { H3_STORYBOARD_DB: databasePath,
        H3_STORYBOARD_PORT: String(apiPort),
        H3_WORKER: '0' },
      port: apiPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @h3storyboard/studio exec vite ` +
        `--host 127.0.0.1 --port ${studioPort}`,
      env: { H3_STORYBOARD_API_ORIGIN: apiOrigin },
      port: studioPort,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(
    'Playwright ports must be integers from 1 through 65535');
  return port;
}
