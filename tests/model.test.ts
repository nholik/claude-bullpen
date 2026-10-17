import { expect, test } from "claude-code/testing";

import { readJournal } from "../src/journal";
import {
	applyEvent,
	buildModel,
	EMPTY_TEAM,
	isHallwayLive,
	modelOf,
	moraleGlyph,
	reduceEvents,
} from "../src/model";
import {
	closedIssues,
	isAsk,
	isKickback,
	isReviewer,
} from "../src/model/detect";
import type { BullpenEvent } from "../types";
import demoJournal from "./fixtures/demo";
import roughJournal from "./fixtures/rough-day";

const MINUTE = 60_000;
const T = Date.UTC(2026, 9, 17, 14, 0, 0);
const demo = readJournal(demoJournal).events;
const rough = readJournal(roughJournal).events;
test("fixtures pass through the journal reader", async () => {
	expect(readJournal(demoJournal).skipped).toBe(0);
	// The future pr kind is intentionally skipped by the current schema.
	expect(readJournal(roughJournal).skipped).toBe(1);
});

const demoEnd = demo[demo.length - 1]?.at ?? T;

const ev = (
	minutes: number,
	who: string,
	kind: BullpenEvent["kind"],
	detail: string,
	extra: Partial<BullpenEvent> = {},
): BullpenEvent => ({
	version: 1,
	at: T + minutes * MINUTE,
	kind,
	who,
	detail,
	issues: [],
	...extra,
});

// --- detectors -------------------------------------------------------------

test("isAsk: questions and blocks, not reports", async () => {
	expect(isAsk("#204 flaky test — skip or fix?")).toBe(true);
	expect(isAsk("#14 flaky test, skip or fix")).toBe(true);
	expect(isAsk("blocked on #13 until #12 lands")).toBe(true);
	expect(isAsk("I'm Blocked by the gh token")).toBe(true);
	expect(isAsk("need a decision on the color map")).toBe(true);
	expect(isAsk("#199 looks good, filed a spacing nit as #217")).toBe(false);
	expect(isAsk("unblocked now, carrying on")).toBe(false);
	expect(isAsk("not blocked, just slow; #3 lands today")).toBe(false);
	expect(isAsk("no longer blocked on #3")).toBe(false);
});

test("isKickback: saying so, or a reviewer reporting failure", async () => {
	expect(isKickback("sending it back to you", false)).toBe(true);
	expect(isKickback("Kicking this back: lint fails", false)).toBe(true);
	expect(isKickback("kick back #12, needs tests", false)).toBe(true);
	expect(isKickback("↺ #14 fixture changed", false)).toBe(true);
	expect(isKickback("#12: 3 tests fail in reduce", true)).toBe(true);
	expect(isKickback("FAILED: tests/model.test.ts", true)).toBe(true);
	// A builder's failing repro test is good news, not a kickback.
	expect(isKickback("#208: repro test is in, fails as expected", false)).toBe(
		false,
	);
	expect(isKickback("all green, no failures", true)).toBe(false);
	// Success said as a negated failure, a few words apart.
	expect(isKickback("no test failures", true)).toBe(false);
	expect(isKickback("0 tests failed", true)).toBe(false);
	expect(isKickback("zero flaky e2e tests failing now", true)).toBe(false);
	expect(isKickback("ran it: none of the tests fail", true)).toBe(false);
	// A negation in another clause doesn't excuse a failure.
	expect(isKickback("no lint errors, 3 tests failed", true)).toBe(true);
	// Each failure is judged in its own clause.
	expect(isKickback("0 failed, 2 failing", true)).toBe(true);
	expect(isKickback("no failures in unit, e2e failed", true)).toBe(true);
	expect(isKickback("not failing, nothing failed", true)).toBe(false);
	expect(isKickback("#12 passes, approved", true)).toBe(false);
	// An explicit pass outweighs the failures it mentions.
	expect(isKickback("PASS: the previously failing test now passes", true)).toBe(
		false,
	);
	expect(isKickback("fixed the failures you flagged, all green", true)).toBe(
		false,
	);
	expect(isKickback("re-ran the failing suite, LGTM", true)).toBe(false);
	expect(isKickback("Looks good now, the failure was flaky", true)).toBe(false);
	// A test summary's lowercase "passed" is not a verdict.
	expect(isKickback("2 failed, 5 passed", true)).toBe(true);
	// Saying it goes back still counts, pass words or not.
	expect(isKickback("lint passes but sending it back for tests", true)).toBe(
		true,
	);
});

