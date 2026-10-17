import { expect, test } from "claude-code/testing";

import { applyBatch, Batcher, type CollectOp } from "../src/collect";
import {
	type BullpenEvent,
	chunkLines,
	chunkName,
	chunkNames,
	JOURNAL_VERSION,
	journalDir,
	lastChunk,
	planAppend,
	readChunks,
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

// Each "lN" line is 3 characters with its newline, so 9 fit 3 to a chunk.
const lines = (from: number, n: number) =>
	Array.from({ length: n }, (_, i) => `l${from + i}`);

test("planAppend rewrites only the current chunk until it rolls", async () => {
	const start = { writer: "s1", index: 1, lines: lines(0, 1) };
	// Fits: one write, the whole current chunk.
	const first = planAppend(start, lines(1, 1), 9, 3);
	expect(first.writes).toEqual([
		{ name: "events-s1-0001.jsonl", text: "l0\nl1\n" },
	]);
	expect(first.current).toEqual({ writer: "s1", index: 1, lines: lines(0, 2) });
	// Rolls: finishes chunk 1, starts chunk 2, nothing written twice.
	const rolled = planAppend(first.current, lines(2, 3), 9, 3);
	expect(rolled.writes.map((w) => w.name)).toEqual([
		"events-s1-0001.jsonl",
		"events-s1-0002.jsonl",
	]);
	expect(rolled.current).toEqual({
		writer: "s1",
		index: 2,
		lines: ["l3", "l4"],
	});
	// A full chunk with nothing new isn't rewritten before rolling.
	const full = { writer: "s1", index: 2, lines: lines(0, 3) };
	expect(planAppend(full, ["x"], 9, 3).writes).toEqual([
		{ name: "events-s1-0003.jsonl", text: "x\n" },
	]);
	expect(planAppend(first.current, [], 9, 3).writes).toEqual([]);
	// A line longer than a chunk still gets written, alone in the next one.
	expect(
		planAppend(start, ["x".repeat(20)], 9, 3).writes.map((w) => w.name),
	).toEqual(["events-s1-0002.jsonl"]);
});

test("planAppend wraps the ring and replaces the oldest chunk", async () => {
	const full = { writer: "s1", index: 2, lines: lines(0, 3) };
	const out = planAppend(full, lines(3, 4), 9, 3);
	expect(out.writes).toEqual([
		{ name: "events-s1-0003.jsonl", text: "l3\nl4\nl5\n" },
		// After chunk 3 of 3 comes chunk 1, with only the new lines.
		{ name: "events-s1-0001.jsonl", text: "l6\n" },
	]);
	expect(out.current).toEqual({ writer: "s1", index: 1, lines: ["l6"] });
});

test("each writer has its own chunks, found by name", async () => {
	expect(chunkName("abc-123", 7)).toBe("events-abc-123-0007.jsonl");
	const names = [
		"events-s2-0010.jsonl",
		"notes.txt",
		"events-s1-0002.jsonl",
		"events-s2-0002.jsonl",
		"events-s1-x.jsonl",
		"events-s1-0001.jsonl",
	];
	expect(chunkNames(names)).toEqual([
		"events-s1-0001.jsonl",
		"events-s1-0002.jsonl",
		"events-s2-0002.jsonl",
		"events-s2-0010.jsonl",
	]);
	// The newest file wins, since a ring wraps; then the higher number.
	const entries = names.map((name) => ({ name, mtimeMs: 100 }));
	expect(lastChunk(entries, "s1")).toBe(2);
	const wrapped = [
		{ name: "events-s2-0020.jsonl", mtimeMs: 100 },
		{ name: "events-s2-0001.jsonl", mtimeMs: 200 },
	];
	expect(lastChunk(wrapped, "s2")).toBe(1);
	// Another session's chunks never count as this writer's.
	expect(lastChunk(wrapped, "s1")).toBe(0);
	expect(lastChunk(entries, "s3")).toBe(0);
	expect(chunkLines("a\n\nb\n")).toEqual(["a", "b"]);
	expect(chunkLines("")).toEqual([]);
});

test("readChunks merges writers in time order", async () => {
	const a = [event({ at: 1, who: "smith" }), event({ at: 4, who: "smith" })];
	const b = [event({ at: 2, who: "ada" }), event({ at: 4, who: "ada" })];
	const text = (list: BullpenEvent[]) => list.map(toLine).join("\n");
	const { events, skipped } = readChunks([text(a), `${text(b)}\n{bad`]);
	expect(events.map((e) => `${e.at}${e.who}`)).toEqual([
		"1smith",
		"2ada",
		"4smith",
		"4ada",
	]);
	expect(skipped).toBe(1);
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

test("applyBatch reconcile marks unlisted members gone, with one leave each", async () => {
	const start = applyBatch({}, [
		{ op: "touch", at: 1, id: "a1", patch: { name: "smith" } },
		{ op: "touch", at: 1, id: "demo-ada", patch: { name: "ada" } },
	]).members;
	const { members: out, events: left } = applyBatch(start, [
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
	]);
	expect(out.a1?.status).toBe("gone");
	expect(left.map((e) => [e.kind, e.agentId, e.who, e.detail])).toEqual([
		["leave", "a1", "smith", "smith left"],
	]);
	// Only the first reconcile that misses a member says it left.
	const again = applyBatch(out, [{ op: "reconcile", at: 3, listed: [] }]);
	expect(again.events.map((e) => e.who)).toEqual(["gate"]);
	expect(readJournal(left.map(toLine).join("\n")).skipped).toBe(0);
	expect(out["demo-ada"]?.status).toBe("running");
	expect(out.a2?.name).toBe("gate");
	const cleared = applyBatch(out, [{ op: "clear-demo" }]).members;
	expect(Object.keys(cleared).sort()).toEqual(["a1", "a2"]);
});
