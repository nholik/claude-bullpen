import { expect, test } from "claude-code/testing";
import { commandVerdict, shipPaths } from "../src/model/ship";
import type { BullpenEvent } from "../types";

// Details are lifted from this team's own journal (session 29ccd882).
let clock = 0;
const msg = (who: string, detail: string): BullpenEvent => ({
	version: 1,
	at: ++clock,
	kind: "message",
	who,
	target: "team-lead",
	detail,
	issues: [],
});
const bash = (who: string, detail: string): BullpenEvent => ({
	version: 1,
	at: ++clock,
	kind: "tool",
	outcome: "ok",
	who,
	target: "Bash",
	detail,
	issues: [],
});

const pr = "https://github.com/nholik/claude-bullpen/pull";

test("a PR announced, reviewed with CHANGES, resubmitted, then passed", () => {
	const events = [
		msg("ada", `#44 PR: ${pr}/61 (SSO phrase matching; …`),
		msg("ada", `#44 please review PR ${pr}/61`),
		bash(
			"lead",
			'for p in 61 62; do gh pr comment $p --body "@codex review";…',
		),
		bash(
			"gate",
			'gh pr review 61 --request-changes --body "Gate: CHANGES (P0…',
		),
	];
	expect(shipPaths(events)[44]).toMatchObject({
		stage: "changes",
		pr: 61,
		verdict: "changes",
		codex: true,
	});
	const later = [
		...events,
		msg("gate", "PR #61 (#44): PASS. PR #68 (#45): PASS, check green on both."),
	];
	const paths = shipPaths(later);
	expect(paths[44]).toMatchObject({ stage: "approved", verdict: "pass" });
	expect(paths[45]).toMatchObject({ stage: "approved", pr: 68 });
});

const closing: BullpenEvent = {
	...bash("lead", "gh issue close 46"),
	confirmedCloses: [46],
};

test("table: single events and the stage they produce", () => {
	for (const [events, issue, stage] of [
		[[msg("kit", `#46 PR: ${pr}/62 (table-driven tests ad…`)], 46, "pr-open"],
		[[msg("smith", `#59 PR open: ${pr}/70. Studio header no…`)], 59, "pr-open"],
		[[msg("kit", `#47 please review ${pr}/67`)], 47, "in-review"],
		[
			[msg("gate", "PR #61 (#44) CHANGES: the PR's commit 02a59c5 c…")],
			44,
			"changes",
		],
		[
			[msg("gate", "PR #62 (#46): PASS. Two optional P3 notes are on…")],
			46,
			"approved",
		],
		[
			[msg("gate", "Gate round 2: #61 (#44) PASS now (correct content")],
			44,
			"approved",
		],
		[
			[bash("kit", 'gh pr create --fill --body "Closes #46 ...')],
			46,
			"pr-open",
		],
		[
			[
				msg("kit", `#46 PR: ${pr}/62 (x)`),
				bash("lead", "gh pr merge 62 --squash"),
			],
			46,
			"merged",
		],
		[[msg("kit", `#46 PR: ${pr}/62 (x)`), closing], 46, "shipped"],
	] as const)
		expect(shipPaths(events)[issue]?.stage).toBe(stage);
});

test("a resubmission after CHANGES goes back to review, keeping the verdict", () => {
	const paths = shipPaths([
		msg("ada", `#44 PR: ${pr}/61 (x)`),
		msg("gate", "PR #61 (#44) CHANGES: wrong diff"),
		msg("ada", `#44 please review PR ${pr}/61`),
	]);
	expect(paths[44]).toMatchObject({ stage: "in-review", verdict: "changes" });
});

test("commands that cannot be tied to an issue move nothing", () => {
	for (const detail of [
		"gh pr view 61 && gh pr diff 61 --name-only && gh issue view…",
		'gh pr review 61 --request-changes --body "Gate: CHANGES"',
		"gh pr merge 99",
		'gh pr comment 99 --body "@codex review"',
	])
		expect(shipPaths([bash("gate", detail)])).toEqual({});
});

