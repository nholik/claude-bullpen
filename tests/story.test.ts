import { expect, test } from "claude-code/testing";
import { DEFAULT_PROFILE } from "../src/profile";
import { width } from "../src/render/lines";
import { storyFor, storyLines } from "../src/render/story";
import type { BullpenEvent, GithubSource } from "../types";

const source: GithubSource = {
	filter: "",
	checkedAt: 0,
	burndown: [],
	result: {
		status: "ok",
		issues: [
			{ number: 1, title: "Auth", state: "closed", labels: [], assignees: [] },
		],
	},
};
const events: BullpenEvent[] = [
	{
		version: 1,
		at: 0,
		kind: "spawn",
		who: "lead",
		target: "smith",
		detail: "assigned #1",
		issues: [1],
	},
	{
		version: 1,
		at: 1,
		kind: "tool",
		who: "smith",
		detail: "edit auth.ts",
		issues: [],
	},
	{
		version: 1,
		at: 2,
		kind: "tool",
		who: "smith",
		detail: "work #2",
		issues: [2],
	},
	{
		version: 1,
		at: 3,
		kind: "tool",
		who: "smith",
		detail: "edit other.ts",
		issues: [],
	},
	{
		version: 1,
		at: 4,
		kind: "message",
		who: "gate",
		target: "smith",
		detail: "#1 FAIL, sending it back",
		issues: [1],
	},
];
test("story includes implicit edits until reassignment and cross-agent mentions", () => {
	const story = storyFor(1, events, source);
	expect(story.title).toBe("Auth");
	expect(story.state).toBe("closed");
	expect(story.events.map((e) => e.at)).toEqual([0, 1, 4]);
	expect(
		storyLines(story, DEFAULT_PROFILE, 160, 20)
			.flat()
			.map((s) => s.text)
			.join(" "),
	).toContain("kickback");
	expect(storyFor(2, events, source).events.map((e) => e.at)).toEqual([2, 3]);
});
test("story handles missing GitHub data and bounded small panes", () => {
	const story = storyFor(1, events, { filter: "", checkedAt: 0, burndown: [] });
	expect(story.state).toBe("GitHub state unavailable");
	for (const columns of [20, 60, 72, 80, 100, 110, 160])
		for (const rows of [0, 1, 2, 3, 4, 20]) {
			const lines = storyLines(story, DEFAULT_PROFILE, columns, rows);
			expect(lines.length <= rows).toBe(true);
			for (const line of lines) expect(width(line) <= columns).toBe(true);
		}
	expect(storyFor(99, events, source).events).toEqual([]);
});
