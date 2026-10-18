import { expect, test } from "claude-code/testing";
import { RECHECK_MARGIN_MS, recheckDelay } from "../src/liveness";

test("a beat inside the grace window schedules a recheck just past it", () => {
	expect(recheckDelay(10_000, 9_000, 0, 5000)).toBe(4000 + RECHECK_MARGIN_MS);
	expect(recheckDelay(10_000, 10_000, 0, 5000)).toBe(5000 + RECHECK_MARGIN_MS);
	// The newer of beat and timer start counts.
	expect(recheckDelay(10_000, 1_000, 8_000, 5000)).toBe(
		3000 + RECHECK_MARGIN_MS,
	);
	// Exactly at the edge is still inside the grace.
	expect(recheckDelay(10_000, 5_000, 0, 5000)).toBe(RECHECK_MARGIN_MS);
});

test("a beat past the grace window needs a restart, not a recheck", () => {
	expect(recheckDelay(10_001, 5_000, 0, 5000)).toBeUndefined();
	expect(recheckDelay(60_000, 0, 0, 5000)).toBeUndefined();
});
