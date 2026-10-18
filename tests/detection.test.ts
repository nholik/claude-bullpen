import { expect, test } from "claude-code/testing";
import { mergedPrs } from "../src/command";
import { issueRefs, toolText } from "../src/events";
import { readJournal, toLine } from "../src/journal";
import { buildModel } from "../src/model";
import {
	briefIssue,
	closedIssues,
	confirmedToolCloses,
	ghTargets,
	isKickback,
} from "../src/model/detect";
import type { BullpenEvent } from "../types";

test("questions, intentions and commands are not explicit close confirmations", () => {
	for (const text of [
		"Is #12 closed?",
		"Who closed #12?",
		"Who closed #12",
		"#12 closed?",
		"Can you mark #12 closed",
		"gh issue close #12",
		"not closed #12",
		"Can you confirm #12 is closed",
		"Have you closed #12",
		"Has #12 closed",
		"Could we mark #12 closed",
		"Can confirm #12 is not closed",
		"Can confirm whether #12 is closed",
		"Can confirm if #12 shipped",
		"Can you confirm whether #12 is closed",
		"Could confirm #12 shipped",
		"Could confirm whether #12 is closed",
		"Would confirm #12 is closed",
	])
		expect(closedIssues(text)).toEqual([]);
	for (const text of [
		"closed #12",
		"#12 is closed",
		"#12 ✓",
		"Can confirm #12 is closed",
		"Can confirm: closed #12",
		"Have closed #12",
		"Have confirmed #12 is closed",
		"Has closed #12",
		"Can now confirm #12 closed",
	])
		expect(closedIssues(text)).toEqual([12]);
});

test("PASS and negation apply to their own verdict clause", () => {
	for (const [text, expected] of [
		["PASS unit.test.ts\nFAIL e2e.test.ts", true],
		["PASS unit; FAIL e2e", true],
		["FAIL e2e\nPASS unit", true],
		["I'm not sending it back; looks good", false],
		["not sending it back, approved", false],
		["never sent it back", false],
		["PASS unit, but sending it back for e2e", true],
	] as const)
		expect(isKickback(text, true)).toBe(expected);
});

const success = { result: { stdout: "", stderr: "", interrupted: false } };
test("only successful foreground closes count as tool evidence", () => {
	expect(confirmedToolCloses("gh issue close 12", success)).toEqual([12]);
	for (const result of [
		undefined,
		{ deny: "no" },
		{ ...success, isError: true },
		{ result: { interrupted: true } },
		{ result: { interrupted: false, backgroundTaskId: "task" } },
		{ result: {} },
	])
		expect(confirmedToolCloses("gh issue close 12", result)).toEqual([]);
	for (const command of [
		"echo gh issue close 12",
		"gh issue close 12 || true",
		"gh issue close 12 &",
		"gh issue view 12",
	])
		expect(confirmedToolCloses(command, success)).toEqual([]);
});

test("unverified tools never close huddles and confirmed closes survive journals", () => {
	const event: BullpenEvent = {
		version: 1,
		at: 1,
		kind: "tool",
		who: "builder",
		target: "Bash",
		detail: "gh issue close 12",
		issues: [12],
	};
	expect(buildModel([event], 2).closed).toEqual([]);
	const verified = { ...event, confirmedCloses: [12] };
	expect(buildModel([verified], 2).closed).toEqual([12]);
	expect(readJournal(toLine(verified)).events[0]?.confirmedCloses).toEqual([
		12,
	]);
});

test("send-back negation covers only the phrase it modifies", () => {
	for (const [text, expected] of [
		["This is not ready, sending it back", true],
		["No fix here, kick it back", true],
		["Not green yet - kicking this back", true],
		["Nothing works; sent it back", true],
		["not sending it back", false],
		["I'm not going to send it back", false],
		["won't kick it back", false],
		["never kicked this back", false],
		["not ready, but not sending it back", false],
		["I don't think we should send it back", false],
		["I do not think we need to kick it back", false],
		["Not green yet \u2014 kicking this back", true],
	] as const)
		expect(isKickback(text, false)).toBe(expected);
});

