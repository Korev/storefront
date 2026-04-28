import { startMockServer } from "./mock-server";

export default async function globalSetup() {
	await startMockServer();
	console.log("[mock] GraphQL mock server started on http://localhost:4001");
}
