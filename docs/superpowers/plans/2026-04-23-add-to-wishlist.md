# Add to Wishlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Add to Wishlist" button below the product attributes accordion on the PDP, persisted to the logged-in user's Saleor account metadata; guests are redirected to login.

**Architecture:** Wishlist items are stored as a JSON-stringified array of product IDs in `User.metadata["wishlist"]` via Saleor's `updateMetadata` mutation. A new async Server Component (`WishlistSection`) fetches the current wishlist live and passes initial state + a Server Action to a Client Component button (`AddToWishlist`) that handles optimistic toggling and guest redirects.

**Tech Stack:** Next.js 16 App Router, React 19 `useOptimistic` + `useTransition`, GraphQL Codegen, Saleor `updateMetadata` mutation.

---

## File Map

| Action | Path                                                | Responsibility                                                |
| ------ | --------------------------------------------------- | ------------------------------------------------------------- |
| Create | `src/graphql/WishlistFetch.graphql`                 | Query `me.id` + `me.metafield(key:"wishlist")`                |
| Create | `src/graphql/WishlistUpdate.graphql`                | Mutation to write updated wishlist array to user metadata     |
| Create | `src/ui/components/pdp/wishlist-utils.ts`           | Pure `parseWishlist` helper                                   |
| Create | `src/ui/components/pdp/wishlist-utils.test.ts`      | Unit tests for `parseWishlist`                                |
| Create | `src/ui/components/pdp/add-to-wishlist.tsx`         | Client Component — Heart button with optimistic toggle        |
| Create | `src/ui/components/pdp/wishlist-section.tsx`        | Server Component — fetches wishlist state, owns Server Action |
| Modify | `src/ui/components/pdp/index.ts`                    | Export `WishlistSection`                                      |
| Modify | `src/app/[channel]/(main)/products/[slug]/page.tsx` | Render `<WishlistSection>` below `<ProductAttributes>`        |

---

## Task 1: Add GraphQL files and regenerate types

**Files:**

- Create: `src/graphql/WishlistFetch.graphql`
- Create: `src/graphql/WishlistUpdate.graphql`

- [ ] **Step 1: Create `WishlistFetch.graphql`**

```graphql
# src/graphql/WishlistFetch.graphql
query WishlistFetch {
	me {
		id
		metafield(key: "wishlist")
	}
}
```

- [ ] **Step 2: Create `WishlistUpdate.graphql`**

```graphql
# src/graphql/WishlistUpdate.graphql
mutation WishlistUpdate($id: ID!, $input: [MetadataInput!]!) {
	updateMetadata(id: $id, input: $input) {
		errors {
			field
			message
		}
	}
}
```

- [ ] **Step 3: Run codegen**

```bash
pnpm run generate
```

Expected: no errors; `src/gql/graphql.ts` now contains `WishlistFetchDocument`, `WishlistFetchQuery`, `WishlistUpdateDocument`, `WishlistUpdateMutation`, `WishlistUpdateMutationVariables`.

- [ ] **Step 4: Commit**

```bash
git add src/graphql/WishlistFetch.graphql src/graphql/WishlistUpdate.graphql src/gql/
git commit -m "feat: add WishlistFetch and WishlistUpdate GraphQL operations"
```

---

## Task 2: Wishlist utility + unit tests

**Files:**

- Create: `src/ui/components/pdp/wishlist-utils.ts`
- Create: `src/ui/components/pdp/wishlist-utils.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/ui/components/pdp/wishlist-utils.test.ts`:

```ts
import { parseWishlist } from "./wishlist-utils";

describe("parseWishlist", () => {
	it("returns empty array for null", () => {
		expect(parseWishlist(null)).toEqual([]);
	});

	it("returns empty array for undefined", () => {
		expect(parseWishlist(undefined)).toEqual([]);
	});

	it("returns empty array for empty string", () => {
		expect(parseWishlist("")).toEqual([]);
	});

	it("returns parsed array for valid JSON array", () => {
		expect(parseWishlist('["UHJvZHVjdDoxNg==","UHJvZHVjdDoyMg=="]')).toEqual([
			"UHJvZHVjdDoxNg==",
			"UHJvZHVjdDoyMg==",
		]);
	});

	it("returns empty array for malformed JSON", () => {
		expect(parseWishlist("not-json")).toEqual([]);
	});

	it("returns empty array when JSON value is not an array", () => {
		expect(parseWishlist('{"key":"value"}')).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:run src/ui/components/pdp/wishlist-utils.test.ts
```

Expected: FAIL — `Cannot find module './wishlist-utils'`

- [ ] **Step 3: Implement `parseWishlist`**

Create `src/ui/components/pdp/wishlist-utils.ts`:

```ts
export function parseWishlist(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:run src/ui/components/pdp/wishlist-utils.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/pdp/wishlist-utils.ts src/ui/components/pdp/wishlist-utils.test.ts
git commit -m "feat: add parseWishlist utility with tests"
```

---

## Task 3: `add-to-wishlist.tsx` — Client Component

**Files:**

- Create: `src/ui/components/pdp/add-to-wishlist.tsx`

- [ ] **Step 1: Create the component**

Create `src/ui/components/pdp/add-to-wishlist.tsx`:

