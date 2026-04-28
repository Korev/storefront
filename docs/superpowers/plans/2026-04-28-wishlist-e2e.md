# Wishlist E2E Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Playwright e2e test suite covering all 7 wishlist user flows using a lightweight mock HTTP server in place of the real Saleor GraphQL API.

**Architecture:** A plain Node.js HTTP server (`e2e/mock-server.ts`) starts before any tests via Playwright's `globalSetup`. The Next.js dev server runs with `NEXT_PUBLIC_SALEOR_API_URL` pointed at this mock, so all server-side GraphQL calls (Server Components + Server Actions) are intercepted. Tests set the mock's current fixture state via `POST /test-control` before each navigation. The mock supports two states — `pre` (before any mutation) and `post` (after `WishlistUpdate` is received) — to handle re-renders that follow wishlist add/remove actions.

**Tech Stack:** `@playwright/test`, Node.js `http` module (no extra deps), Playwright Chromium, `pnpm`.

**All commands run from `storefront/`.**

---

## File Map

| Action | Path                                        | Responsibility                                                    |
| ------ | ------------------------------------------- | ----------------------------------------------------------------- |
| Create | `playwright.config.ts`                      | Playwright config: webServer, globalSetup/Teardown, env overrides |
| Create | `e2e/mock-server.ts`                        | Mock HTTP server; handles `/graphql/` and `/test-control`         |
| Create | `e2e/global-setup.ts`                       | Start mock server on port 4001 before test run                    |
| Create | `e2e/global-teardown.ts`                    | Stop mock server after test run                                   |
| Create | `e2e/helpers.ts`                            | `setScenario()` — calls `/test-control` from tests                |
| Create | `e2e/fixtures/product-details.json`         | `ProductDetails` query response for PDP tests                     |
| Create | `e2e/fixtures/wishlist-guest.json`          | `WishlistFetch` → `me: null`                                      |
| Create | `e2e/fixtures/wishlist-empty.json`          | `WishlistFetch` → authenticated, `metafield: "[]"`                |
| Create | `e2e/fixtures/wishlist-not-wishlisted.json` | `WishlistFetch` → authenticated, product not in list              |
| Create | `e2e/fixtures/wishlist-wishlisted.json`     | `WishlistFetch` → authenticated, product in list                  |
| Create | `e2e/fixtures/wishlist-with-items.json`     | `WishlistFetch` → authenticated, 2 items                          |
| Create | `e2e/fixtures/wishlist-products.json`       | `WishlistProducts` → 2 product cards                              |
| Create | `e2e/fixtures/wishlist-update-success.json` | `WishlistUpdate` → `{ errors: [] }`                               |
| Create | `e2e/tests/wishlist.spec.ts`                | All 7 wishlist e2e tests                                          |
| Modify | `package.json`                              | Add `test:e2e` and `test:e2e:ui` scripts                          |

---

## Task 1: Install Playwright

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install `@playwright/test`**

```bash
pnpm add -D @playwright/test
```

Expected: `@playwright/test` added to `devDependencies` in `package.json`.

- [ ] **Step 2: Install Chromium browser**

```bash
pnpm exec playwright install chromium
```

Expected: Chromium downloads (~100-200MB).

- [ ] **Step 3: Add scripts to `package.json`**

In `package.json`, add to the `"scripts"` block:

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

- [ ] **Step 4: Verify installation**

```bash
pnpm exec playwright --version
```

