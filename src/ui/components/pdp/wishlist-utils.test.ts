import { describe, it, expect } from "vitest";
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
