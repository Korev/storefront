"use server";

import { updateWishlist } from "@/ui/components/pdp/wishlist-actions";

export async function removeFromWishlist(productId: string) {
	await updateWishlist(productId);
}