Expected output: `Version 1.x.x` (any recent version).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install @playwright/test for e2e suite"
```

---

## Task 2: Create `playwright.config.ts`

**Files:**

- Create: `playwright.config.ts`

- [ ] **Step 1: Create the config file**

Create `storefront/playwright.config.ts`:

```typescript
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
```

`workers: 1` ensures tests run serially so mock server state isn't shared across parallel tests. `SALEOR_MIN_REQUEST_DELAY_MS=0` removes the 200ms per-request delay from `src/lib/graphql.ts` (line 178).

- [ ] **Step 2: Verify config is valid TypeScript**

```bash
pnpm exec tsc --noEmit --skipLibCheck playwright.config.ts
```

Expected: No errors. (If `@playwright/test` types aren't found, run `pnpm install` first.)

---

## Task 3: Create `e2e/mock-server.ts`

**Files:**

- Create: `e2e/mock-server.ts`

The mock has two states: `pre` (before `WishlistUpdate`) and `post` (after). When a `WishlistUpdate` mutation is received, the state switches to `post`. The `/test-control` endpoint resets back to `pre` on every call.

- [ ] **Step 1: Create the mock server**

```bash
mkdir -p e2e
```

Create `storefront/e2e/mock-server.ts`:

```typescript
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");
const MOCK_PORT = 4001;

// Pre-load all fixtures at startup
const fixtureCache = new Map<string, object>();
for (const file of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"))) {
	fixtureCache.set(file, JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf-8")));
}

interface ScenarioState {
	pre: Record<string, string>; // operationName → fixture filename
	post: Record<string, string>; // operationName → fixture filename (after WishlistUpdate)
}

let scenarioState: ScenarioState = { pre: {}, post: {} };
let isPost = false; // false = pre state, true = post state

function getFixture(operationName: string): object {
	const fixtures = isPost ? scenarioState.post : scenarioState.pre;
	const filename = fixtures[operationName] ?? scenarioState.pre[operationName];
	if (!filename) return { data: null };
	return fixtureCache.get(filename) ?? { data: null };
}

let server: http.Server | null = null;

export function startMockServer(): Promise<void> {
	server = http.createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});

		req.on("end", () => {
			res.setHeader("Content-Type", "application/json");

			if (req.url === "/test-control" && req.method === "POST") {
				const parsed = JSON.parse(body) as ScenarioState;
				scenarioState = { pre: parsed.pre ?? {}, post: parsed.post ?? {} };
				isPost = false;
				res.writeHead(200);
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			if (req.url === "/graphql/" && req.method === "POST") {
				const { query } = JSON.parse(body) as { query: string };
				const operationName = query?.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "Unknown";

				// Switch to post-state after any mutation that modifies wishlist
				if (operationName === "WishlistUpdate") {
					isPost = true;
				}

				const response = getFixture(operationName);
				res.writeHead(200);
				res.end(JSON.stringify(response));
				return;
			}

			res.writeHead(404);
			res.end(JSON.stringify({ error: "Not found" }));
		});
	});

	return new Promise<void>((resolve, reject) => {
		server!.listen(MOCK_PORT, () => resolve());
		server!.on("error", reject);
	});
}

export function stopMockServer(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (!server) return resolve();
		server.close((err) => (err ? reject(err) : resolve()));
	});
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit --skipLibCheck e2e/mock-server.ts
```

Expected: No errors.

---

## Task 4: Create `global-setup.ts` and `global-teardown.ts`

**Files:**

- Create: `e2e/global-setup.ts`
- Create: `e2e/global-teardown.ts`

- [ ] **Step 1: Create global setup**

Create `storefront/e2e/global-setup.ts`:

```typescript
import { startMockServer } from "./mock-server.ts";

export default async function globalSetup() {
	await startMockServer();
	console.log("[mock] GraphQL mock server started on http://localhost:4001");
}
```

- [ ] **Step 2: Create global teardown**

Create `storefront/e2e/global-teardown.ts`:

```typescript
import { stopMockServer } from "./mock-server.ts";

