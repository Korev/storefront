"use server";

import { executeAuthenticatedGraphQL } from "@/lib/graphql";
import { WishlistFetchDocument, WishlistUpdateDocument } from "@/gql/graphql";
import { parseWishlist } from "./wishlist-utils";

export async function updateWishlist(productId: string) {
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
