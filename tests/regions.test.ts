import { expect, test } from "claude-code/testing";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE } from "../src/profile";
import { width } from "../src/render/lines";
import { paneView } from "../src/render/pane";
import { hallway, huddles } from "../src/render/regions";
import type { BullpenEvent } from "../types";

const events: BullpenEvent[] = Array.from({ length: 8 }, (_, i) => ({
	version: 1,
	at: 1000 + i,
	kind: "spawn",
	who: `member${i}`,
	detail: "joined",
	issues: [i + 1],
}));
events.push({
	version: 1,
	at: 2000,
	kind: "message",
	who: "member0",
	target: "lead",
	detail: "#1 needs a decision?",
	issues: [1],
});
const github = { filter: "", checkedAt: 0, burndown: [] };
test("hallway wakes on message and collapses after three quiet minutes", () => {
	const model = buildModel(events, 2000);
	expect(hallway(model, DEFAULT_PROFILE, 60, 10, 2000).length).toBe(2);
	expect(hallway(model, DEFAULT_PROFILE, 60, 10, 182000).length).toBe(2);
	expect(hallway(model, DEFAULT_PROFILE, 60, 10, 182001).length).toBe(1);
	expect(
		hallway(model, DEFAULT_PROFILE, 60, 10, 182001)[0]?.[0]?.text,
	).toContain("quiet");
});
test("cards prioritize activity and account for overflow", () => {
	const model = buildModel(events, 2000);
	const cards = huddles(model, github, DEFAULT_PROFILE, 60, 5, 2000);
	expect(cards[1]?.[0]?.text).toContain("#1");
	expect(cards[cards.length - 1]?.[0]?.text).toContain("+7 more");
});
test("every region and focus mode stays inside pane dimensions", () => {
	const model = buildModel(events, 2000);
	for (const columns of [20, 47, 48, 60, 72, 80, 100, 110, 160])
		for (const rows of [8, 24, 48])
			for (const focus of [undefined, "floor", "huddles", "talk"] as const) {
				const view = paneView(model, [], columns, rows, 2000, { focus });
				const lines = [
					...view.header,
					...view.regions,
					...view.footer,
					view.band,
				];
				expect(lines.length + view.floorRows <= rows).toBe(true);
				for (const line of lines) expect(width(line) <= columns).toBe(true);
			}
	const view = paneView(model, [], 72, 48, 2000);
	expect(view.floorRows).toBe(13);
	expect(
		view.regions.some((line) => line.some((seg) => seg.text.includes("│"))),
	).toBe(true);
});

test("surfaces without Raster give floor space back to the regions", () => {
	const model = buildModel(events, 2000);
	for (const columns of [48, 72, 110, 160]) {
		const terminal = paneView(model, [], columns, 24, 2000);
		const other = paneView(model, [], columns, 24, 2000, { raster: false });
		expect(other.floorRows).toBe(0);
		expect(other.regions.length > terminal.regions.length).toBe(true);
		const focused = paneView(model, [], columns, 24, 2000, {
			raster: false,
			focus: "floor",
		});
		expect(focused.floorRows).toBe(0);
		expect(focused.regions.length > 0).toBe(true);
	}
});