export default async function globalTeardown() {
	await stopMockServer();
	console.log("[mock] GraphQL mock server stopped");
}
```

Note: Playwright runs `globalSetup` and `globalTeardown` in the same Node.js process, so the `server` variable in `mock-server.ts` is shared between them.

---

## Task 5: Create all fixture files

**Files:**

- Create: `e2e/fixtures/wishlist-guest.json`
- Create: `e2e/fixtures/wishlist-empty.json`
- Create: `e2e/fixtures/wishlist-not-wishlisted.json`
- Create: `e2e/fixtures/wishlist-wishlisted.json`
- Create: `e2e/fixtures/wishlist-with-items.json`
- Create: `e2e/fixtures/wishlist-products.json`
- Create: `e2e/fixtures/wishlist-update-success.json`
- Create: `e2e/fixtures/product-details.json`

Constants used across fixtures:

- **PDP test product**: `id = "TEST_PRODUCT_1"`, `slug = "test-dog-harness"`
- **Wishlist page products**: `WISHLIST_PRODUCT_1` ("Cozy Dog Sweater"), `WISHLIST_PRODUCT_2` ("Luxury Cat Bed")

- [ ] **Step 1: Create `e2e/fixtures/` directory**

```bash
mkdir -p e2e/fixtures
```

- [ ] **Step 2: Create `wishlist-guest.json`**

`WishlistFetch` response for an unauthenticated user:

```json
{ "data": { "me": null } }
```

- [ ] **Step 3: Create `wishlist-empty.json`**

`WishlistFetch` response for authenticated user with no wishlist items:

```json
{
	"data": {
		"me": {
			"id": "VXNlcjox",
			"metafield": "[]"
		}
	}
}
```

- [ ] **Step 4: Create `wishlist-not-wishlisted.json`**

`WishlistFetch` response for authenticated user — PDP product is NOT in the wishlist:

```json
{
	"data": {
		"me": {
			"id": "VXNlcjox",
			"metafield": "[]"
		}
	}
}
```

- [ ] **Step 5: Create `wishlist-wishlisted.json`**

`WishlistFetch` response for authenticated user — PDP product IS in the wishlist (`TEST_PRODUCT_1` matches `product-details.json`'s `id`):

```json
{
	"data": {
		"me": {
			"id": "VXNlcjox",
			"metafield": "[\"TEST_PRODUCT_1\"]"
		}
	}
}
```

- [ ] **Step 6: Create `wishlist-with-items.json`**

`WishlistFetch` response for authenticated user with 2 wishlist items:

```json
{
	"data": {
		"me": {
			"id": "VXNlcjox",
			"metafield": "[\"WISHLIST_PRODUCT_1\", \"WISHLIST_PRODUCT_2\"]"
		}
	}
}
```

- [ ] **Step 7: Create `wishlist-products.json`**

`WishlistProducts` response — 2 products matching `ProductListItem` fragment fields consumed by `transformToProductCard` in `src/ui/components/plp/utils.ts`:

```json
{
	"data": {
		"products": {
			"edges": [
				{
					"node": {
						"id": "WISHLIST_PRODUCT_1",
						"name": "Cozy Dog Sweater",
						"slug": "cozy-dog-sweater",
						"created": "2024-01-01T00:00:00+00:00",
						"pricing": {
							"priceRange": {
								"start": { "gross": { "amount": 29.99, "currency": "USD" } },
								"stop": { "gross": { "amount": 29.99, "currency": "USD" } }
							},
							"priceRangeUndiscounted": {
								"start": { "gross": { "amount": 29.99, "currency": "USD" } },
								"stop": { "gross": { "amount": 29.99, "currency": "USD" } }
							}
						},
						"category": { "id": "CAT_1", "name": "Dogs", "slug": "dogs" },
						"thumbnail": { "url": "https://placehold.co/400x600.webp", "alt": "Cozy Dog Sweater" },
						"variants": []
					}
				},
				{
					"node": {
						"id": "WISHLIST_PRODUCT_2",
						"name": "Luxury Cat Bed",
						"slug": "luxury-cat-bed",
						"created": "2024-01-02T00:00:00+00:00",
						"pricing": {
							"priceRange": {
								"start": { "gross": { "amount": 49.99, "currency": "USD" } },
								"stop": { "gross": { "amount": 49.99, "currency": "USD" } }
							},
							"priceRangeUndiscounted": {
								"start": { "gross": { "amount": 49.99, "currency": "USD" } },
								"stop": { "gross": { "amount": 49.99, "currency": "USD" } }
							}
						},
						"category": { "id": "CAT_2", "name": "Cats", "slug": "cats" },
						"thumbnail": { "url": "https://placehold.co/400x600.webp", "alt": "Luxury Cat Bed" },
						"variants": []
					}
				}
			]
		}
	}
}
```

- [ ] **Step 8: Create `wishlist-update-success.json`**

`WishlistUpdate` mutation success response:

```json
{
	"data": {
		"updateMetadata": {
			"errors": []
		}
	}
}
```

- [ ] **Step 9: Create `product-details.json`**

`ProductDetails` query response. The `id` matches `TEST_PRODUCT_1` used in `wishlist-wishlisted.json`. The `variants` array includes all fields from the `VariantDetails` fragment (`src/graphql/VariantDetailsFragment.graphql`):

```json
{
	"data": {
		"product": {
			"id": "TEST_PRODUCT_1",
			"name": "Test Dog Harness",
			"slug": "test-dog-harness",
			"description": null,
			"seoTitle": "Test Dog Harness",
			"seoDescription": "A test product for e2e tests",
			"thumbnail": {
				"url": "https://placehold.co/400x400.webp",
				"alt": "Test Dog Harness"
			},
			"media": [],
			"category": {
				"id": "CAT_1",
				"name": "Dogs",
				"slug": "dogs"
			},
			"attributes": [],
			"variants": [
				{
					"id": "VARIANT_1",
					"name": "Default",
					"sku": "TEST-001",
					"quantityAvailable": 10,
					"selectionAttributes": [],
					"nonSelectionAttributes": [],
					"media": [],
					"pricing": {
						"price": { "gross": { "currency": "USD", "amount": 29.99 } },
						"priceUndiscounted": { "gross": { "currency": "USD", "amount": 29.99 } }
					}
				}
			],
			"pricing": {
				"priceRange": {
					"start": { "gross": { "amount": 29.99, "currency": "USD" } },
					"stop": { "gross": { "amount": 29.99, "currency": "USD" } }
				},
				"priceRangeUndiscounted": {
					"start": { "gross": { "amount": 29.99, "currency": "USD" } },
					"stop": { "gross": { "amount": 29.99, "currency": "USD" } }
				}
			}
		}
	}
}
```

- [ ] **Step 10: Commit fixtures**

```bash
git add e2e/
git commit -m "test(e2e): add Playwright config, mock server, and fixtures"
```

---

## Task 6: Create `e2e/helpers.ts`

**Files:**

- Create: `e2e/helpers.ts`

- [ ] **Step 1: Create the helpers file**

Create `storefront/e2e/helpers.ts`:

```typescript
const MOCK_CONTROL_URL = "http://localhost:4001/test-control";

