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
	// Pulses recolor the face (no extra row): lavender for messages, mint for a finished turn.
	const face = (view: typeof first, name: string) =>
		view.regions
			.flat()
			.find((s, i, all) => all[i + 1]?.text === name && s.text.startsWith("("));
	expect(face(first, "ada")?.fg).toBe(STUDIO.lavender);
	expect(face(first, "smith")?.fg).toBe(STUDIO.lavender);
	expect(face(first, "scout")?.fg).toBe(STUDIO.mint);
	expect(face(first, "ada")?.bold).toBe(true);
	expect(face(second, "ada")?.bold).toBe(false);
	expect(face(second, "ada")?.fg).not.toBe(STUDIO.lavender);
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
		expect(text).toContain("(o.o) ada");
		expect(text).toContain("Please review #1");
		expect(text.includes("TO smith")).toBe(false);
		expect(text.includes("TURN DONE")).toBe(false);
	}
	const ascii = render(10000, true, 80, "ascii").regions.flat();
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
			160,
			37,
			now,
		);
		const segments = view.regions.flat();
		for (const name of ["ada", "smith", "scout"])
			expect(segments.find((s) => s.text === name)?.fg).toBe(STUDIO.edge);
		const statuses = segments.filter((s) => /^\(.*\) $/.test(s.text));
		expect(statuses.length).toBe(3);
		const frames = segments.filter((s) => s.text.startsWith("╭"));
		expect(frames.map((s) => s.fg)).toEqual(
			now === 10000
				? [STUDIO.lavender, STUDIO.lavender, STUDIO.mint]
				: [STUDIO.edge, STUDIO.edge, STUDIO.edge],
		);
	}
});

test("every card draws its state word beside the face, at any width and glyph mode", () => {
	for (const glyphs of ["unicode", "ascii"] as const)
		for (const columns of [48, 60, 80, 120]) {
			const text = render(10000, true, columns, glyphs)
				.regions.flat()
				.map((s) => s.text)
				.join("");
			expect(text).toContain("heads-down");
			expect(text).toContain("snoozing");
		}
});

test("a quiet card does not change second to second, so it never forces a redraw", () => {
	const text = (now: number) =>
		render(now)
			.regions.flat()
			.map((s) => s.text)
			.join("");
	expect(text(20000)).toBe(text(21000));
});

test("the state word never runs into the z's, whichever frame shows", () => {
	for (let now = 20000; now < 32000; now += 2000)
		for (const columns of [60, 80, 120]) {
			const text = render(now, true, columns)
				.regions.flat()
				.map((s) => s.text)
				.join("");
			expect(/[zZ]snoozing/.test(text)).toBe(false);
		}
});

test("idle cards dim and working cards do not", () => {
	const segs = render(20000).regions.flat();
	const dimmed = (name: string) =>
		segs.find((s) => s.text === name)?.dim === true;
	expect(dimmed("scout")).toBe(true);
	expect(dimmed("ada")).toBe(false);
});

test("every card shows its role, even two across", () => {
	const typed = buildModel(events, 10000, {
		agentTypes: { ada: "builder", smith: "gate", scout: "gate" },
	});
	for (const columns of [72, 110]) {
		const text = teamStudioView(
			typed,
			github,
			DEFAULT_PROFILE,
			columns,
			37,
			10000,
		)
			.regions.flat()
			.map((s) => s.text)
			.join("");
		expect(text).toContain("engineer");
		expect(text).toContain("reviewer");
	}
});
