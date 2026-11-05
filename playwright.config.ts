import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Načte .env.test (bez tajných údajů) pro server i testy.
const env: Record<string, string> = {};
for (const line of readFileSync('.env.test', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
Object.assign(process.env, env);

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './test/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure', ...devices['iPhone 13'], browserName: 'chromium' },
  webServer: [
    { command: 'node test/support/mock-auth-server.mjs', port: 54321, reuseExistingServer: false, env },
    { command: 'npx next start -p 3100', port: 3100, reuseExistingServer: false, env, timeout: 60_000 },
  ],
});
