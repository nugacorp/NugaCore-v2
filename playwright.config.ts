import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${PORT}/api/health/live`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'test',
      PUBLIC_DEPLOYMENT: 'false',
      AUTH_TRUST_HEADERS: 'true',
      LEGACY_SINGLE_WISP_FALLBACK: 'true',
      USE_DB_CUSTOMERS: 'false',
      USE_DB_PLANS: 'false',
      USE_DB_BILLING: 'false',
      USE_DB_PAYMENTS: 'false',
      USE_DB_INVENTORY: 'false',
      USE_DB_SUPPORT: 'false',
      USE_DB_SUSPENSION: 'false',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
