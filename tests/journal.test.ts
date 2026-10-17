import { expect, test } from "claude-code/testing";

import { applyBatch, Batcher, type CollectOp } from "../src/collect";
import {
	type BullpenEvent,
	chunkLines,
	chunkNames,
	JOURNAL_VERSION,
	journalDir,
	planAppend,
	readJournal,
	teamOf,
	toLine,
} from "../src/journal";

const event = (patch: Partial<BullpenEvent> = {}): BullpenEvent => ({
	version: JOURNAL_VERSION,
	at: 1_700_000_000_000,
	kind: "tool",
	agentId: "a1",
	who: "smith",
	target: "Edit",
	detail: "edit journal.ts",
	issues: [1],
	...patch,
});

test("events round-trip through a journal line", async () => {
	const lead: BullpenEvent = {
		version: JOURNAL_VERSION,
		at: 5,
		kind: "message",
		who: "lead",
		detail: "go",
		issues: [],
	};
	const list = [event(), lead];
	const { events, skipped } = readJournal(list.map(toLine).join("\n"));
	expect(events).toEqual(list);
	expect(skipped).toBe(0);
	// Absent optional fields stay absent, not `null`.
	expect(toLine(lead).includes("agentId")).toBe(false);
});

test("readJournal skips bad lines and keeps the rest", async () => {
	const good = toLine(event());
	const text = [
		good,
		"",
		"{not json",
		JSON.stringify({ ...event(), version: 99 }),
		JSON.stringify({ ...event(), kind: "dance" }),
		JSON.stringify({ ...event(), issues: [1.5] }),
		JSON.stringify({ ...event(), who: undefined }),
		"null",
		good.slice(0, 20),
		good,
	].join("\n");
	const { events, skipped } = readJournal(text);
	expect(events.length).toBe(2);
	expect(skipped).toBe(7);
});

test("planAppend rewrites only the current chunk until it rolls", async () => {
	const lines = (from: number, n: number) =>
		Array.from({ length: n }, (_, i) => `l${from + i}`);
	// Fits: one write, the whole current chunk.
	const first = planAppend({ index: 1, lines: lines(0, 2) }, lines(2, 1), 4, 3);
	expect(first.writes).toEqual([
		{ name: "events-0001.jsonl", text: "l0\nl1\nl2\n" },
	]);
	expect(first.current).toEqual({ index: 1, lines: lines(0, 3) });
	// Rolls: finishes chunk 1, starts chunk 2, and nothing touched twice.
	const rolled = planAppend(first.current, lines(3, 3), 4, 3);
	expect(rolled.writes.map((w) => w.name)).toEqual([
		"events-0001.jsonl",
		"events-0002.jsonl",
	]);
	expect(rolled.current).toEqual({ index: 2, lines: ["l4", "l5"] });
	// A full chunk with nothing new isn't rewritten before rolling.
	const fresh = planAppend({ index: 2, lines: lines(0, 4) }, ["x"], 4, 3);
	expect(fresh.writes).toEqual([{ name: "events-0003.jsonl", text: "x\n" }]);
	expect(planAppend(first.current, [], 4, 3).writes).toEqual([]);
});

test("planAppend empties chunks past the cap", async () => {
	const full = { index: 3, lines: ["a", "b"] };
	const out = planAppend(full, ["c", "d", "e"], 2, 3);
	expect(out.writes).toEqual([
		{ name: "events-0001.jsonl", text: "" },
		{ name: "events-0004.jsonl", text: "c\nd\n" },
		{ name: "events-0002.jsonl", text: "" },
		{ name: "events-0005.jsonl", text: "e\n" },
	]);
});

test("chunk files list in order and read back their lines", async () => {
	expect(
		chunkNames([
			"events-0010.jsonl",
			"notes.txt",
			"events-0002.jsonl",
			"events-x.jsonl",
		]),
	).toEqual(["events-0002.jsonl", "events-0010.jsonl"]);
	expect(chunkLines("a\n\nb\n")).toEqual(["a", "b"]);
	expect(chunkLines("")).toEqual([]);
});

test("journalDir and teamOf", async () => {
	expect(journalDir("/home/me", "bullpen")).toBe(
		"/home/me/.claude/bullpen/bullpen",
	);
	expect(journalDir("C:\\Users\\me\\", "../a b")).toBe(
		"C:\\Users\\me/.claude/bullpen/a-b",
	);
	expect(teamOf("smith@bullpen")).toBe("bullpen");
	expect(teamOf("smith")).toBeUndefined();
	expect(teamOf(undefined)).toBeUndefined();
});

