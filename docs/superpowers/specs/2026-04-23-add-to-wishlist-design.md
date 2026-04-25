# Add to Wishlist — Design Spec

**Date:** 2026-04-23
**Status:** Approved

## Context

Add an "Add to Wishlist" button to the product detail page (PDP), positioned below the product attributes accordion. Wishlist state is tied to the logged-in user's Saleor account. Guests who click the button are redirected to the login page.

## Data Layer

Wishlist items are stored in `User.metadata["wishlist"]` as a JSON-stringified array of Saleor product IDs:

```
"[\"UHJvZHVjdDoxNg==\", \"UHJvZHVjdDoyMg==\"]"
```

Two new GraphQL files in `src/graphql/`:

**`WishlistFetch.graphql`**

```graphql
query WishlistFetch {
	me {
		id
		metafield(key: "wishlist")
	}
}
```

**`WishlistUpdate.graphql`**

```graphql
mutation WishlistUpdate($id: ID!, $input: [MetadataInput!]!) {
	updateMetadata(id: $id, input: $input) {
		errors {
			field
			message
		}
	}
}
```

After adding these files, run `pnpm run generate` to regenerate types in `src/gql/`.

## Components

### `src/ui/components/pdp/wishlist-section.tsx` (Server Component)

Async Server Component, not cached. Fetches `me { id, metafield(key: "wishlist") }` live on each request using `executeAuthenticatedGraphQL` with `cache: "no-cache"`.

Responsibilities:

- Derives `isWishlisted` (boolean) by checking if `productId` is in the parsed metadata array
- Derives `userId` for the mutation
- Contains a Server Action (`toggleWishlist`) that reads the current wishlist, adds or removes the product ID, then calls `updateMetadata`
- If unauthenticated (no `me`), passes `isLoggedIn: false` to the button

### `src/ui/components/pdp/add-to-wishlist.tsx` (Client Component)

`"use client"`. Receives props: `isWishlisted: boolean`, `isLoggedIn: boolean`, `channel: string`, `action: () => Promise<void>`.

Responsibilities:

- Renders label "Add to Wishlist" with outline `Heart` icon (Lucide) when not wishlisted; "Wishlisted" with filled `Heart` when wishlisted
- Uses `useOptimistic` for immediate visual feedback on click
- If `isLoggedIn` is false, clicking redirects to `/${channel}/account` (client-side `useRouter`)
- If `isLoggedIn` is true, wraps in a `<form>` and submits the server action

Button styled with `variant="outline-solid"`, `size="lg"`, full width — matching the "Add to bag" button dimensions.

### Placement in `src/app/[channel]/(main)/products/[slug]/page.tsx`

Below the `<ProductAttributes>` block:

```tsx
<Suspense fallback={<div className="h-14 w-full animate-pulse rounded-md bg-secondary" />}>
	<WishlistSection productId={product.id} channel={params.channel} />
</Suspense>
```

`WishlistSection` is exported from `src/ui/components/pdp/index.ts`.

## Error Handling

- `updateMetadata` failure: optimistic state rolls back; error logged server-side via `console.error` (same pattern as `addToCart`)
- Malformed metadata JSON: caught with try/catch, treated as empty array
- Button is never disabled — always interactive

## Testing

1. **Logged-in toggle:** Sign in → visit a product page → click "Add to Wishlist" → heart fills immediately → refresh page → heart still filled (persisted to account metadata)
2. **Remove from wishlist:** Click again on a wishlisted product → heart unfills → refresh → still unfilled
3. **Guest redirect:** Sign out → visit a product page → click "Add to Wishlist" → redirected to `/${channel}/account` login form
4. **Malformed metadata:** Manually set `User.metadata["wishlist"]` to invalid JSON in Saleor Dashboard → open PDP → button renders correctly (treats as not wishlisted)
