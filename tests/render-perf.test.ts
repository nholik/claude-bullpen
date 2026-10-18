// A render budget: render code runs on the host's thread, so a slow draw
// stalls Claude Code. Each surface is drawn for the worst-case team
// (tests/fixtures/worst-case.ts) at three widths; the median of a few runs
// must stay under its budget. The budgets are about 3-5x the baseline measured
// on the dev laptop (in ms: pane 3-12, talk 15-34, shipping 1-2, needs about 1, band 0.06), so
// they catch an order-of-magnitude regression, not noise.

import { expect, test } from "claude-code/testing";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE } from "../src/profile";
import { band } from "../src/render/header";
import { paneView } from "../src/render/pane";
import type { GithubSource, Member } from "../types";
import worst, { WORST_NAMES, WORST_NOW } from "./fixtures/worst-case";

const model = buildModel(worst, WORST_NOW);
const members: Member[] = WORST_NAMES.map((name, color) => ({
	id: `a-${name}`,
	name,
	status: "running",
	color,
	lastActiveAt: WORST_NOW,
}));
const github: GithubSource = { filter: "", burndown: [], checkedAt: 0 };
const ROWS = 40;
const WARMUP = 3;
const RUNS = 9;

const pane = (focus?: "shipping" | "talk" | "needs") => (columns: number) =>
	paneView(model, members, columns, ROWS, WORST_NOW, {
		...(focus ? { focus } : {}),
	});

/**
 * One entry per surface. To budget a new surface (e.g. a needs view), add a
 * row: a name, a draw function taking the width, and a budget in ms.
 */
const SURFACES: {
	name: string;
	draw: (columns: number) => unknown;
	budgetMs: number;
}[] = [
	{ name: "pane", draw: pane(), budgetMs: 60 },
	{ name: "talk focus", draw: pane("talk"), budgetMs: 150 },
	{ name: "shipping focus", draw: pane("shipping"), budgetMs: 30 },
	{ name: "needs focus", draw: pane("needs"), budgetMs: 5 },
	{
		name: "band",
		draw: (columns) => band(model, github, DEFAULT_PROFILE, columns, -1),
		budgetMs: 5,
	},
];

const median = (xs: number[]) =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

test("the fixture is the worst case it claims to be", () => {
	expect(model.hallway.length).toBe(50);
	expect(model.hallway.every((m) => m.text.length >= 1000)).toBe(true);
	expect(Object.keys(model.teammates).length).toBeGreaterThanOrEqual(8);
	expect(model.ship.length).toBe(20);
	expect(model.decisions.length).toBeGreaterThanOrEqual(5);
});

for (const { name, draw, budgetMs } of SURFACES)
	for (const columns of [60, 110, 160])
		test(`${name} renders under ${budgetMs} ms at ${columns} columns`, () => {
			for (let i = 0; i < WARMUP; i++) draw(columns);
			const times: number[] = [];
			for (let i = 0; i < RUNS; i++) {
				const start = performance.now();
				draw(columns);
				times.push(performance.now() - start);
			}
			expect(median(times)).toBeLessThan(budgetMs);
		});
