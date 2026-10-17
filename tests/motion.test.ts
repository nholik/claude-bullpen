import { expect, test } from "claude-code/testing";
import { createMotion, motionFor } from "../src/motion";
import { DEFAULT_PROFILE } from "../src/profile";
import type { BullpenEvent, Member } from "../types";

const members: Member[] = [
	{
		id: "a",
		name: "a",
		color: 0,
		status: "idle",
		issue: 2,
		lastActiveAt: 1000,
	},
	{
		id: "gate",
		name: "gate",
		color: 1,
		status: "idle",
		issue: 2,
		lastActiveAt: 1000,
	},
];
const events: BullpenEvent[] = [
	{ version: 1, at: 0, kind: "spawn", who: "a", detail: "join", issues: [1] },
	{
		version: 1,
		at: 1,
		kind: "spawn",
		who: "gate",
		detail: "join",
		issues: [2],
	},
	{
		version: 1,
		at: 1000,
		kind: "tool",
		who: "a",
		detail: "edit #2",
		issues: [2],
	},
	{
		version: 1,
		at: 1100,
		kind: "message",
		who: "gate",
		target: "a",
		detail: "#2 failed tests, sending it back",
		issues: [2],
	},
	{
		version: 1,
		at: 2000,
		kind: "message",
		who: "a",
		target: "gate",
		detail: "closed #2",
		issues: [2],
	},
];
test("events derive walk, red kickback and close specs with deterministic timestamps", () => {
	const plan = motionFor(events, members, 72, 13, 2100, DEFAULT_PROFILE);
	expect(plan.specs.some((s) => s.kind === "walk")).toBe(true);
	const walk = plan.specs.find((s) => s.kind === "walk");
	expect(walk?.from).not.toEqual(walk?.to);
	expect(plan.specs.find((s) => s.kind === "kickback")?.color).toBe(0xff5555);
	expect(plan.specs.some((s) => s.kind === "close")).toBe(true);
	expect(plan.closed).toEqual([2]);
	const motion = createMotion(plan);
	expect(motion.active(2100)).toBe(true);
	expect(motion.sample(2100)).toEqual(motion.sample(2100));
	expect(motion.sample(2100).tables.length).toBe(1);
	expect(motion.active(5000)).toBe(false);
	expect(motion.sample(5000).walkers.length).toBe(0);
	expect(motion.sample(5000).tables.length).toBe(0);
});
test("disabled animations retain closed state but produce no transient effects", () => {
	const plan = motionFor(events, members, 72, 13, 2100, {
		...DEFAULT_PROFILE,
		animations: false,
	});
	expect(plan.specs).toEqual([]);
	expect(createMotion(plan).sample(2100).closed).toEqual([2]);
	expect(createMotion(plan).active(2100)).toBe(false);
});
test("future events do not animate or close issues early", () => {
	const plan = motionFor(events, members, 72, 13, 1500, DEFAULT_PROFILE);
	expect(plan.closed).toEqual([]);
	expect(plan.specs.some((s) => s.kind === "close")).toBe(false);
});
