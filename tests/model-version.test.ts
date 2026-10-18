import { expect, test } from "claude-code/testing";
import { readJournal, STATE_EVENTS } from "../src/journal";
import {
	ensureState,
	fingerprintOf,
	foldBatch,
	MODEL_VERSION,
	rebuildState,
	reduceEvents,
	stateFor,
} from "../src/model";
import pinJournal from "../src/model/pin";
import type { BullpenEvent } from "../types";
import demoJournal from "./fixtures/demo";

const T = Date.UTC(2026, 9, 17, 14, 0, 0);
const pin = readJournal(pinJournal).events;
const demo = readJournal(demoJournal).events;

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

test("MODEL_VERSION fingerprints the reducer's output for the pin journal", async () => {
	const state = reduceEvents(pin);
	// The fixture must keep exercising the rules the version guards.
	expect(state.asks.length).toBeGreaterThan(0);
	expect(Object.keys(state.ship.paths).length).toBeGreaterThan(0);
	expect(state.closes.length).toBeGreaterThan(0);
	expect(state.kickbacks.length).toBeGreaterThan(0);
	// A reviewer known only by a role-like agent type: a trim would go unnoticed.
	expect(state.kickbacks.some((k) => k.from === "code-reviewer")).toBe(true);
	// A reply closes only the decision it quoted; the other, and one raised
	// after it, stay open.
	expect(state.decisions.filter((d) => !d.open).map((d) => d.text)).toEqual([
		"Ship the cache per session or wait for review?",
	]);
	expect(state.decisions.filter((d) => d.open).map((d) => d.text)).toEqual([
		"Cut the second flag?",
		"Merge #58 now?",
	]);
	expect(state.asks.some((a) => a.open)).toBe(true);
	expect(Object.values(state.teammates).some((t) => t.owned)).toBe(true);
	expect(MODEL_VERSION).toBe(fingerprintOf(state));
	expect(MODEL_VERSION).toMatch(/^r[0-9a-f]+$/);
	// Different output, different version; same output, same version.
	expect(fingerprintOf(reduceEvents(pin.slice(1)))).not.toBe(MODEL_VERSION);
	expect(fingerprintOf(reduceEvents([...pin]))).toBe(MODEL_VERSION);
});

test("a number stamped by an older build always rebuilds", async () => {
	const events = demo.slice(0, 10);
	const stored = reduceEvents(events);
	for (const old of [0, 5, 6]) {
		expect(ensureState(stored, old, events).rebuilt).toBe(true);
		expect(stateFor(stored, old, events)).not.toBe(stored);
	}
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

	const out = ensureState(stale, "rstale", events);
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
	const out = foldBatch(stale, "rstale", before, added);
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
	expect(stateFor(stored, "rstale", events)).toEqual(stored);
	expect(stateFor(null, MODEL_VERSION, events)).toEqual(stored);
});