interface ScenarioConfig {
	pre: Record<string, string>;
	post?: Record<string, string>;
}

/** Set mock server fixture state before a test navigates. */
export async function setScenario(config: ScenarioConfig): Promise<void> {
	const res = await fetch(MOCK_CONTROL_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ pre: config.pre, post: config.post ?? {} }),
	});
	if (!res.ok) throw new Error(`[mock] Failed to set scenario: ${res.status}`);
}
```

---

## Task 7: Write static wishlist page tests (tests 5 and 6)

Start with the two simplest tests that don't involve mutations: empty wishlist state and guest state.

**Files:**

- Create: `e2e/tests/wishlist.spec.ts`

- [ ] **Step 1: Create the spec file with tests 5 and 6**

Create `storefront/e2e/tests/wishlist.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { setScenario } from "../helpers.ts";

const CHANNEL = "us";
const WISHLIST_URL = `/${CHANNEL}/wishlist`;
const PDP_URL = `/${CHANNEL}/products/test-dog-harness`;

test.describe("Wishlist", () => {
	// ── Test 5: Empty wishlist state ────────────────────────────────────────────
	test("shows empty state when authenticated user has no wishlist items", async ({ page }) => {
		await setScenario({
			pre: { WishlistFetch: "wishlist-empty.json" },
		});

		await page.goto(WISHLIST_URL);

		await expect(page.getByText("Your wishlist is empty")).toBeVisible();
		await expect(page.getByRole("link", { name: "Explore products" })).toBeVisible();
	});

	// ── Test 6: Guest state ─────────────────────────────────────────────────────
	test("shows login prompt when user is not authenticated", async ({ page }) => {
		await setScenario({
			pre: { WishlistFetch: "wishlist-guest.json" },
		});

		await page.goto(WISHLIST_URL);

		await expect(page.getByText("Save items you love")).toBeVisible();
		await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
	});
});
```

- [ ] **Step 2: Run tests 5 and 6 to verify they fail (infrastructure not yet running)**

```bash
pnpm exec playwright test e2e/tests/wishlist.spec.ts --project=chromium 2>&1 | head -30
```

Expected: Tests fail because no Next.js server or mock server is running yet (this is the "red" phase of TDD). If you have a dev server already running on port 3000, the tests may partially work once mock is started.

- [ ] **Step 3: Start the test suite properly**

```bash
pnpm exec playwright test e2e/tests/wishlist.spec.ts --project=chromium
```

Expected: Both tests PASS. If either fails, check:

- The mock server started (look for `[mock] GraphQL mock server started` in output)
- The Next.js server started with `NEXT_PUBLIC_SALEOR_API_URL=http://localhost:4001/graphql/`
- The fixture text matches what `src/app/[channel]/(main)/wishlist/page.tsx` renders (lines 43, 61)

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/wishlist.spec.ts e2e/helpers.ts
git commit -m "test(e2e): add wishlist static page state tests (empty + guest)"
```

---

## Task 8: Write test 3 — View wishlist page with items

**Files:**

- Modify: `e2e/tests/wishlist.spec.ts`

- [ ] **Step 1: Add test 3 to the spec**

Add inside the `test.describe("Wishlist", ...)` block, after test 6:

```typescript
// ── Test 3: View wishlist with items ───────────────────────────────────────
test("shows product grid when authenticated user has wishlist items", async ({ page }) => {
	await setScenario({
		pre: {
			WishlistFetch: "wishlist-with-items.json",
			WishlistProducts: "wishlist-products.json",
		},
	});

	await page.goto(WISHLIST_URL);

	await expect(page.getByText("Cozy Dog Sweater")).toBeVisible();
	await expect(page.getByText("Luxury Cat Bed")).toBeVisible();
	// Both products have a Remove button
	await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(2);
});
```

- [ ] **Step 2: Run test 3**

```bash
pnpm exec playwright test e2e/tests/wishlist.spec.ts -g "shows product grid" --project=chromium
```

Expected: PASS. If it fails with missing products, verify `wishlist-products.json` has the correct structure — `transformToProductCard` in `src/ui/components/plp/utils.ts` reads `product.name` (line 74), so the fixture's `node.name` must be set.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/wishlist.spec.ts
git commit -m "test(e2e): add view wishlist with items test"
```

