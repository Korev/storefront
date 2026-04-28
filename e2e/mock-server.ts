import * as http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MOCK_PORT = 4001;

interface ScenarioState {
	pre: Record<string, string>; // operationName → fixture filename
	post: Record<string, string>; // operationName → fixture filename (after WishlistUpdate)
}

let scenarioState: ScenarioState = { pre: {}, post: {} };
let isPost = false; // false = pre state, true = post state

// Pre-loaded fixture cache — populated lazily inside startMockServer()
const fixtureCache = new Map<string, object>();

function getFixture(operationName: string): object {
	const fixtures = isPost ? scenarioState.post : scenarioState.pre;
	const filename = fixtures[operationName] ?? scenarioState.pre[operationName];
	if (!filename) return { data: null };
	return fixtureCache.get(filename) ?? { data: null };
}

let server: http.Server | null = null;

export function startMockServer(): Promise<void> {
	// Load fixtures lazily so the directory must exist only when the server starts
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const FIXTURES_DIR = join(__dirname, "fixtures");

	fixtureCache.clear();
	for (const file of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"))) {
		fixtureCache.set(file, JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf-8")));
	}

	server = http.createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});

		req.on("end", () => {
			res.setHeader("Content-Type", "application/json");

			if (req.url === "/test-control" && req.method === "POST") {
				const parsed = JSON.parse(body) as ScenarioState;
				scenarioState = { pre: parsed.pre ?? {}, post: parsed.post ?? {} };
				isPost = false;
				res.writeHead(200);
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			if (req.url === "/graphql/" && req.method === "POST") {
				const { query } = JSON.parse(body) as { query: string };
				const operationName = query?.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "Unknown";

				// Switch to post-state after any mutation that modifies wishlist
				if (operationName === "WishlistUpdate") {
					isPost = true;
				}

				const response = getFixture(operationName);
				res.writeHead(200);
				res.end(JSON.stringify(response));
				return;
			}

			res.writeHead(404);
			res.end(JSON.stringify({ error: "Not found" }));
		});
	});

	return new Promise<void>((resolve, reject) => {
		server!.listen(MOCK_PORT, () => resolve());
		server!.on("error", reject);
	});
}

export function stopMockServer(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (!server) return resolve();
		server.close((err) => (err ? reject(err) : resolve()));
	});
}