```tsx
"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import { cn } from "@/lib/utils";

interface AddToWishlistProps {
	isWishlisted: boolean;
	isLoggedIn: boolean;
	channel: string;
	action: () => Promise<void>;
}

export function AddToWishlist({ isWishlisted, isLoggedIn, channel, action }: AddToWishlistProps) {
	const router = useRouter();
	const [optimisticWishlisted, addOptimistic] = useOptimistic(
		isWishlisted,
		(_current: boolean, next: boolean) => next,
	);
	const [isPending, startTransition] = useTransition();

	const handleClick = () => {
		if (!isLoggedIn) {
			router.push(`/${channel}/account`);
			return;
		}
		startTransition(async () => {
			addOptimistic(!optimisticWishlisted);
			await action();
		});
	};

	return (
		<Button
			type="button"
			variant="outline-solid"
			size="lg"
			onClick={handleClick}
			disabled={isPending}
			className={cn(
				"h-14 w-full text-base font-medium transition-all duration-200",
				isPending && "opacity-70",
			)}
		>
			<Heart
				className={cn("mr-2 h-5 w-5 transition-all duration-200", optimisticWishlisted && "fill-current")}
			/>
			{optimisticWishlisted ? "Wishlisted" : "Add to Wishlist"}
		</Button>
	);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/components/pdp/add-to-wishlist.tsx
git commit -m "feat: add AddToWishlist client component"
```

---

## Task 4: `wishlist-section.tsx` — Server Component + Server Action

**Files:**

- Create: `src/ui/components/pdp/wishlist-section.tsx`

- [ ] **Step 1: Create the component**

Create `src/ui/components/pdp/wishlist-section.tsx`:

```tsx
import { executeAuthenticatedGraphQL } from "@/lib/graphql";
import { WishlistFetchDocument, WishlistUpdateDocument } from "@/gql/graphql";
import { parseWishlist } from "./wishlist-utils";
import { AddToWishlist } from "./add-to-wishlist";

interface WishlistSectionProps {
	productId: string;
	channel: string;
}

export async function WishlistSection({ productId, channel }: WishlistSectionProps) {
	const result = await executeAuthenticatedGraphQL(WishlistFetchDocument, {
		cache: "no-cache",
	});

	const user = result.ok ? result.data.me : null;
	const wishlist = parseWishlist(user?.metafield);
	const isWishlisted = wishlist.includes(productId);

	async function toggleWishlist() {
		"use server";

		const current = await executeAuthenticatedGraphQL(WishlistFetchDocument, {
			cache: "no-cache",
		});

		if (!current.ok || !current.data.me) return;

		const currentList = parseWishlist(current.data.me.metafield);
		const updated = currentList.includes(productId)
			? currentList.filter((id) => id !== productId)
			: [...currentList, productId];

		const updateResult = await executeAuthenticatedGraphQL(WishlistUpdateDocument, {
			variables: {
				id: current.data.me.id,
				input: [{ key: "wishlist", value: JSON.stringify(updated) }],
			},
			cache: "no-cache",
		});

		if (!updateResult.ok) {
			console.error("Wishlist update failed:", updateResult.error.message);
		}
	}

	return (
		<AddToWishlist
			isWishlisted={isWishlisted}
			isLoggedIn={!!user}
			channel={channel}
			action={toggleWishlist}
		/>
	);
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/pdp/wishlist-section.tsx
git commit -m "feat: add WishlistSection server component with toggle action"
```

---

## Task 5: Wire up — export and place on PDP

**Files:**

- Modify: `src/ui/components/pdp/index.ts`
- Modify: `src/app/[channel]/(main)/products/[slug]/page.tsx`

- [ ] **Step 1: Export `WishlistSection` from pdp index**

In `src/ui/components/pdp/index.ts`, add after the last export line:

```ts
export { WishlistSection } from "./wishlist-section";
```

- [ ] **Step 2: Add `WishlistSection` to the product page**

In `src/app/[channel]/(main)/products/[slug]/page.tsx`:

Add `WishlistSection` to the import:

```ts
import {
	ProductGallery,
	ProductAttributes,
	VariantSectionDynamic,
	VariantSectionSkeleton,
	VariantSectionError,
	WishlistSection,
} from "@/ui/components/pdp";
```

Then replace the `<div className="order-4 mt-6">` block (currently wrapping `<ProductAttributes>`) with:

```tsx
<div className="order-4 mt-6 space-y-4">
	<ProductAttributes
		descriptionHtml={descriptionHtml}
		attributes={productAttributes}
		careInstructions={careInstructions}
	/>
	<Suspense fallback={<div className="h-14 w-full animate-pulse rounded-md bg-secondary" />}>
		<WishlistSection productId={product.id} channel={params.channel} />
	</Suspense>
</div>
```

- [ ] **Step 3: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/pdp/index.ts src/app/[channel]/\(main\)/products/\[slug\]/page.tsx
git commit -m "feat: wire up WishlistSection on product detail page"
```

---

## Task 6: Manual verification

- [ ] **Step 1: Ensure dev servers are running**

Backend (from `saleor/`):

```bash
set -a && source .env && set +a && source .venv/bin/activate
uvicorn saleor.asgi:application --reload --port 8000
```

Frontend (from `storefront/`):

```bash
pnpm dev
```

- [ ] **Step 2: Test logged-in toggle**

1. Open http://localhost:3000 and sign in as `admin@example.com` / `admin`
2. Navigate to any product page
3. Scroll below the attributes accordion — confirm "Add to Wishlist" button with outline heart appears
4. Click it — heart should fill immediately and label changes to "Wishlisted"
5. Refresh the page — button should still show "Wishlisted" (persisted to account)

- [ ] **Step 3: Test removal**

1. Click the "Wishlisted" button again — heart unfills, label returns to "Add to Wishlist"
2. Refresh — still shows "Add to Wishlist"

- [ ] **Step 4: Test guest redirect**

1. Sign out
2. Navigate to any product page
3. Click "Add to Wishlist" — should redirect to `/<channel>/account` showing the login form

- [ ] **Step 5: Run full test suite**

```bash
pnpm test:run
```

Expected: all tests pass including the 6 new `parseWishlist` tests.
