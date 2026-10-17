import { expect, test } from "claude-code/testing";
import { readJournal, toLine } from "../src/journal";
import { buildModel } from "../src/model";
import {
	closedIssues,
	confirmedToolCloses,
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
	])
		expect(closedIssues(text)).toEqual([]);
	for (const text of [
		"closed #12",
		"#12 is closed",
		"#12 ✓",
		"Can confirm #12 is closed",
		"Can confirm: closed #12",
		"Could confirm #12 shipped",
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
