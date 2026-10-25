const { defineConfig } = require("@playwright/test");

const port = Number(process.env.UI_TEST_PORT || 4400);
module.exports = defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/ui-test-server.js",
    url: `http://127.0.0.1:${port}`,
    timeout: 30000,
    reuseExistingServer: false,
  },
});
