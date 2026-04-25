import { cookies } from "next/headers";
import { executeAuthenticatedGraphQL } from "@/lib/graphql";
import { WishlistFetchDocument } from "@/gql/graphql";
import { parseWishlist } from "@/ui/components/pdp/wishlist-utils";
import { WishlistButton } from "./wishlist-button";

export async function WishlistNavItem({ channel }: { channel: string }) {
	// Reading cookies marks this component as dynamic (per-request), preventing
	// static prerender attempts during build — same pattern as CartNavItem.
	await cookies();

	let itemCount = 0;
	try {
		const result = await executeAuthenticatedGraphQL(WishlistFetchDocument, {
			cache: "no-cache",
		});
		const wishlist = result.ok && result.data.me ? parseWishlist(result.data.me.metafield) : [];
		itemCount = wishlist.length;
	} catch {
		// fall through with count = 0
	}

	return <WishlistButton itemCount={itemCount} channel={channel} />;
}