---

## Task 9: Write test 4 — Remove item from wishlist page

**Files:**

- Modify: `e2e/tests/wishlist.spec.ts`

After clicking Remove, `removeFromWishlist` server action fires → `WishlistUpdate` mutation → mock switches to `post` state → page re-renders → `WishlistFetch` in `post` returns empty → empty state is shown.

- [ ] **Step 1: Add test 4 to the spec**

Add inside the `test.describe("Wishlist", ...)` block:

```typescript
// ── Test 4: Remove item from wishlist page ─────────────────────────────────
test("removes item from wishlist page and shows empty state", async ({ page }) => {
	await setScenario({
		pre: {
			WishlistFetch: "wishlist-with-items.json",
			WishlistProducts: "wishlist-products.json",
			WishlistUpdate: "wishlist-update-success.json",
		},
		post: {
			WishlistFetch: "wishlist-empty.json",
		},
	});

	await page.goto(WISHLIST_URL);
	await expect(page.getByText("Cozy Dog Sweater")).toBeVisible();

	// Click the first Remove button
	await page.getByRole("button", { name: "Remove" }).first().click();

	// After the server action + page re-render, wishlist is empty
	await expect(page.getByText("Your wishlist is empty")).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 2: Run test 4**

```bash
pnpm exec playwright test e2e/tests/wishlist.spec.ts -g "removes item" --project=chromium
```

Expected: PASS. If it times out waiting for empty state, check:

- `WishlistUpdate` mutation is being called (add a `console.log` in mock-server.ts to confirm)
- The `post.WishlistFetch` is being served after the mutation (mock state switches on `WishlistUpdate`)
- Increase timeout if the re-render is slow

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/wishlist.spec.ts
git commit -m "test(e2e): add remove from wishlist page test"
```

