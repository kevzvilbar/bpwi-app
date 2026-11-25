import { defineConfig, devices } from '@playwright/test';

const useLocalChrome = !process.env.CI && process.platform === 'win32';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: useLocalChrome ? 'chrome' : undefined,
        launchOptions: undefined,
      },
    },
  ],
  webServer: {
    command: 'npx next start -H 127.0.0.1 -p 3100',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