test("merged and shipped do not regress on later talk", () => {
	const merged = shipPaths([
		msg("kit", `#46 PR: ${pr}/62 (x)`),
		bash("lead", "gh pr merge 62 --squash"),
		msg("gate", "PR #62 (#46): PASS, merged."),
	]);
	expect(merged[46]).toMatchObject({ stage: "merged", verdict: "pass" });
	const shipped = shipPaths([
		msg("kit", `#46 PR: ${pr}/62 (x)`),
		{ ...bash("lead", "gh issue close 46"), confirmedCloses: [46] },
		msg("kit", `#46 please review ${pr}/62`),
	]);
	expect(shipped[46]?.stage).toBe("shipped");
	const advanced = shipPaths([
		msg("kit", `#46 PR: ${pr}/62 (x)`),
		bash("lead", "gh pr merge 62 --squash"),
		{ ...bash("lead", "gh issue close 46"), confirmedCloses: [46] },
	]);
	expect(advanced[46]?.stage).toBe("shipped");
});

test("closed issues from the model mark shipped", () => {
	expect(shipPaths([], [12])[12]?.stage).toBe("shipped");
});

test("gh pr review verdicts", () => {
	for (const [command, expected] of [
		["gh pr review 61 --request-changes --body x", "changes"],
		["gh pr review 61 --approve", "pass"],
		['gh pr review 61 --comment --body "Gate: CHANGES (P0, wrong …', "changes"],
		['gh pr review 61 --comment --body "Gate re-review: PASS. T…', "pass"],
		["gh pr review 61 --comment --body hello", undefined],
		["gh pr view 61", undefined],
	] as const)
		expect(commandVerdict(command)).toBe(expected);
});

test("a merge said in a message counts only for a known PR and a plain statement", () => {
	const start = [msg("gate", "PR #91 (#87): PASS. The check is green.")];
	for (const [text, stage] of [
		["Lead: #91 merged. Your queue isn't empty.", "merged"],
		["PR #91 merged, thanks", "merged"],
		["merged PR #91", "merged"],
		["#91 is merged", "merged"],
		["Is #91 merged?", "approved"],
		["#91 is not merged yet", "approved"],
		["I will get #91 merged after review", "approved"],
		["#87 merged", "approved"],
		["#99 merged", "approved"],
	] as const)
		expect(shipPaths([...start, msg("lead", text)])[87]?.stage).toBe(stage);
	expect(shipPaths([msg("lead", "#91 merged")])).toEqual({});
});

test("a bounced review stays flagged after it passes", () => {
	const paths = shipPaths([
		msg("gate", "PR #61 (#44) CHANGES: wrong diff"),
		msg("gate", "PR #61 (#44): PASS"),
	]);
	expect(paths[44]).toMatchObject({ stage: "approved", bounced: true });
});

test("merges inside shell chains and loops move every PR", () => {
	const announce = [
		msg("ada", `#92 PR: ${pr}/101 (x)`),
		msg("kit", `#94 PR: ${pr}/103 (x)`),
	];
	for (const detail of [
		"cd /repo && gh pr merge 101 --squash && gh pr merge 103 --squash && git pull",
		"for p in 101 103; do gh pr merge $p --squash --delete-branch; done",
		`for p in 101 103; do echo merging $p; gh pr merge \${p} --squash; done`,
	]) {
		const paths = shipPaths([...announce, bash("lead", detail)]);
		expect(paths[92]?.stage).toBe("merged");
		expect(paths[94]?.stage).toBe("merged");
	}
	const view = shipPaths([
		...announce,
		bash("lead", "gh pr view 101 && gh pr merge 103"),
	]);
	expect(view[92]?.stage).toBe("pr-open");
	expect(view[94]?.stage).toBe("merged");
});

test("a long digit run in a for loop does not backtrack", () => {
	const start = Date.now();
	expect(
		shipPaths([
			bash("lead", `for p in ${"1".repeat(60)}x; do gh pr merge $p; done`),
		]),
	).toEqual({});
	expect(Date.now() - start).toBeLessThan(500);
});
