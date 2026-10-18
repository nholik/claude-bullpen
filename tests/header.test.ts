import { expect, test } from "claude-code/testing";
import { drawFloor } from "../src/floor";
import { allStatesFilter, countArgv, issueListArgv } from "../src/github";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE, parseProfile } from "../src/profile";
import { band, footer, header, pace, sparkline } from "../src/render/header";
import { width } from "../src/render/lines";
import type { GithubSource } from "../types";

const github: GithubSource = {
	filter: "label:bug",
	checkedAt: 60000,
	result: { status: "ok", issues: [], counts: { open: 5, closed: 7 } },
	burndown: [
		{ at: 0, open: 12, closed: 0 },
		{ at: 60000, open: 5, closed: 7 },
	],
};
test("header, footer and band fit narrow widths and describe missing data", () => {
	const model = buildModel([], 0);
	for (const columns of [20, 60, 80, 110, 160]) {
		for (const line of [
			...header(model, github, columns, 0),
			...footer(github, columns),
			band(model, github, DEFAULT_PROFILE, columns, -1),
		])
			expect(width(line) <= columns).toBe(true);
	}
	expect(
		header(model, github, 160, 0)
			.flat()
			.map((s) => s.text)
			.join(""),
	).toContain("7/12 closed");
	expect(
		footer({ filter: "", checkedAt: 0, burndown: [] }, 80)[0]
			?.map((s) => s.text)
			.join(""),
	).toContain("no GitHub data");
});
test("pace needs elapsed time and completions; sparkline is bounded", () => {
	expect(pace([])).toBe("pace —");
	expect(pace(github.burndown)).toBe("pace ~1m");
	expect(
		pace([
			{ at: 0, open: 5, closed: 0 },
			{ at: 60000, open: 6, closed: 0 },
		]),
	).toBe("pace —");
	expect(sparkline(github.burndown, 1).length).toBe(1);
	expect(sparkline([], 10)).toBe("");
});

test("a flat burndown reports the open count without a meaningless pace estimate", () => {
	const flat: GithubSource = {
		...github,
		burndown: [
			{ at: 0, open: 5, closed: 7 },
			{ at: 60000, open: 5, closed: 7 },
		],
	};
	for (const columns of [48, 72, 110, 160]) {
		const lines = footer(flat, columns);
		const label = lines
			.flat()
			.map((seg) => seg.text)
			.join("");
		expect(label).toContain("5 open · no change yet");
		expect(label).not.toContain("pace");
		for (const line of lines) expect(width(line)).toBeLessThanOrEqual(columns);
	}
});
test("state qualifiers never constrain both-state issue queries", () => {
	const input = 'label:bug is:open state:closed -is:closed "is:open phrase"';
	expect(allStatesFilter(input)).toBe('label:bug "is:open phrase"');
	expect(issueListArgv("is:open").includes("--search")).toBe(false);
	expect(
		countArgv("owner/repo", "is:open label:bug", "closed").join(" "),
	).toContain("is:issue label:bug state:closed");
});
test("mixed-type palette retains valid colors and affects floor pixels", () => {
	const parsed = parseProfile(
		'{"palette":["#aabbcc",7,null],"roles":{"smith":{"color":"#ff0000"}}}',
	);
	expect(parsed.profile.palette).toEqual([0xaabbcc]);
	expect(parsed.warnings.length).toBe(2);
	const member = {
		id: "smith",
		name: "smith",
		status: "running" as const,
		color: 0,
		lastActiveAt: 0,
		issue: 1,
	};
	expect(drawFloor([member], 110, 13, 0, {}, parsed.profile).cells).not.toBe(
		drawFloor([member], 110, 13, 0).cells,
	);
});
test("the footer says why there is no GitHub data", () => {
	const text = (g: Parameters<typeof footer>[0], m?: "demo" | "replay") =>
		footer(g, 120, m)[0]
			?.map((s) => s.text)
			.join("");
	const fresh = { filter: "", checkedAt: 0, burndown: [] };
	expect(text(fresh)).toContain("waiting for first poll");
	expect(text({ ...fresh, checkedAt: 5 })).toContain("no result yet");
	expect(text(fresh, "demo")).toContain("paused in demo");
	expect(text(fresh, "replay")).toContain("paused in replay");
	expect(
		text({
			...fresh,
			result: { status: "error", message: "gh not found" } as never,
		}),
	).toContain("gh not found");
});
