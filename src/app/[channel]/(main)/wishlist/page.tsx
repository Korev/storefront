import { connection } from "next/server";
import Image from "next/image";
import { Heart } from "lucide-react";
import { executeAuthenticatedGraphQL, executePublicGraphQL } from "@/lib/graphql";
import { WishlistFetchDocument, WishlistProductsDocument } from "@/gql/graphql";
import { parseWishlist } from "@/ui/components/pdp/wishlist-utils";
import { transformToProductCard } from "@/ui/components/plp/utils";
import Link from "next/link";
import { removeFromWishlist } from "./actions";

export const metadata = {
	title: "Wishlist",
};

export default async function WishlistPage({ params }: { params: Promise<{ channel: string }> }) {
	const { channel } = await params;
	return (
		<section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
			<h1 className="mb-8 text-3xl font-bold">Wishlist</h1>
			<WishlistContent channel={channel} />
		</section>
	);
}

async function WishlistContent({ channel }: { channel: string }) {
	await connection();

	const authResult = await executeAuthenticatedGraphQL(WishlistFetchDocument, {
		cache: "no-cache",
	});

	if (!authResult.ok || !authResult.data.me) {
		return (
			<div className="flex flex-col items-center gap-6 py-24 text-center">
				<Heart className="h-12 w-12 text-muted-foreground" />
				<div>
					<p className="text-lg font-medium">Save items you love</p>
					<p className="mt-1 text-muted-foreground">
						Log in to see your saved items and keep them for later.
					</p>
				</div>
				<Link
					href={`/${channel}/login`}
					className="rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:opacity-90"
				>
					Log in
				</Link>
			</div>
		);
	}

	const wishlistIds = parseWishlist(authResult.data.me.metafield);

	if (wishlistIds.length === 0) {
		return (
			<div className="flex flex-col items-center gap-6 py-24 text-center">
				<Heart className="h-12 w-12 text-muted-foreground" />
				<div>
					<p className="text-lg font-medium">Your wishlist is empty</p>
					<p className="mt-1 text-muted-foreground">
						Browse products and tap the heart icon to save them here.
					</p>
				</div>
				<Link
					href={`/${channel}/products`}
					className="rounded-md bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:opacity-90"
				>
					Explore products
				</Link>
			</div>
		);
	}

	const productsResult = await executePublicGraphQL(WishlistProductsDocument, {
		variables: { ids: wishlistIds, channel },
		cache: "no-cache",
	});

	const products = (productsResult.ok ? productsResult.data.products?.edges.map((e) => e.node) : null) ?? [];

	return (
		<div className="grid grid-cols-2 gap-4 lg:grid-cols-3 lg:gap-6">
			{products.map((product) => {
				const card = transformToProductCard(product, channel);
				const removeAction = removeFromWishlist.bind(null, product.id);
				return (
					<article key={product.id} className="group relative">
						<Link href={`/${channel}/products/${product.slug}`} className="block">
							<div className="relative mb-4 aspect-[3/4] overflow-hidden rounded-xl bg-secondary">
								<Image
									src={card.image}
									alt={card.imageAlt || card.name}
									fill
									sizes="(max-width: 1024px) 50vw, 33vw"
									className="object-cover transition-all duration-500 ease-out md:group-hover:scale-105"
								/>
							</div>
							<div className="space-y-1.5">
								{card.brand && <p className="text-xs tracking-wide text-muted-foreground">{card.brand}</p>}
								<h3 className="line-clamp-2 font-medium leading-snug underline-offset-2 md:group-hover:underline">
									{card.name}
								</h3>
								<div className="flex items-center gap-2 pt-0.5">
									<span className="font-semibold">
										{new Intl.NumberFormat("en", { style: "currency", currency: card.currency }).format(
											card.price,
										)}
									</span>
									{card.compareAtPrice && (
										<span className="text-sm text-muted-foreground line-through">
											{new Intl.NumberFormat("en", { style: "currency", currency: card.currency }).format(
												card.compareAtPrice,
											)}
										</span>
									)}
								</div>
							</div>
						</Link>
						<form action={removeAction} className="mt-3">
							<button
								type="submit"
								className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
							>
								Remove
							</button>
						</form>
					</article>
				);
			})}
		</div>
	);
}
