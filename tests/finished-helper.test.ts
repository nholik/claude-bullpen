import { expect, test } from "claude-code/testing";

import { buildModel } from "../src/model";
import { isDoneReport, ownedRefs } from "../src/model/detect";
import type { BullpenEvent } from "../types";

const T = Date.UTC(2026, 9, 18, 14, 0, 0);
const MIN = 60_000;

const ev = (
	seconds: number,
	kind: BullpenEvent["kind"],
	detail: string,
	extra: Partial<BullpenEvent> = {},
): BullpenEvent => ({
	version: 1,
	at: T + seconds * 1000,
	kind,
	who: "intern",
	detail,
	issues: [],
	...extra,
});

// The dogfood journal for #152: a one-shot Haiku helper asked to prune
// worktrees. Its brief named no issue; its report to the lead was a table.
const REPORT =
	"Worktree prune done. Removed 6 merged worktrees | .worktrees/110-retire-operations | #114 (merged) | Removed | .worktrees/120-pr-comment-refs | #120 (merged) | Removed";
const journal: BullpenEvent[] = [
	ev(0, "spawn", "prune worktrees", { target: "intern", who: "team-lead" }),
	ev(1, "turn-start", "prune worktrees"),
	...Array.from({ length: 10 }, (_, i) =>
		ev(2 + i, "tool", `git worktree remove ${i}`, { target: "Bash" }),
	),
	ev(20, "message", REPORT, {
		target: "team-lead",
		issues: [114, 120],
	}),
	ev(21, "turn-end", ""),
];

test("a finished helper's report table owns nothing and never reads as stuck", () => {
	for (const minutes of [1, 6, 30, 120]) {
		const model = buildModel(journal, T + minutes * MIN);
		expect(model.teammates.intern?.issue).toBeUndefined();
		expect(model.teammates.intern?.status).toBe("idle");
		expect(model.stuck?.intern).toBeUndefined();
	}
});

test("without the done report the same helper on a real issue is stuck", () => {
	const events = [
		...journal.slice(0, -2),
		ev(20, "message", "Working through #114 now", {
			target: "team-lead",
			issues: [114],
		}),
		ev(21, "turn-end", ""),
	];
	const model = buildModel(events, T + 30 * MIN);
	expect(model.teammates.intern?.issue).toBe(114);
	expect(model.stuck?.intern).toContain("idle with open work");
});

test("new work after a done report clears the finish", () => {
	const events = [
		...journal,
		ev(30, "turn-start", "next job"),
		ev(31, "tool", "gh issue view 114", { target: "Bash", issues: [114] }),
		ev(32, "turn-end", ""),
	];
	const model = buildModel(events, T + 30 * MIN);
	expect(model.teammates.intern?.reportedDone).toBe(false);
	expect(model.stuck?.intern).toContain("idle with open work");
});

test("ownedRefs drops report rows and refs the message calls settled", () => {
	expect(ownedRefs(REPORT, [114, 120])).toEqual([]);
	expect(ownedRefs("PR #5 is up, checks green", [5])).toEqual([5]);
	expect(ownedRefs("#114 (merged), now on #115", [114, 115])).toEqual([115]);
	expect(ownedRefs("#12 closed; taking #13", [12, 13])).toEqual([13]);
	expect(ownedRefs("anything", [])).toEqual([]);
});

test("isDoneReport takes finished reports, not questions or negations", () => {
	expect(isDoneReport("Worktree prune done. Removed 6")).toBe(true);
	expect(isDoneReport("All set, tests passing")).toBe(true);
	expect(isDoneReport("Not done yet, still checking")).toBe(false);
	expect(isDoneReport("Are you done with #5?")).toBe(false);
	expect(isDoneReport("Working on #5")).toBe(false);
});
