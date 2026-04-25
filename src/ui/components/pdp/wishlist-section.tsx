import { connection } from "next/server";
import { executeAuthenticatedGraphQL } from "@/lib/graphql";
import { WishlistFetchDocument } from "@/gql/graphql";
import { parseWishlist } from "./wishlist-utils";
import { AddToWishlist } from "./add-to-wishlist";
import { updateWishlist } from "./wishlist-actions";

interface WishlistSectionProps {
	productId: string;
	channel: string;
}

export async function WishlistSection({ productId, channel }: WishlistSectionProps) {
	// Opt into per-request dynamic rendering — cookies() access is buried inside
	// executeAuthenticatedGraphQL and Next.js static analysis won't detect it.
	// Without this, cacheComponents:true may try to pre-render this component
	// statically, which scrambles the Suspense lazy slot on the client.
	await connection();

	const result = await executeAuthenticatedGraphQL(WishlistFetchDocument, {
		cache: "no-cache",
	});

	const user = result.ok ? result.data.me : null;
	const wishlist = parseWishlist(user?.metafield);
	const isWishlisted = wishlist.includes(productId);

	return (
		<div className="contents">
			<AddToWishlist
				isWishlisted={isWishlisted}
				isLoggedIn={!!user}
				channel={channel}
				action={updateWishlist.bind(null, productId)}
			/>
		</div>
	);
}
