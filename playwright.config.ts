import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5191'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }
      : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js build && node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5191 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      // Never let browser tests point at either hosted Supabase project.
      VITE_SUPABASE_URL: 'https://rr-capital-test.invalid',
      VITE_SUPABASE_ANON_KEY: 'local-e2e-placeholder-anon-key',
    },
  },
})