---

## Task 10: Write test 7 — Guest redirect from PDP

**Files:**

- Modify: `e2e/tests/wishlist.spec.ts`

When `WishlistFetch` returns `me: null`, `WishlistSection` sets `isLoggedIn={false}`. Clicking the button triggers `router.push(/${channel}/account)` in `add-to-wishlist.tsx` (line 22).

- [ ] **Step 1: Add test 7 to the spec**

Add inside the `test.describe("Wishlist", ...)` block:

```typescript
// ── Test 7: Guest redirect from PDP ────────────────────────────────────────
test("redirects guest user to account page when clicking Add to Wishlist", async ({ page }) => {
	await setScenario({
		pre: {
			ProductDetails: "product-details.json",
			WishlistFetch: "wishlist-guest.json",
		},
	});

	await page.goto(PDP_URL);

	// Wait for the wishlist button to appear (it's in a Suspense boundary)
	await expect(page.getByRole("button", { name: "Add to Wishlist" })).toBeVisible({ timeout: 10_000 });

	await page.getByRole("button", { name: "Add to Wishlist" }).click();

	await expect(page).toHaveURL(new RegExp(`/${CHANNEL}/account`), { timeout: 5_000 });
});
```

- [ ] **Step 2: Run test 7**

```bash
pnpm exec playwright test e2e/tests/wishlist.spec.ts -g "redirects guest" --project=chromium
```

Expected: PASS. If the button doesn't appear:

- Verify `ProductDetails` fixture (`product-details.json`) has a non-null `product` (otherwise `notFound()` is called)
- The PDP page wraps `WishlistSection` in a `Suspense` (line 199 of `src/app/[channel]/(main)/products/[slug]/page.tsx`) — the button appears only after `WishlistSection` resolves
- If `WishlistFetch` returns an error (mock not handling it), `isLoggedIn` defaults to `false`

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/wishlist.spec.ts
git commit -m "test(e2e): add guest redirect from PDP test"
```

---

## Task 11: Write tests 1 and 2 — PDP wishlist toggle

**Files:**

- Modify: `e2e/tests/wishlist.spec.ts`

The `AddToWishlist` component uses `useOptimistic` — the button text flips immediately on click (before the server action completes). Tests assert the optimistic state. The `post` state ensures the UI stays consistent if Next.js re-renders after `revalidatePath`.

- [ ] **Step 1: Add tests 1 and 2 to the spec**

Add inside the `test.describe("Wishlist", ...)` block:

```typescript
// ── Test 1: Add to wishlist from PDP ───────────────────────────────────────
test("adds product to wishlist from product detail page", async ({ page }) => {
	await setScenario({
		pre: {
			ProductDetails: "product-details.json",
			WishlistFetch: "wishlist-not-wishlisted.json",
			WishlistUpdate: "wishlist-update-success.json",
		},
		post: {
			WishlistFetch: "wishlist-wishlisted.json",
		},
	});

	await page.goto(PDP_URL);

	const wishlistButton = page.getByRole("button", { name: "Add to Wishlist" });
	await expect(wishlistButton).toBeVisible({ timeout: 10_000 });

	// Heart icon should not be filled before clicking
	const heartIcon = page.locator("button:has-text('Add to Wishlist') svg");
	await expect(heartIcon).not.toHaveClass(/fill-current/);

	await wishlistButton.click();

	// Optimistic update: button immediately shows "Wishlisted"
	await expect(page.getByRole("button", { name: "Wishlisted" })).toBeVisible({ timeout: 3_000 });

	// Heart icon should now be filled
	const filledHeart = page.locator("button:has-text('Wishlisted') svg");
	await expect(filledHeart).toHaveClass(/fill-current/);
});

