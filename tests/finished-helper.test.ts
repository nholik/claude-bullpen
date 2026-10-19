import { expect, test } from "claude-code/testing";

import { readJournal } from "../src/journal";
import { buildModel } from "../src/model";
import { attributableRefs, ownedRefs } from "../src/model/detect";
import { shippingRows } from "../src/render/shipping";
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
	expect(ownedRefs("#5 is up, checks green", [5])).toEqual([5]);
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

// Dogfood #187: a PR number in "PR #N" phrases was taken for the issue its
// senders were on, giving the PR its own SHIPPING row. Redacted real lines.
test("a PR number is never an issue: no teammate is put on it, no row for it", () => {
	const at = 1792353900000;
	const line = (
		n: number,
		who: string,
		target: string,
		detail: string,
		issues: number[],
	) => ({
		version: 1,
		at: at + n * 1000,
		kind: "message",
		...(who === "lead" ? {} : { agentId: `a${who}-0001` }),
		who,
		target,
		detail,
		issues,
	});
	const journal = [
		line(
			0,
			"ada",
			"team-lead",
			"#12: PR #34 is open (https://example.invalid/pull/34). Head is abc123, one commit.",
			[12, 34],
		),
		line(
			70,
			"gate",
			"team-lead",
			"PR #34 (#12) CHANGES: the pushed head does not contain item (1).",
			[34, 12],
		),
		line(
			90,
			"lead",
			"ada",
			"Gate CHANGES on #34. First, the pushed head does not contain part 1.",
			[34],
		),
		line(140, "lead", "gate", "Please re-gate #34, now at abc456.", [34]),
	]
		.map((e) => JSON.stringify(e))
		.join("\n");
	const model = buildModel(readJournal(journal).events, at + 150_000);
	expect(model.teammates.gate?.issue).toBe(12);
	expect(model.teammates.lead?.issue).toBeUndefined();
	expect(model.huddles.map((h) => h.issue)).toEqual([12]);
	expect(shippingRows(model, at + 150_000).map((r) => r.issue)).toEqual([12]);
});
