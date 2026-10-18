import { expect, test } from "claude-code/testing";

import { readJournal, STATE_EVENTS } from "../src/journal";
import {
	ensureState,
	foldBatch,
	MODEL_VERSION,
	rebuildState,
	reduceEvents,
	stateFor,
} from "../src/model";
import type { BullpenEvent } from "../types";
import demoJournal from "./fixtures/demo";
import pinJournal from "./fixtures/model-pin";

const T = Date.UTC(2026, 9, 17, 14, 0, 0);
const demo = readJournal(demoJournal).events;
const pin = readJournal(pinJournal).events;

const ev = (
	minutes: number,
	who: string,
	kind: BullpenEvent["kind"],
	detail: string,
	extra: Partial<BullpenEvent> = {},
): BullpenEvent => ({
	version: 1,
	at: T + minutes * 60_000,
	kind,
	who,
	detail,
	issues: [],
	...extra,
});

/** FNV-1a over the JSON text; enough to notice any change in reducer output. */
function fingerprint(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16);
}

// When this test fails, the reducer now produces different state for the same
// events. Bump MODEL_VERSION (src/model/version.ts) and add the new
// fingerprint here under the new number. Keep the old entries.
const FINGERPRINTS: Record<number, string> = {
	1: "a6d1d7d2",
	2: "a6d1d7d2",
};

test("reducer output is pinned to MODEL_VERSION", async () => {
	const state = reduceEvents(pin);
	// The fixture must keep exercising the rules the version guards.
	expect(state.asks.length).toBeGreaterThan(0);
	expect(Object.keys(state.ship.paths).length).toBeGreaterThan(0);
	const seen = fingerprint(JSON.stringify(state));
	expect(FINGERPRINTS[MODEL_VERSION]).toBe(seen);
});

const staleAsk = ev(1, "b83", "message", "PR #5 is up, checks green", {
	target: "team-lead",
	issues: [5],
});

test("a state from older rules is rebuilt and drops its stale ask", async () => {
	const events = [staleAsk];
	// What an earlier isAsk would have left behind in $.state.
	const old = reduceEvents(events);
	const stale = {
		...old,
		asks: [
			{
				from: "b83",
				to: "team-lead",
				at: staleAsk.at,
				text: staleAsk.detail,
				issues: [5],
				open: true,
			},
		],
	};
	const kept = ensureState(stale, MODEL_VERSION, events);
	expect(kept.rebuilt).toBe(false);
	expect(kept.state).toBe(stale);

	const out = ensureState(stale, MODEL_VERSION - 1, events);
	expect(out.rebuilt).toBe(true);
	expect(out.version).toBe(MODEL_VERSION);
	expect(out.state.asks.filter((a) => a.open)).toEqual([]);
});

test("a state that was never stamped or is missing is rebuilt", async () => {
	const events = demo.slice(0, 10);
	expect(ensureState(null, MODEL_VERSION, events).rebuilt).toBe(true);
	expect(ensureState(reduceEvents(events), 0, events).rebuilt).toBe(true);
	const forced = ensureState(reduceEvents(events), MODEL_VERSION, events, true);
	expect(forced.rebuilt).toBe(true);
	expect(forced.state).toEqual(reduceEvents(events));
});

test("a rebuild folds at most STATE_EVENTS events", async () => {
	const many = Array.from({ length: STATE_EVENTS + 500 }, (_, i) =>
		ev(i, "w", "tool", `step ${i}`),
	);
	expect(rebuildState(many)).toEqual(reduceEvents(many.slice(-STATE_EVENTS)));
	expect(rebuildState([])).toEqual(reduceEvents([]));
});

test("a batch added in the same pass as a rebuild survives it", async () => {
	const before = demo.slice(0, 10);
	const added = [ev(500, "w", "message", "#9 PASS", { issues: [9] })];
	const stale = reduceEvents(before);
	const out = foldBatch(stale, MODEL_VERSION - 1, before, added);
	expect(out.rebuilt).toBe(true);
	expect(out.state).toEqual(reduceEvents([...before, ...added]));
	const forced = foldBatch(stale, MODEL_VERSION, before, added, true);
	expect(forced.state).toEqual(out.state);
	const kept = foldBatch(stale, MODEL_VERSION, before, added);
	expect(kept.rebuilt).toBe(false);
	expect(kept.state).toEqual(reduceEvents([...before, ...added]));
});

test("drawing reads the stored state when current and rebuilds in memory when stale", async () => {
	const events = demo.slice(0, 10);
	const stored = reduceEvents(events);
	expect(stateFor(stored, MODEL_VERSION, events)).toBe(stored);
	expect(stateFor(stored, MODEL_VERSION - 1, events)).toEqual(stored);
	expect(stateFor(null, MODEL_VERSION, events)).toEqual(stored);
});
