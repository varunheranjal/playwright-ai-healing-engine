// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
require('dotenv').config({ override: true });

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  outputDir: './test-results',

  reporter: [
    ['list'],
    ['./shared/reporter.js', {
      customOption: 'SauceDemo Self-Healing Tests',
      projectRoot: __dirname,
    }],
    ['html', {
      outputFolder: path.join(__dirname, 'playwright-report'),
      open: 'never',
    }],
  ],

  use: {
    baseURL: 'https://www.saucedemo.com',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
    launchOptions: { slowMo: 200 },
  },

  projects: [
    {
      name: 'SauceDemo — Self-Healing Demo Tests',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