/** A clock tests advance by hand, standing in for `$.clock.after`. */
function fakeClock() {
	let time = 0;
	const timers: { at: number; fn: () => void }[] = [];
	return {
		schedule: (ms: number, fn: () => void) => {
			timers.push({ at: time + ms, fn });
		},
		async advance(ms: number) {
			time += ms;
			for (const t of timers.filter((t) => t.at <= time)) {
				timers.splice(timers.indexOf(t), 1);
				t.fn();
			}
			// Let the flush promise chain settle.
			for (let i = 0; i < 5; i++) await Promise.resolve();
		},
		pending: () => timers.length,
	};
}

test("Batcher flushes everything pushed within the window as one batch", async () => {
	const clock = fakeClock();
	const flushed: number[][] = [];
	const batcher = new Batcher<number>(100, clock.schedule, async (items) => {
		flushed.push(items);
	});
	batcher.push(1);
	batcher.push(2);
	batcher.push(3);
	expect(clock.pending()).toBe(1);
	await clock.advance(99);
	expect(flushed).toEqual([]);
	await clock.advance(1);
	expect(flushed).toEqual([[1, 2, 3]]);
	// Quiet means no timer at all.
	expect(clock.pending()).toBe(0);
	batcher.push(4);
	await clock.advance(100);
	expect(flushed).toEqual([[1, 2, 3], [4]]);
});

test("Batcher survives a failing flush and drain writes now", async () => {
	const clock = fakeClock();
	const flushed: number[][] = [];
	let fail = true;
	const batcher = new Batcher<number>(100, clock.schedule, async (items) => {
		if (fail) throw new Error("disk full");
		flushed.push(items);
	});
	batcher.push(1);
	await clock.advance(100);
	fail = false;
	batcher.push(2);
	await batcher.drain();
	expect(flushed).toEqual([[2]]);
});

test("applyBatch folds a batch into members and named events", async () => {
	const ops: CollectOp[] = [
		{ op: "touch", at: 1, id: "a1", patch: { name: "smith", issue: 1 } },
		{
			op: "event",
			at: 2,
			kind: "tool",
			agentId: "a1",
			detail: "edit journal.ts",
			target: "Edit",
			attribute: true,
		},
		{
			op: "event",
			at: 3,
			kind: "message",
			agentId: "a1",
			detail: "ada: #2 needs this",
			target: "ada",
			attribute: true,
		},
		{
			op: "event",
			at: 4,
			kind: "turn-start",
			detail: "started a turn",
			text: "work on #7",
			attribute: true,
		},
	];
	const out = applyBatch({}, ops);
	expect(out.events.map((e) => e.who)).toEqual(["smith", "smith", "lead"]);
	expect(out.events[1]?.issues).toEqual([2]);
	expect(out.events[2]?.issues).toEqual([7]);
	expect(out.events[0]?.version).toBe(JOURNAL_VERSION);
	// A mention doesn't move smith off #1; the lead's work puts it on #7.
	expect(out.members.a1?.issue).toBe(1);
	expect(out.members.a1?.lastActiveAt).toBe(3);
	expect(out.members.lead?.issue).toBe(7);
	expect(out.members.lead?.color).toBe(1);
	// Every event it produces passes the journal schema.
	expect(readJournal(out.events.map(toLine).join("\n")).skipped).toBe(0);
});

test("applyBatch reconcile marks unlisted members gone but keeps demo ones", async () => {
	const start = applyBatch({}, [
		{ op: "touch", at: 1, id: "a1", patch: { name: "smith" } },
		{ op: "touch", at: 1, id: "demo-ada", patch: { name: "ada" } },
	]).members;
	const out = applyBatch(start, [
		{
			op: "reconcile",
			at: 2,
			listed: [
				{
					id: "a2",
					name: "gate",
					description: "review",
					status: "running",
					teammateId: "gate@team",
				},
			],
		},
	]).members;
	expect(out.a1?.status).toBe("gone");
	expect(out["demo-ada"]?.status).toBe("running");
	expect(out.a2?.name).toBe("gate");
	const cleared = applyBatch(out, [{ op: "clear-demo" }]).members;
	expect(Object.keys(cleared).sort()).toEqual(["a1", "a2"]);
});
