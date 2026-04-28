import { test, expect } from "@playwright/test";
import { setScenario } from "../helpers";

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
		await expect(page.getByRole("main").getByRole("link", { name: "Log in" })).toBeVisible();
	});

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
		await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(2);
	});

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

		await page.getByRole("button", { name: "Remove" }).first().click();

		await expect(page.getByText("Your wishlist is empty")).toBeVisible({ timeout: 10_000 });
	});

	// ── Test 7: Guest redirect from PDP ────────────────────────────────────────
	test("redirects guest user to account page when clicking Add to Wishlist", async ({ page }) => {
		await setScenario({
			pre: {
				ProductDetails: "product-details.json",
				WishlistFetch: "wishlist-guest.json",
			},
		});

		await page.goto(PDP_URL);

		await expect(page.getByRole("button", { name: "Add to Wishlist" })).toBeVisible({ timeout: 10_000 });
		await page.getByRole("button", { name: "Add to Wishlist" }).click();

		await expect(page).toHaveURL(new RegExp(`/${CHANNEL}/account`), { timeout: 5_000 });
	});

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

		const heartIcon = page.locator("button:has-text('Add to Wishlist') svg");
		await expect(heartIcon).not.toHaveClass(/fill-current/);

		await wishlistButton.click();

		await expect(page.getByRole("button", { name: "Wishlisted" })).toBeVisible({ timeout: 3_000 });

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

		await expect(page.getByRole("button", { name: "Add to Wishlist" })).toBeVisible({ timeout: 3_000 });
	});
});
