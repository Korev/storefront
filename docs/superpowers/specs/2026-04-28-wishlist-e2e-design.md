# Wishlist E2E Test Suite — Design Spec

**Date:** 2026-04-28
**Status:** Approved

## Context

The wishlist feature is fully implemented (add/remove from PDP, view page, nav badge, guest redirect, empty states) but has zero e2e coverage. This spec defines a Playwright-based e2e test suite with mocked GraphQL responses.

## Key Architectural Constraint

All wishlist data fetching runs server-side (Next.js Server Components + Server Actions). Playwright's `page.route()` only intercepts browser-level requests and cannot intercept these calls. The mocking strategy is therefore:

- A lightweight Node.js mock HTTP server runs on port 4001 during the test run
- The Next.js dev server is started with `NEXT_PUBLIC_SALEOR_API_URL=http://localhost:4001/graphql/`
- Both `executePublicGraphQL` and `executeAuthenticatedGraphQL` in `src/lib/graphql.ts` read that env var (line 216), so all GraphQL calls hit the mock
- Auth state is simulated entirely via the `WishlistFetch` mock response: `{ me: null }` = guest, `{ me: { id, metafield } }` = logged in

## Directory Structure

```
storefront/
├── playwright.config.ts
└── e2e/
    ├── mock-server.ts              # Lightweight HTTP server, routes by operation name
    ├── global-setup.ts             # Starts mock server before test run
    ├── global-teardown.ts          # Stops mock server after test run
    ├── helpers.ts                  # setScenario() helper
    ├── fixtures/
    │   ├── wishlist-guest.json             # WishlistFetch → me: null
    │   ├── wishlist-empty.json             # WishlistFetch → authenticated, metafield: "[]"
    │   ├── wishlist-not-wishlisted.json    # WishlistFetch → user, product NOT in list
    │   ├── wishlist-wishlisted.json        # WishlistFetch → user, product IN list
    │   ├── wishlist-with-items.json        # WishlistFetch → user, 2 items
    │   ├── wishlist-products.json          # WishlistProducts → 2 product cards
    │   └── wishlist-update-success.json    # WishlistUpdate → { errors: [] }
    └── tests/
        └── wishlist.spec.ts
```

## Mock Server

A plain `http.createServer` with two routes:

### `POST /graphql/`

- Parses the `query` field from the request body
- Extracts operation name via regex: `/(?:query|mutation)\s+(\w+)/`
- Looks up the active scenario's fixture for that operation name
- Returns fixture JSON; returns `{ data: null }` for unknown operations
- Sets `Content-Type: application/json` and `Access-Control-Allow-Origin: *`
- Handles `OPTIONS` preflight

### `POST /test-control`

- Accepts `{ "scenario": "<name>" }` body
- Switches the mock's active scenario (stored in module-level variable)
- Returns `{ ok: true }`

### Scenarios

```typescript
const SCENARIOS = {
	guest: {
		WishlistFetch: "wishlist-guest.json",
	},
	"empty-wishlist": {
		WishlistFetch: "wishlist-empty.json",
	},
	"product-not-wishlisted": {
		WishlistFetch: "wishlist-not-wishlisted.json",
		WishlistUpdate: "wishlist-update-success.json",
	},
	"product-wishlisted": {
		WishlistFetch: "wishlist-wishlisted.json",
		WishlistUpdate: "wishlist-update-success.json",
	},
	"wishlist-with-items": {
		WishlistFetch: "wishlist-with-items.json",
		WishlistProducts: "wishlist-products.json",
	},
};
```

### Fixture Shapes

**wishlist-guest.json**

```json
{ "data": { "me": null } }
```

**wishlist-empty.json**

```json
{ "data": { "me": { "id": "VXNlcjox", "metafield": "[]" } } }
```

**wishlist-not-wishlisted.json**

```json
{ "data": { "me": { "id": "VXNlcjox", "metafield": "[]" } } }
```

**wishlist-wishlisted.json** — metafield contains the test product ID

```json
{ "data": { "me": { "id": "VXNlcjox", "metafield": "[\"TEST_PRODUCT_ID\"]" } } }
```

**wishlist-with-items.json** — metafield contains 2 product IDs

```json
{ "data": { "me": { "id": "VXNlcjox", "metafield": "[\"PRODUCT_1_ID\", \"PRODUCT_2_ID\"]" } } }
```