test("isReviewer: gate and ux by role, else by name", async () => {
	expect(isReviewer("gate", undefined)).toBe(true);
	expect(isReviewer("ux-iris", undefined)).toBe(true);
	expect(isReviewer("smith", undefined)).toBe(false);
	expect(isReviewer("iris", "ux")).toBe(true);
	expect(isReviewer("gate", "builder")).toBe(false);
});

test("closedIssues: closes said or run, not promised", async () => {
	expect(closedIssues("gh issue close 12")).toEqual([]);
	expect(closedIssues("gh issue close #12 --comment done")).toEqual([]);
	expect(closedIssues("#12 ✓ merged")).toEqual([12]);
	expect(closedIssues("✓ #199, closed #200, #201 is shipped")).toEqual([
		199, 200, 201,
	]);
	expect(closedIssues("PR up, closes #12")).toEqual([]);
	// "merged #13" usually names a PR, not an issue.
	expect(closedIssues("merged #13")).toEqual([]);
	expect(closedIssues("#13 merged")).toEqual([]);
	// Negated closes don't count; one clause's negation doesn't reach the next.
	expect(closedIssues("not closed #12")).toEqual([]);
	expect(closedIssues("#12 is not closed yet")).toEqual([]);
	expect(closedIssues("I haven't closed #12")).toEqual([]);
	expect(closedIssues("never shipped #12, sorry")).toEqual([]);
	expect(closedIssues("#12 isn't ✓ yet")).toEqual([]);
	expect(closedIssues("not #12, but closed #13")).toEqual([13]);
	expect(closedIssues("gh issue view 12")).toEqual([]);
});

// --- the demo fixture ------------------------------------------------------

test("demo: teammates get colors in order of appearance and follow work", async () => {
	const { teammates } = buildModel(demo, demoEnd);
	expect(Object.keys(teammates)).toEqual([
		"smith",
		"lead",
		"ada",
		"gate",
		"iris",
		"scout",
	]);
	expect(teammates.smith?.color).toBe(0);
	expect(teammates.lead?.color).toBe(1);
	// The spawn brief seats each teammate; smith's edit on #204 moves smith.
	expect(teammates.smith?.issue).toBe(204);
	expect(teammates.ada?.issue).toBe(208);
	expect(teammates.gate?.issue).toBe(204);
	expect(teammates.iris?.issue).toBe(199);
	expect(teammates.scout?.issue).toBeUndefined();
	// The spawner is not dragged to the newcomer's issue.
	expect(teammates.lead?.issue).toBeUndefined();
	expect(teammates.iris?.status).toBe("idle");
	expect(teammates.gate?.status).toBe("running");
	expect(teammates.gate?.agentId).toBe("demo-gate");
	expect(teammates.smith?.lastActiveAt).toBe(T + 762_000);
});

test("demo: a trail keeps the last three steps, oldest first", async () => {
	const { teammates } = buildModel(demo, demoEnd);
	expect(teammates.smith?.trail.map((s) => s.detail)).toEqual([
		"edit src/session.ts",
		"npm test",
		"#204: fixed, please re-run",
	]);
	expect(teammates.scout?.trail.map((s) => s.kind)).toEqual([
		"spawn",
		"turn-end",
	]);
});

test("demo: huddles group by issue, biggest then liveliest first", async () => {
	const { huddles } = buildModel(demo, demoEnd);
	expect(huddles.map((h) => [h.issue, h.members])).toEqual([
		[204, ["smith", "gate"]],
		[208, ["ada"]],
		[199, ["iris"]],
	]);
	const h204 = huddles[0];
	expect(h204?.startedAt).toBe(T + 48_000);
	expect(h204?.kickbacks).toBe(1);
	expect(h204?.lastActiveAt).toBe(demoEnd);
	expect(huddles[1]?.startedAt).toBe(T);
	expect(huddles[1]?.kickbacks).toBe(0);
});

