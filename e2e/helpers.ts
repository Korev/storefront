const MOCK_CONTROL_URL = "http://localhost:4001/test-control";

interface ScenarioConfig {
	pre: Record<string, string>;
	post?: Record<string, string>;
}

/** Set mock server fixture state before a test navigates. */
export async function setScenario(config: ScenarioConfig): Promise<void> {
	const res = await fetch(MOCK_CONTROL_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ pre: config.pre, post: config.post ?? {} }),
	});
	if (!res.ok) throw new Error(`[mock] Failed to set scenario: ${res.status}`);
}
