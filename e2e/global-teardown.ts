import { stopMockServer } from "./mock-server";

export default async function globalTeardown() {
	await stopMockServer();
	console.log("[mock] GraphQL mock server stopped");
}
