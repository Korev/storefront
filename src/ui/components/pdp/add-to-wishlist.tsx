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
	const [optimisticWishlisted, addOptimistic] = useOptimistic(isWishlisted, (current: boolean) => !current);
	const [isPending, startTransition] = useTransition();

	const handleClick = () => {
		if (!isLoggedIn) {
			router.push(`/${channel}/account`);
			return;
		}
		startTransition(async () => {
			addOptimistic(undefined);
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
			<Heart className={cn("mr-2 h-5 w-5", optimisticWishlisted && "fill-current")} />
			{optimisticWishlisted ? "Wishlisted" : "Add to Wishlist"}
		</Button>
	);
}
