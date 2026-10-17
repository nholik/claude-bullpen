import { expect, test } from "claude-code/testing";
import { prArgv, readPr } from "../src/github";
import { buildModel } from "../src/model";
import { SHIP_LINGER_MS, shippingRows } from "../src/render/shipping";
import type { BullpenEvent, GithubSource } from "../types";

const announced: BullpenEvent = {
	version: 1,
	at: 100,
	kind: "message",
	who: "builder",
	target: "lead",
	detail: "#12 PR: https://ghe.example.com/o/r/pull/22",
	issues: [12],
};
const source: GithubSource = {
	repo: "o/r",
	host: "ghe.example.com",
	filter: "",
	burndown: [],
	checkedAt: 1000,
};

test("GitHub confirms merges from another session and finished work never returns to SHIPPING", () => {
	const pr = readPr(
		{
			exitCode: 0,
			stderr: "",
			stdout: JSON.stringify({
				number: 22,
				state: "closed",
				merged_at: "2026-10-17T14:00:00Z",
			}),
		},
		Date.parse("2026-10-17T14:01:00Z"),
	);
	expect(pr?.state).toBe("MERGED");
	const github = { ...source, prs: pr ? [pr] : [] };
	const now = pr?.checkedAt ?? 0;
	const model = buildModel([announced], now, { github });
	expect(model.ship[0]?.stage).toBe("merged");
	expect(model.shipped).toBe(1);
	expect(model.huddles).toEqual([]);
	expect(shippingRows(model, now)).toHaveLength(1);
	const later = now + SHIP_LINGER_MS + 1;
	expect(
		shippingRows(buildModel([announced], later, { github }), later),
	).toEqual([]);
	expect(prArgv("o/r", "ghe.example.com", 22)).toEqual([
		"gh",
		"api",
		"repos/o/r/pulls/22",
		"--hostname",
		"ghe.example.com",
	]);
});

test("closed unmerged PRs return to working, failed polls invent no state, and old polls cannot undo newer evidence", () => {
	const closed = readPr(
		{
			exitCode: 0,
			stderr: "",
			stdout: '{"number":22,"state":"closed","merged_at":null}',
		},
		1000,
	);
	const model = buildModel([announced], 1000, {
		github: { ...source, prs: closed ? [closed] : [] },
	});
	expect(model.ship[0]?.stage).toBe("working");
	expect(model.ship[0]?.pr).toBeUndefined();
	expect(model.shipped).toBe(0);
	expect(
		readPr({ exitCode: 1, stdout: "", stderr: "network" }, 1000),
	).toBeUndefined();
	expect(
		readPr({ exitCode: 0, stdout: "{}", stderr: "" }, 1000),
	).toBeUndefined();
	const merged = { ...announced, at: 2000, detail: "PR #22 merged" };
	expect(
		buildModel([announced, merged], 2001, {
			github: {
				...source,
				prs: [{ number: 22, state: "OPEN", checkedAt: 1000 }],
			},
		}).ship[0]?.stage,
	).toBe("merged");
});

test("a requested or failed merge never counts as shipped before confirmation", () => {
	for (const outcome of [undefined, "error"] as const) {
		const command: BullpenEvent = {
			...announced,
			kind: "tool",
			target: "Bash",
			at: 200,
			detail: "gh pr merge 22",
			outcome,
		};
		expect(buildModel([announced, command], 300).shipped).toBe(0);
	}
});

test("a tracked issue closed on GitHub completes its rail without counting unrelated closed issues", () => {
	const github: GithubSource = {
		...source,
		result: {
			status: "ok",
			issues: [12, 99].map((number) => ({
				number,
				title: "issue",
				state: "closed",
				labels: [],
				assignees: [],
				closedAt: 900,
			})),
		},
	};
	const model = buildModel([announced], 1000, { github });
	expect(model.ship[0]?.stage).toBe("shipped");
	expect(model.shipped).toBe(1);
	expect(model.huddles).toEqual([]);
});
