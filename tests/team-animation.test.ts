import { expect, test } from "claude-code/testing";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE } from "../src/profile";
import { width } from "../src/render/lines";
import { STUDIO } from "../src/render/studio";
import { teamStudioView } from "../src/render/team-studio";
import type { BullpenEvent } from "../types";

const events: BullpenEvent[] = [
	...["ada", "smith", "scout"].map((who) => ({
		version: 1 as const,
		at: 0,
		kind: "spawn" as const,
		who,
		issues: [1],
		detail: "joined",
	})),
	{
		version: 1,
		at: 10000,
		kind: "message",
		who: "ada",
		target: "smith",
		issues: [1],
		detail: "Please review #1",
	},
	{
		version: 1,
		at: 10000,
		kind: "turn-end",
		who: "scout",
		issues: [1],
		detail: "finished a turn",
	},
];
const github = { filter: "", checkedAt: 0, burndown: [] };
const model = buildModel(events, 10000);
function render(
	now: number,
	animations = true,
	columns = 80,
	glyphs: "ascii" | "unicode" = "unicode",
) {
	return teamStudioView(
		model,
		github,
		{ ...DEFAULT_PROFILE, animations, glyphs },
		columns,
		37,
		now,
	);
}

test("Studio highlights both message participants and completed turns, then expires without moving cards", () => {
	const first = render(10000);
	const second = render(11000);
	const labels = first.regions.flat();
	expect(labels.find((s) => s.text.includes("→ TO smith"))?.bold).toBe(true);
	expect(labels.find((s) => s.text.includes("← FROM ada"))?.bold).toBe(true);
	expect(labels.find((s) => s.text.includes("✓ TURN DONE"))?.bold).toBe(true);
	expect(
		second.regions.flat().find((s) => s.text.includes("→ TO smith"))?.bold,
	).toBe(false);
	for (const now of [9000, 14000]) {
		const text = render(now)
			.regions.flat()
			.map((s) => s.text)
			.join("");
		expect(text.includes("TO smith")).toBe(false);
		expect(text.includes("FROM ada")).toBe(false);
		expect(text.includes("TURN DONE")).toBe(false);
	}
	for (const columns of [60, 80, 120, 160]) {
		const frames = [10000, 11000, 12000, 14000].map((at) =>
			render(at, true, columns),
		);
		for (const frame of frames) {
			expect(frame.regions.length).toBe(frames[0]?.regions.length);
			for (const line of [...frame.header, ...frame.regions])
				expect(width(line) <= columns).toBe(true);
			// Issue links keep their positions through the pulse and expiry.
			expect(
				frame.regions.flatMap((line, i) =>
					line.filter((seg) => seg.story !== undefined).map(() => i),
				),
			).toEqual(
				frames[0]?.regions.flatMap((line, i) =>
					line.filter((seg) => seg.story !== undefined).map(() => i),
				),
			);
		}
	}
});

test("Studio animation fallback keeps status and activity without transient effects", () => {
	for (const now of [10000, 11000]) {
		const text = render(now, false)
			.regions.flat()
			.map((s) => s.text)
			.join("");
		expect(text).toContain("(o_o) heads-down");
		expect(text).toContain("Please review #1");
		expect(text.includes("TO smith")).toBe(false);
		expect(text.includes("TURN DONE")).toBe(false);
	}
	const ascii = render(10000, true, 80, "ascii").regions.flat();
	expect(ascii.some((s) => s.text.includes("TO smith"))).toBe(true);
	for (const seg of ascii) expect(/^[\x20-\x7e]*$/.test(seg.text)).toBe(true);
});

test("a new turn clears the previous turn completion highlight", () => {
	const next = buildModel(
		[
			...events,
			{
				version: 1,
				at: 11000,
				kind: "turn-start",
				who: "scout",
				issues: [1],
				detail: "started a turn",
			},
		],
		11000,
	);
	const view = teamStudioView(next, github, DEFAULT_PROFILE, 80, 37, 11000);
	expect(view.regions.flat().some((s) => s.text.includes("TURN DONE"))).toBe(
		false,
	);
});

test("Studio pulses only card frames when teammate colors match the default edge", () => {
	for (const now of [10000, 11000, 14000]) {
		const view = teamStudioView(
			model,
			github,
			{
				...DEFAULT_PROFILE,
				roles: {
					ada: { color: "#3a5263" },
					smith: { color: "#3a5263" },
					scout: { color: "#3a5263" },
				},
			},
			80,
			37,
			now,
		);
		const segments = view.regions.flat();
		for (const name of ["ada", "smith", "scout"])
			expect(segments.find((s) => s.text === name)?.fg).toBe(STUDIO.edge);
		const statuses = segments.filter((s) => /heads-down|snoozing/.test(s.text));
		expect(statuses.length).toBe(3);
		const frames = segments.filter((s) => s.text.startsWith("╭"));
		expect(frames.map((s) => s.fg)).toEqual(
			now === 10000
				? [STUDIO.lavender, STUDIO.mint, STUDIO.lavender]
				: [STUDIO.edge, STUDIO.edge, STUDIO.edge],
		);
	}
});
