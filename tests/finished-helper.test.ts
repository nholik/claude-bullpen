import { expect, test } from "claude-code/testing";

import { readJournal } from "../src/journal";
import { buildModel } from "../src/model";
import { attributableRefs, ownedRefs } from "../src/model/detect";
import intern from "./fixtures/intern-prune";

const MIN = 60_000;
const { events } = readJournal(intern);
const last = events[events.length - 1]?.at ?? 0;

// The real dogfood journal for #152: a one-shot helper asked to prune
// worktrees. Its brief named no issue; its report to the lead was a table of
// merged PRs, and the SendMessage tool call before it carried the same refs.
test("a finished helper's report table owns nothing and never reads as stuck", () => {
	expect(events.length).toBe(15);
	for (const minutes of [1, 6, 30, 120]) {
		const model = buildModel(events, last + minutes * MIN);
		expect(model.teammates.intern?.issue).toBeUndefined();
		expect(model.teammates.intern?.status).toBe("idle");
		expect(model.stuck?.intern).toBeUndefined();
	}
});

test("ownedRefs drops report rows and refs the message calls settled", () => {
	expect(ownedRefs("| #114 (merged) | Removed |", [114])).toEqual([]);
	expect(ownedRefs("PR #5 is up, checks green", [5])).toEqual([5]);
	expect(ownedRefs("#114 (merged), now on #115", [114, 115])).toEqual([115]);
	expect(ownedRefs("#12 closed; taking #13", [12, 13])).toEqual([13]);
	expect(ownedRefs("anything", [])).toEqual([]);
	expect(ownedRefs("| #114 (merged) |; now taking #115", [114, 115])).toEqual([
		115,
	]);
});

test("a SendMessage tool call moves no one; the message that follows does", () => {
	const call = {
		kind: "tool",
		target: "SendMessage",
		detail: "message → lead",
	};
	expect(attributableRefs(call, [114, 118])).toEqual([]);
	expect(attributableRefs({ ...call, target: "Bash" }, [114])).toEqual([114]);
	expect(
		attributableRefs({ kind: "message", detail: "working on #7" }, [7]),
	).toEqual([7]);
});