**wishlist-products.json** — WishlistProducts response with 2 products. Shape must match the `ProductListItem` fragment fields consumed by `transformToProductCard` in `src/ui/components/plp/utils.ts`. Read that file during implementation to confirm required fields (name, slug, thumbnail, pricing, brand attribute).

**wishlist-update-success.json**

```json
{ "data": { "updateMetadata": { "errors": [] } } }
```

## Playwright Config (`storefront/playwright.config.ts`)

```typescript
export default defineConfig({
	testDir: "./e2e/tests",
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	use: {
		baseURL: "http://localhost:3000",
		trace: "on-first-retry",
	},
	webServer: {
		command: "pnpm dev",
		url: "http://localhost:3000",
		reuseExistingServer: !process.env.CI,
		env: {
			NEXT_PUBLIC_SALEOR_API_URL: "http://localhost:4001/graphql/",
			SALEOR_MIN_REQUEST_DELAY_MS: "0",
		},
	},
});
```

`SALEOR_MIN_REQUEST_DELAY_MS=0` removes the 200ms per-request delay from the `RequestQueue` in `graphql.ts` so tests don't run slowly.

## Helper (`e2e/helpers.ts`)

```typescript
export async function setScenario(scenario: string) {
	await fetch("http://localhost:4001/test-control", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ scenario }),
	});
}
```

## Test Cases (`e2e/tests/wishlist.spec.ts`)

Fixed constants: `TEST_CHANNEL = 'us'`, `TEST_PRODUCT_SLUG` and `TEST_PRODUCT_ID` determined during implementation by inspecting the PDP route to see how `productId` is derived (likely from a product query result). The mock server must also cover the PDP product fetch query so the page renders — check `src/app/[channel]/(main)/products/[slug]/page.tsx` for the query used and add its fixture to the `product-not-wishlisted` and `product-wishlisted` scenarios.

| #   | Name                           | Scenario                 | Action                          | Assertion                                                       |
| --- | ------------------------------ | ------------------------ | ------------------------------- | --------------------------------------------------------------- |
| 1   | Add to wishlist from PDP       | `product-not-wishlisted` | Click "Add to Wishlist"         | Button shows "Wishlisted", heart icon has `fill-current` class  |
| 2   | Toggle wishlist off from PDP   | `product-wishlisted`     | Click "Wishlisted"              | Button shows "Add to Wishlist", heart icon loses `fill-current` |
| 3   | View wishlist page with items  | `wishlist-with-items`    | Navigate to `/us/wishlist`      | Both product names visible in grid                              |
| 4   | Remove item from wishlist page | `wishlist-with-items`    | Click "Remove" on first product | That product's article element is removed from DOM              |
| 5   | Empty wishlist state           | `empty-wishlist`         | Navigate to `/us/wishlist`      | "Your wishlist is empty" text visible                           |
| 6   | Guest state on wishlist page   | `guest`                  | Navigate to `/us/wishlist`      | "Save items you love" text visible                              |
| 7   | Guest redirect from PDP        | `guest`                  | Click "Add to Wishlist"         | URL changes to `/us/account`                                    |

Each test calls `setScenario(...)` in its `beforeEach` or at the top of the test body.

## Key Files to Read During Implementation

- `src/lib/graphql.ts` — confirms `NEXT_PUBLIC_SALEOR_API_URL` usage (line 216); rate-limit config (line 178–181)
- `src/ui/components/pdp/add-to-wishlist.tsx` — Button text, Heart icon class, guest redirect target
- `src/ui/components/pdp/wishlist-section.tsx` — WishlistFetch query, `isLoggedIn` prop derivation
- `src/app/[channel]/(main)/wishlist/page.tsx` — Empty state text, guest state text, Remove button selector
- `src/graphql/WishlistFetch.graphql`, `WishlistUpdate.graphql`, `WishlistProducts.graphql` — exact query shapes for fixtures
- `src/ui/components/plp/utils.ts` — `transformToProductCard` to understand `ProductListItem` fixture shape

## Verification

1. `cd storefront && pnpm exec playwright test` — all 7 tests pass
2. `pnpm exec playwright test --headed` — visually confirm optimistic UI for tests 1 and 2
3. `pnpm exec playwright show-report` — inspect traces for any failures
