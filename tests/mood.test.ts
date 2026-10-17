import { expect, test } from "claude-code/testing";
import { isAnimated, moodFor, snoozeFrame } from "../src/render/mood";

const cases: [string, Parameters<typeof moodFor>[0], string, string][] = [
	["running", { status: "running" }, "running", "heads-down"],
	["idle", { status: "idle" }, "idle", "snoozing"],
	["away", { status: "idle", away: true }, "away", "snoozing"],
	["gone", { status: "gone", needsYou: true }, "gone", "clocked out"],
	[
		"review",
		{ status: "running", waitingOnReview: true },
		"review",
		"waiting on review",
	],
	["asks", { status: "idle", needsYou: true }, "needs-you", "needs you"],
	["red", { status: "running", failingChecks: 3 }, "failing", "checks red x3"],
	[
		"red once",
		{ status: "running", failingChecks: 1 },
		"failing",
		"checks red",
	],
	["merged", { status: "idle", justMerged: true }, "merged", "merged"],
	[
		"ask beats red",
		{ status: "running", needsYou: true, failingChecks: 2 },
		"needs-you",
		"needs you",
	],
	[
		"red beats merged",
		{ status: "running", failingChecks: 1, justMerged: true },
		"failing",
		"checks red",
	],
];

for (const [name, input, kind, label] of cases)
	test(`mood: ${name}`, () => {
		const mood = moodFor(input);
		expect(mood.kind).toBe(kind);
		expect(mood.label).toBe(label);
		expect(/^[ -~]+$/.test(mood.face)).toBe(true);
	});

test("only asks and merges pulse; only idle moods animate", () => {
	expect(moodFor({ status: "running" }).pulse).toBe(false);
	expect(moodFor({ status: "idle", needsYou: true }).pulse).toBe(true);
	expect(isAnimated(moodFor({ status: "idle" }), true)).toBe(true);
	expect(isAnimated(moodFor({ status: "idle" }), false)).toBe(false);
	expect(isAnimated(moodFor({ status: "running" }), true)).toBe(false);
});

test("snooze changes at most once per 2 s, keeps its width, and freezes when animations are off", () => {
	expect(snoozeFrame(0)).toBe(snoozeFrame(1999));
	expect(snoozeFrame(0)).not.toBe(snoozeFrame(2000));
	const widths = new Set<number>();
	for (let t = 0; t < 30000; t += 500) widths.add(snoozeFrame(t).length);
	expect(widths.size).toBe(1);
	expect(snoozeFrame(0, false)).toBe(snoozeFrame(60000, false));
	expect(/^[ zZ]+$/.test(snoozeFrame(4000))).toBe(true);
});