test("a spawn brief assigns one issue, ignoring quoted examples and round lists", () => {
	for (const [brief, expected] of [
		["You are given one issue. Your issue is #46.", 46],
		["Implement #12 end to end. Also see #13.", 12],
		['Own #47. Example: "Can confirm #12 is closed" must count.', 47],
		["Heuristics. Say `closed #9` when done. Work on issue #64", 64],
		["Review the round: #59, #44, #45, #46 and #47", undefined],
		['Quote only: "Can confirm #12 is closed"', undefined],
		["Issue #12 (see #12) is yours", 12],
		["No refs at all", undefined],
		["Do not work on #12", undefined],
		["Do not work on #12. Work on #14.", 14],
		["Don't touch #12. Work on #14.", 14],
		["Not #12", undefined],
		["Leave #12 alone", undefined],
		["Leave #12 alone. Your issue is #14.", 14],
		["#12 is someone else's", undefined],
		["#12 is someone else's. Take #14.", 14],
		["Your issue is #13, not #12", 13],
		["Fix #13 without stepping on another builder's files.", 13],
		["Implement #13 so other agents can see it.", 13],
		["Work on #13 and leave a comment on #13 when done.", 13],
		["Your issue is #13 (#12 is someone else's).", 13],
		["Work on #13 (not #12)", 13],
		["Compare #13 (not #12), then work on #14.", 14],
		["Work on #13 (not #12,\nwhich ada has).", 13],
		["Your issue is #13 (not #12 -\nada owns it).", 13],
		["Work on #13 (not #12", 13],
	] as const)
		expect(briefIssue(brief)).toBe(expected);
});

test("gh issue and pr commands name the issue they act on", () => {
	for (const [command, expected] of [
		["gh issue view 59", [59]],
		["gh issue view 59 --json title", [59]],
		["gh pr comment #62 --body hi", []],
		["gh pr view 61", []],
		["gh pr review 62 && gh issue close 46", [46]],
		["gh issue list --limit 5", []],
		["echo gh issue view 7x", []],
		['echo "gh issue view 7"', []],
		['echo "example; gh issue close 8"', []],
	] as const)
		expect(ghTargets(command)).toEqual(expected);
	expect(issueRefs(toolText({ command: "gh issue view 59" }))).toEqual([59]);
	expect(
		issueRefs(toolText({ command: "gh pr comment #62 --body hi" })),
	).toEqual([]);
});

test("PR comment and review bodies mention issues without owning them", () => {
	const refs = (command: string) => issueRefs(toolText({ command }));
	for (const command of [
		'gh pr comment 62 --body "see #9"',
		"gh pr comment 62 -b 'see #9; and #10'",
		'gh pr review 62 --approve --body "fixes #9"',
		"gh pr comment 62 --body-file notes-#9.md",
		"gh pr comment 62 -F - <<'EOF'\nsee #9\nEOF",
		'git push && gh pr review 62 --comment -b "#9 #10"',
	])
		expect(refs(command)).toEqual([]);
	// Other segments of the chain, and `gh pr create` bodies, still count.
	expect(refs('gh pr comment 62 -b "see #9" && gh issue view 14')).toEqual([
		14,
	]);
	expect(refs('gh pr create --title t --body "Closes #14"')).toEqual([14]);
});

test("only executed gh commands count, not quoted or heredoc text", () => {
	for (const command of [
		'echo "run gh pr merge 5"',
		'git commit -m "gh pr merge 5"',
		'git commit -m "x\ngh pr merge 5"',
		"git commit -F - <<'EOF'\nmerge it\ngh pr merge 5\nEOF",
		"cat <<EOF\ngh issue close 8\nEOF",
	]) {
		expect(mergedPrs(command)).toEqual([]);
		expect(ghTargets(command)).toEqual([]);
	}
	expect(mergedPrs("cat <<EOF\nx\nEOF\ngh pr merge 5")).toEqual([5]);
	expect(mergedPrs("git push && gh pr merge 5; echo done")).toEqual([5]);
	expect(mergedPrs("git push | cat\ngh pr merge 6")).toEqual([6]);
	expect(ghTargets("cat <<EOF\nx\nEOF\ngh issue view 9")).toEqual([9]);
	expect(mergedPrs("wc -w <<< hello\ngh pr merge 5")).toEqual([5]);
	// Only `<<-` lets tabs indent the terminator; spaces never do.
	expect(mergedPrs("cat <<EOF\n  EOF\ngh pr merge 5\nEOF")).toEqual([]);
	expect(mergedPrs("cat <<EOF\n\tEOF\ngh pr merge 5\nEOF")).toEqual([]);
	expect(mergedPrs("cat <<-EOF\n\tEOF\ngh pr merge 5")).toEqual([5]);
	expect(mergedPrs("cat <<-EOF\n  EOF\ngh pr merge 5\nEOF")).toEqual([]);
	// An unterminated heredoc ends the scan instead of looping.
	expect(mergedPrs("cat <<EOF\ngh pr merge 5")).toEqual([]);
});

test("non-ownership gh pr verbs do not attribute their PR number", () => {
	for (const verb of ["comment", "view", "diff", "checks", "review"])
		expect(
			issueRefs(toolText({ command: `gh pr ${verb} #62 --repo a/b` })),
		).toEqual([]);
	expect(
		issueRefs(toolText({ command: "git push && gh issue edit 12 --title x" })),
	).toEqual([12]);
});
