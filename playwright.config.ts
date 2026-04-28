import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e/tests",
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	fullyParallel: false,
	retries: process.env.CI ? 2 : 0,
	workers: 1,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL: "http://localhost:3000",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
	webServer: {
		command: "pnpm dev",
		url: "http://localhost:3000",
		timeout: 120_000,
		reuseExistingServer: !process.env.CI,
		env: {
			NEXT_PUBLIC_SALEOR_API_URL: "http://localhost:4001/graphql/",
			NEXT_PUBLIC_DEFAULT_CHANNEL: "us",
			SALEOR_MIN_REQUEST_DELAY_MS: "0",
			SALEOR_MAX_CONCURRENT_REQUESTS: "10",
		},
	},
});
