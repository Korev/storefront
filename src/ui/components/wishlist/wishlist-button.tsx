import Link from "next/link";
import { Heart } from "lucide-react";

interface WishlistButtonProps {
	itemCount: number;
	channel: string;
}

export function WishlistButton({ itemCount, channel }: WishlistButtonProps) {
	return (
		<Link
			href={`/${channel}/wishlist`}
			data-testid="WishlistNavItem"
			className="relative inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
		>
			<Heart className="h-5 w-5" aria-hidden="true" />
			{itemCount > 0 && (
				<span
					key={itemCount}
					className="absolute -right-0.5 -top-0.5 flex h-4 w-4 animate-cart-badge-pop items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background"
				>
					{itemCount > 9 ? "9+" : itemCount}
				</span>
			)}
			<span className="sr-only">
				{itemCount} item{itemCount !== 1 ? "s" : ""} in wishlist, view wishlist
			</span>
		</Link>
	);
}