test("demo: hallway, kickbacks, no asks, cloudy morale", async () => {
	const model = buildModel(demo, demoEnd);
	expect(model.hallway.map((m) => `${m.from}>${m.to}`)).toEqual([
		"smith>ada",
		"gate>smith",
		"iris>lead",
		"ada>smith",
		"smith>gate",
	]);
	expect(model.hallway[2]?.issues).toEqual([199, 217]);
	expect(model.kickbacks).toEqual([
		{
			from: "gate",
			to: "smith",
			issue: 204,
			at: T + 408_000,
			text: "#204: 2 tests failing on session expiry, sending it back to you",
		},
	]);
	expect(model.asks).toEqual([]);
	expect(model.closed).toEqual([]);
	// 0.7 base, -0.12 for the kickback, -0.05 for scout idling 7 min.
	expect(model.morale.factors).toEqual({
		closes: 0,
		kickbacks: 1,
		openAsks: 0,
		stalled: [],
		idle: ["scout"],
	});
	expect(model.morale.score).toBe(0.53);
	expect(model.morale.glyph).toBe("☁");
});

test("demo: the hallway is live for three minutes after the last message", async () => {
	const { hallway } = buildModel(demo, demoEnd);
	const last = hallway[hallway.length - 1]?.at ?? 0;
	expect(isHallwayLive(hallway, last)).toBe(true);
	expect(isHallwayLive(hallway, last + 3 * MINUTE)).toBe(true);
	expect(isHallwayLive(hallway, last + 3 * MINUTE + 1)).toBe(false);
	expect(isHallwayLive([], last)).toBe(false);
});

test("demo: quiet huddles stall and stay stalled; silence never removes anyone", async () => {
	const state = reduceEvents(demo);
	// 20+ min after each huddle's last activity.
	const stalled = modelOf(state, T + 35 * MINUTE);
	expect(stalled.morale.factors.stalled).toEqual([204, 208, 199]);
	expect(stalled.morale.factors.idle).toEqual(["iris", "scout"]);
	// An hour on, the kickback has aged out, but a stuck team still looks
	// stuck: the same huddles, all stalled, and no one has left.
	const later = modelOf(state, T + 70 * MINUTE);
	expect(later.morale.factors.kickbacks).toBe(0);
	expect(later.huddles.map((h) => [h.issue, h.members])).toEqual([
		[204, ["smith", "gate"]],
		[208, ["ada"]],
		[199, ["iris"]],
	]);
	expect(later.morale.factors.stalled).toEqual([204, 208, 199]);
	expect(later.morale.factors.idle).toEqual(["iris", "scout"]);
	// 0.7 - 3 stalled x 0.1 - 2 idle x 0.05
	expect(later.morale.score).toBe(0.3);
	expect(later.morale.glyph).toBe("☂");
	// Idle teammates silent 30+ min are drawn away; busy ones never are.
	expect(later.teammates.iris?.away).toBe(true);
	expect(later.teammates.smith?.status).toBe("running");
	expect(later.teammates.smith?.away).toBeUndefined();
	expect(stalled.teammates.iris?.away).toBeUndefined();
	// Only live presence (or a leave event) takes someone off the floor.
	const present = modelOf(state, T + 70 * MINUTE, {
		present: { gate: "gone", ada: "gone", iris: "gone", scout: "gone" },
	});
	expect(present.huddles.map((h) => h.members)).toEqual([["smith"]]);
	expect(present.teammates.iris?.away).toBeUndefined();
});

// --- the rough-day fixture -------------------------------------------------

test("rough day: asks to any lead name, answered by a lead message", async () => {
	const model = buildModel(rough, T + 55 * MINUTE);
	expect(model.asks.map((a) => [a.from, a.to, a.open])).toEqual([
		["ada", "team-lead", false],
		["gate", "lead", true],
	]);
	expect(model.asks[1]?.issues).toEqual([13, 12]);
});

test("rough day: closes come from gh and messages, once each", async () => {
	const model = buildModel(rough, T + 55 * MINUTE);
	expect(model.closed).toEqual([12]);
	// #12 is done, so smith and gate no longer huddle there.
	expect(model.huddles.map((h) => h.issue)).toEqual([14]);
	expect(model.teammates.gate?.issue).toBe(12);
});

test("rough day: unknown kinds and fields are ignored, not fatal", async () => {
	const model = buildModel(rough, T + 55 * MINUTE);
	// The reader skips the future `pr` kind; ada stays on #14.
	expect(model.teammates.ada?.issue).toBe(14);
	expect(model.teammates.ada?.trail.map((s) => s.kind)).toEqual([
		"message",
		"tool",
		"message",
	]);
	expect(model.teammates.ada).not.toHaveProperty("files");
});

test("rough day: kickbacks from a failing gate and a ↺", async () => {
	const model = buildModel(rough, T + 55 * MINUTE);
	expect(model.kickbacks.map((k) => [k.from, k.to, k.issue])).toEqual([
		["gate", "smith", 12],
		["ada", "smith", 14],
	]);
	expect(model.huddles[0]?.kickbacks).toBe(1);
});

