import { expect, test } from "claude-code/testing";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE } from "../src/profile";
import { type Line, width } from "../src/render/lines";
import { paneView } from "../src/render/pane";
import {
	needsYou,
	SHIP_LINGER_MS,
	shipChain,
	shippingRows,
	shippingSection,
} from "../src/render/shipping";
import type { BullpenEvent } from "../types";

let clock = 0;
const msg = (who: string, target: string, detail: string): BullpenEvent => ({
	version: 1,
	at: (clock += 1000),
	kind: "message",
	who,
	target,
	detail,
	issues: [],
});
const flat = (line: Line) => line.map((s) => s.text).join("");
const pr = "https://github.com/o/r/pull";

test("a path reads as four steps with a bounced review kept visible", () => {
	for (const [events, expected] of [
		[
			[msg("kit", "lead", `#46 PR: ${pr}/62 (x)`)],
			"issue ━ PR #62 ━ review ━ merged",
		],
		[
			[msg("gate", "lead", "PR #62 (#46) CHANGES: wrong diff")],
			"issue ━ PR #62 ━ review ✗ ━ merged",
		],
		[
			[
				msg("gate", "lead", "PR #62 (#46) CHANGES: wrong diff"),
				msg("gate", "lead", "PR #62 (#46): PASS"),
			],
			"issue ━ PR #62 ━ review ✗→✓ ━ merged",
		],
		[
			[
				msg("gate", "lead", "PR #62 (#46): PASS"),
				msg("lead", "kit", "#62 merged, thanks"),
			],
			"issue ━ PR #62 ━ review ✓ ━ merged ✓",
		],
	] as const) {
		const row = shippingRows(buildModel(events, clock), clock)[0];
		expect(row && flat(shipChain(row))).toBe(expected);
	}
});

test("merged rows linger, then only the count keeps them", () => {
	const events = [
		msg("gate", "lead", "PR #62 (#46): PASS"),
		msg("lead", "kit", "#62 merged"),
	];
	const merged = clock;
	expect(shippingRows(buildModel(events, merged), merged)).toHaveLength(1);
	const later = merged + SHIP_LINGER_MS + 1;
	const model = buildModel(events, later);
	expect(shippingRows(model, later)).toEqual([]);
	expect(model.shipped).toBe(1);
});

test("merges and closes count once toward shipped", () => {
	const events: BullpenEvent[] = [
		msg("gate", "lead", "PR #62 (#46): PASS"),
		msg("lead", "kit", "#62 merged"),
		msg("lead", "kit", "closed #46"),
		msg("kit", "lead", "closed #12"),
	];
	expect(buildModel(events, clock).shipped).toBe(2);
});

test("needs-you is one calm line, or the first open ask in at most two", () => {
	const quiet = buildModel([], 0);
	expect(needsYou(quiet, 72).map(flat)).toEqual([" ✓ nothing needs you"]);
	const model = buildModel(
		[
			msg(
				"gate",
				"lead",
				`Should we skip or fix the flaky test? ${"x ".repeat(80)}`,
			),
			msg("kit", "lead", "Can you decide which PR goes first?"),
		],
		clock,
	);
	const lines = needsYou(model, 60);
	expect(lines.length).toBeLessThanOrEqual(2);
	expect(flat(lines[0] ?? [])).toContain("NEEDS YOU (+1 more) · gate");
	for (const line of lines) expect(width(line)).toBeLessThanOrEqual(60);
});

test("the SHIPPING section stays inside its cells and rows at every width", () => {
	const events: BullpenEvent[] = [];
	for (let n = 1; n <= 12; n++)
		events.push(msg(`mate${n}`, "lead", `#${n} PR: ${pr}/${100 + n} (title)`));
	const model = buildModel(events, clock);
	for (const columns of [60, 72, 80, 110, 160])
		for (const rows of [2, 4, 8, 14]) {
			const lines = shippingSection(
				model,
				{ filter: "", burndown: [], checkedAt: 0 },
				DEFAULT_PROFILE,
				columns,
				rows,
				clock,
			);
			expect(lines.length).toBeLessThanOrEqual(rows);
			for (const line of lines)
				expect(width(line)).toBeLessThanOrEqual(columns);
		}
	const full = shippingSection(
		model,
		{ filter: "", burndown: [], checkedAt: 0 },
		DEFAULT_PROFILE,
		72,
		5,
		clock,
	).map(flat);
	expect(full.at(-1)).toMatch(/^\+\d+ more issues/);
});

test("the pane leads with needs-you and carries SHIPPING instead of huddles", () => {
	const events = [
		msg("kit", "lead", `#46 PR: ${pr}/62 (x)`),
		msg("gate", "lead", "Can you decide: skip or fix the flaky test?"),
	];
	const model = buildModel(events, clock);
	for (const columns of [72, 110, 160]) {
		const view = paneView(model, [], columns, 40, clock, {
			profile: DEFAULT_PROFILE,
		});
		const text = [...view.header, ...view.regions].map(flat);
		expect(flat(view.header[2] ?? [])).toContain("NEEDS YOU");
		expect(text.some((l) => l.includes("SHIPPING"))).toBe(true);
		expect(text.some((l) => l.includes("HUDDLES"))).toBe(false);
	}
});