// ── Test 2: Toggle wishlist off from PDP ───────────────────────────────────
test("removes product from wishlist when clicking Wishlisted button on PDP", async ({ page }) => {
	await setScenario({
		pre: {
			ProductDetails: "product-details.json",
			WishlistFetch: "wishlist-wishlisted.json",
			WishlistUpdate: "wishlist-update-success.json",
		},
		post: {
			WishlistFetch: "wishlist-not-wishlisted.json",
		},
	});

	await page.goto(PDP_URL);

	const wishlistButton = page.getByRole("button", { name: "Wishlisted" });
	await expect(wishlistButton).toBeVisible({ timeout: 10_000 });

	await wishlistButton.click();

	// Optimistic update: button immediately shows "Add to Wishlist"
	await expect(page.getByRole("button", { name: "Add to Wishlist" })).toBeVisible({ timeout: 3_000 });
});
```

- [ ] **Step 2: Run tests 1 and 2**

```bash
pnpm exec playwright test e2e/tests/wishlist.spec.ts -g "adds product|removes product from wishlist when clicking" --project=chromium
```

Expected: PASS. If `Wishlisted` button doesn't appear after clicking:

- The optimistic update fires in `add-to-wishlist.tsx` on click via `addOptimistic` (line 27) — verify React hydration completed before clicking (the `await expect(wishlistButton).toBeVisible()` call ensures this)
- If the button never shows "Wishlisted", add `await page.waitForTimeout(500)` after click and try again; if it then passes, the button was clicked before hydration

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/wishlist.spec.ts
git commit -m "test(e2e): add PDP wishlist toggle tests (add and remove)"
```

---

## Task 12: Run full suite and final commit

**Files:**

- No new files

- [ ] **Step 1: Run all 7 tests**

```bash
pnpm exec playwright test --project=chromium
```

Expected output:

```
Running 7 tests using 1 worker

  ✓ … shows empty state when authenticated user has no wishlist items
  ✓ … shows login prompt when user is not authenticated
  ✓ … shows product grid when authenticated user has wishlist items
  ✓ … removes item from wishlist page and shows empty state
  ✓ … redirects guest user to account page when clicking Add to Wishlist
  ✓ … adds product to wishlist from product detail page
  ✓ … removes product from wishlist when clicking Wishlisted button on PDP

  7 passed (…s)
```

- [ ] **Step 2: View the HTML report if any tests fail**

```bash
pnpm exec playwright show-report
```

Use traces (`trace: "on-first-retry"` in config) to debug failures: click on a failed test → Trace → inspect network calls and DOM snapshots.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "test(e2e): complete wishlist e2e suite (7 tests, Playwright + mock server)"
```

---

## Self-Review Checklist (completed inline)

- **Spec coverage**: All 7 tests from spec are implemented (tasks 7–11). Guest state (6), empty state (5), view with items (3), remove (4), redirect (7), add (1), toggle off (2). ✅
- **Placeholders**: None. All steps have complete code. ✅
- **Type consistency**: `ScenarioConfig` defined in `helpers.ts` and consumed in tests matches mock server's `ScenarioState` interface. `setScenario({ pre, post? })` matches `POST /test-control` body shape. ✅
- **Mock state**: Tests using mutations set both `pre` and `post` scenarios. Tests without mutations only set `pre`. ✅
- **File imports**: `global-setup.ts` and `global-teardown.ts` import `.ts` extension (required for Playwright's ESM transform). ✅
