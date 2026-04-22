import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for StudyPod LM
 * Audio generation e2e tests - DIRECT MODE (No webServer)
 */
export default defineConfig({
  testDir: './tests', // Point to our specific siege tests
  testMatch: '**/*.spec.ts', // Only run e2e specs, avoid vitest .test.ts files
  fullyParallel: true,
  reporter: 'list',

  use: {
    baseURL: 'http://127.0.0.1:5173', // Point to our actual live dev server
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 60_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
