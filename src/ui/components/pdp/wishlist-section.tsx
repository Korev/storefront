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