test("rough day: stalled, asking, kicked back and idle make a storm", async () => {
	const model = buildModel(rough, T + 55 * MINUTE);
	expect(model.morale.factors).toEqual({
		closes: 1,
		kickbacks: 2,
		openAsks: 1,
		stalled: [14],
		idle: ["smith"],
	});
	// 0.7 + 0.1 - 0.24 - 0.12 - 0.1 - 0.05
	expect(model.morale.score).toBe(0.29);
	expect(model.morale.glyph).toBe("☇");
});

// --- reducer edges ---------------------------------------------------------

test("a teammate joining reports itself and takes its brief's issue", async () => {
	const state = applyEvent(
		EMPTY_TEAM,
		ev(0, "smith", "spawn", "smith joined", { issues: [208] }),
	);
	expect(state.teammates.smith?.issue).toBe(208);
	expect(state.issueStarted[208]).toBe(T);
});

test("a spawn doesn't reseat a teammate who already has an issue", async () => {
	const model = buildModel(
		[
			ev(0, "lead", "spawn", "teammate ada joined", {
				target: "ada",
				issues: [5],
			}),
			ev(1, "lead", "spawn", "teammate ada joined", {
				target: "ada",
				issues: [6],
			}),
		],
		T,
	);
	expect(model.teammates.ada?.issue).toBe(5);
});

test("messages don't drag teammates to the issues they mention", async () => {
	const model = buildModel(
		[
			ev(0, "smith", "tool", "edit a.ts", { issues: [101] }),
			ev(1, "smith", "message", "saw #102, nice", {
				target: "gate",
				issues: [102],
			}),
			ev(2, "smith", "tool", "edit b.ts", { issues: [103] }),
		],
		T + 2 * MINUTE,
	);
	expect(model.teammates.smith?.issue).toBe(103);
	expect(model.teammates.smith?.trail.length).toBe(3);
});

test("turns flip status; a message to yourself is not hallway talk", async () => {
	const state = reduceEvents([
		ev(0, "ada", "turn-start", "started a turn"),
		ev(1, "ada", "message", "note to self?", { target: "ada" }),
		ev(2, "ada", "turn-end", "finished a turn"),
	]);
	expect(state.teammates.ada?.status).toBe("idle");
	expect(state.hallway).toEqual([]);
	expect(state.asks).toEqual([]);
});

test("a lead's question to a teammate is not an ask", async () => {
	const state = reduceEvents([
		ev(0, "lead", "message", "how is #3 going?", { target: "ada" }),
	]);
	expect(state.asks).toEqual([]);
	expect(state.hallway.length).toBe(1);
});

test("custom lead names and roles", async () => {
	const options = { leads: ["boss"], roles: { iris: "ux" } };
	const state = reduceEvents(
		[
			ev(0, "ada", "message", "skip or fix?", { target: "boss" }),
			ev(1, "ada", "message", "skip or fix?", { target: "lead" }),
			ev(2, "iris", "message", "contrast check fails on #9", {
				target: "ada",
				issues: [9],
			}),
		],
		options,
	);
	expect(state.asks.map((a) => a.to)).toEqual(["boss"]);
	expect(state.kickbacks.map((k) => k.issue)).toEqual([9]);
});

test("a kickback with no issue ref falls back to the sender's issue", async () => {
	const state = reduceEvents([
		ev(0, "gate", "tool", "npm test", { issues: [7] }),
		ev(1, "gate", "message", "kicking it back", { target: "smith" }),
	]);
	expect(state.kickbacks[0]?.issue).toBe(7);
});

test("live presence: gone teammates leave huddles and stop idling", async () => {
	const events = [
		ev(0, "ada", "tool", "edit", { issues: [4] }),
		ev(1, "ada", "turn-end", "finished a turn"),
		ev(2, "smith", "tool", "edit", { issues: [4] }),
	];
	const now = T + 10 * MINUTE;
	// From events alone, ada is still at #4 and idling while work is open.
	const stale = buildModel(events, now);
	expect(stale.huddles.map((h) => h.members)).toEqual([["ada", "smith"]]);
	expect(stale.morale.factors.idle).toEqual(["ada"]);

	const live = buildModel(events, now, {
		present: { ada: "gone", smith: "running", nobody: "idle" },
	});
	expect(live.teammates.ada?.status).toBe("gone");
	expect(live.huddles.map((h) => h.members)).toEqual([["smith"]]);
	expect(live.morale.factors.idle).toEqual([]);
	expect(live.morale.score).toBeGreaterThan(stale.morale.score);
	// Names presence doesn't know about aren't invented.
	expect(live.teammates).not.toHaveProperty("nobody");
	// Presence also wakes up a teammate the journal last saw idle.
	const awake = modelOf(reduceEvents(events), now, {
		present: { ada: "running" },
	});
	expect(awake.morale.factors.idle).toEqual([]);
});

