import { expect, test } from "claude-code/testing";

import { applyBatch, Batcher, type CollectOp } from "../src/collect";
import {
	appendCapped,
	type BullpenEvent,
	JOURNAL_VERSION,
	journalPath,
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

test("appendCapped appends lines and trims whole lines from the front", async () => {
	expect(appendCapped("", ["a", "b"])).toBe("a\nb\n");
	expect(appendCapped("a\n", ["b"])).toBe("a\nb\n");
	// A torn last line gets its own newline before new lines go on.
	expect(appendCapped("a", ["b"])).toBe("a\nb\n");
	expect(appendCapped("a\n", [])).toBe("a\n");
	const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
	const capped = appendCapped("", lines, 100);
	expect(capped.length).toBeLessThan(76);
	expect(capped.endsWith("line-19\n")).toBe(true);
	expect(capped.split("\n")[0]?.startsWith("line-")).toBe(true);
});

test("journalPath and teamOf", async () => {
	expect(journalPath("/home/me", "bullpen")).toBe(
		"/home/me/.claude/bullpen/bullpen/events.jsonl",
	);
	expect(journalPath("C:\\Users\\me\\", "../a b")).toBe(
		"C:\\Users\\me/.claude/bullpen/a-b/events.jsonl",
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
