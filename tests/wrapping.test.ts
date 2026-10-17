import { expect, test } from "claude-code/testing";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE } from "../src/profile";
import { header } from "../src/render/header";
import { width, wrapText } from "../src/render/lines";
import { storyLines } from "../src/render/story";
import type { BullpenEvent } from "../types";

const detail =
	"Please review the final verification logs and confirm whether the remaining integration failure should block the release SENTINEL";
const event: BullpenEvent = {
	version: 1,
	at: 0,
	kind: "message",
	who: "gate",
	target: "lead",
	detail: `${detail}?`,
	issues: [12],
};
const text = (lines: ReturnType<typeof wrapText>) =>
	lines.map((line) => line.map((s) => s.text).join("")).join(" ");

test("needs-you asks and issue stories wrap instead of clipping their text", () => {
	for (const columns of [48, 60, 72, 100, 160]) {
		const asks = header(
			buildModel([event], 0),
			{ filter: "", checkedAt: 0, burndown: [] },
			columns,
			0,
		);
		expect(text(asks)).toContain("SENTINEL");
		const story = storyLines(
			{ issue: 12, title: detail, state: "open", events: [event] },
			DEFAULT_PROFILE,
			columns,
			30,
		);
		expect(text(story)).toContain("SENTINEL?");
		for (const line of [...asks, ...story])
			expect(width(line) <= columns).toBe(true);
	}
});

test("long words hard-wrap and limited stories stay bounded with an overflow marker", () => {
	const wrapped = wrapText("x".repeat(150), 48);
	expect(wrapped.length).toBe(4);
	expect(text(wrapped).replace(/ /g, "")).toBe("x".repeat(150));
	for (const rows of [0, 1, 3, 5, 10]) {
		const lines = storyLines(
			{
				issue: 12,
				state: "open",
				events: [{ ...event, detail: detail.repeat(10) }],
			},
			DEFAULT_PROFILE,
			48,
			rows,
		);
		expect(lines.length <= rows).toBe(true);
		if (rows >= 5) expect(text(lines)).toContain("more lines");
	}
});

test("stories use every row when single-line or wrapped events exactly fit", () => {
	for (const events of [
		[{ ...event, kind: "tool" as const, detail: "done" }],
		[event],
		[event, { ...event, at: 1, detail: "Second event SENTINEL" }],
	]) {
		const story = { issue: 12, state: "open", events };
		const full = storyLines(story, DEFAULT_PROFILE, 48, 100);
		const exact = storyLines(story, DEFAULT_PROFILE, 48, full.length);
		expect(exact).toEqual(full);
		expect(text(exact).includes("earlier events")).toBe(false);
		expect(text(exact).includes("more lines")).toBe(false);
	}
});

test("overflow reserves a row for earlier events and retains the latest event", () => {
	const events = Array.from({ length: 4 }, (_, at) => ({
		...event,
		at,
		kind: "tool" as const,
		detail: `event-${at}`,
	}));
	const lines = storyLines(
		{ issue: 12, state: "open", events },
		DEFAULT_PROFILE,
		48,
		5,
	);
	expect(lines.length).toBe(5);
	expect(text(lines)).toContain("2 earlier events");
	expect(text(lines)).toContain("event-2");
	expect(text(lines)).toContain("event-3");
});