test("a leave event takes a teammate off the floor until it's heard from", async () => {
	const left = readJournal(
		'{"version":1,"at":0,"kind":"leave","who":"ada","detail":"ada left","issues":[]}',
	);
	expect(left.skipped).toBe(0);
	expect(left.events.length).toBe(1);
	const departures = left.events.map((e) => ({ ...e, at: T + 2 * MINUTE }));
	const before = [
		ev(0, "ada", "tool", "edit", { issues: [4] }),
		ev(1, "smith", "tool", "edit", { issues: [4] }),
	];
	const gone = buildModel([...before, ...departures], T + 3 * MINUTE);
	expect(gone.teammates.ada?.status).toBe("gone");
	expect(gone.teammates.ada?.issue).toBe(4);
	expect(gone.huddles.map((h) => h.members)).toEqual([["smith"]]);
	const back = buildModel(
		[...before, ...departures, ev(4, "ada", "turn-start", "started a turn")],
		T + 5 * MINUTE,
	);
	expect(back.teammates.ada?.status).toBe("running");
	expect(back.huddles.map((h) => h.members)).toEqual([["ada", "smith"]]);
});

test("the hallway keeps only the last 50 messages", async () => {
	const events = Array.from({ length: 60 }, (_, i) =>
		ev(i, "ada", "message", `note ${i}`, { target: "smith" }),
	);
	const { hallway } = reduceEvents(events);
	expect(hallway.length).toBe(50);
	expect(hallway[0]?.text).toBe("note 10");
});

test("applyEvent leaves the state it was given untouched", async () => {
	const before = reduceEvents(demo.slice(0, 6));
	const snapshot = JSON.stringify(before);
	applyEvent(before, demo[6] ?? ev(0, "x", "tool", "x"));
	expect(JSON.stringify(before)).toBe(snapshot);
});

test("folding incrementally matches building from scratch", async () => {
	let state = EMPTY_TEAM;
	for (const e of demo) state = applyEvent(state, e);
	expect(modelOf(state, demoEnd)).toEqual(buildModel(demo, demoEnd));
});

test("an empty journal is a sunny, empty office", async () => {
	const model = buildModel([], T);
	expect(model.teammates).toEqual({});
	expect(model.huddles).toEqual([]);
	expect(model.morale.score).toBe(0.7);
	expect(model.morale.glyph).toBe("☀");
});

test("moraleGlyph thresholds", async () => {
	expect(moraleGlyph(1)).toBe("☀");
	expect(moraleGlyph(0.7)).toBe("☀");
	expect(moraleGlyph(0.69)).toBe("☁");
	expect(moraleGlyph(0.5)).toBe("☁");
	expect(moraleGlyph(0.3)).toBe("☂");
	expect(moraleGlyph(0.29)).toBe("☇");
	expect(moraleGlyph(0)).toBe("☇");
});

test("morale is clamped and closes cap their lift", async () => {
	const closes = [1, 2, 3, 4, 5].map((n) =>
		ev(n, "lead", "message", `closed #${n}`),
	);
	expect(buildModel(closes, T + 10 * MINUTE).morale.score).toBe(1);
	const asks = Array.from({ length: 10 }, (_, i) =>
		ev(i, `t${i}`, "message", "blocked", { target: "lead" }),
	);
	expect(buildModel(asks, T + 10 * MINUTE).morale.score).toBe(0);
});

test("member agent types survive events falling out of the window and color cards", async () => {
	// No spawn event in the window: the type comes from the members atom.
	const model = buildModel(
		readJournal(
			'{"version":1,"at":1,"kind":"tool","who":"worker","detail":"x","issues":[]}',
		).events,
		2,
		{ agentTypes: { worker: "builder", ghost: "gate" } },
	);
	expect(model.teammates.worker?.agentType).toBe("builder");
	expect(model.teammates).not.toHaveProperty("ghost");
});
