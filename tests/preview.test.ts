import { expect, test } from "claude-code/testing";
import { demoAt } from "../src/demo-replay";
import { buildModel } from "../src/model";
import { fit, width } from "../src/render/lines";
import { paneView } from "../src/render/pane";

test("demo replay obeys timestamps and retains issue assignments in the model", () => {
	const first = demoAt(0);
	expect(Object.keys(first.members).length).toBe(1);
	expect(buildModel(first.events, 0).huddles[0]?.issue).toBe(208);
	const moved = demoAt(7500);
	expect(buildModel(moved.events, 7500).teammates.smith?.issue).toBe(204);
	expect(demoAt(7500)).toEqual(moved);
});

test("all preview regions fit their viewport at narrow and wide sizes", () => {
	for (const columns of [60, 80, 110, 160])
		for (const rows of [8, 24, 48])
			for (const now of [0, 7500, 12000, 200000]) {
				const replay = demoAt(now);
				const view = paneView(
					buildModel(replay.events, now),
					Object.values(replay.members),
					columns,
					rows,
					now,
				);
				const lines = [
					...view.header,
					...view.regions,
					...view.footer,
					view.band,
				];
				expect(lines.length + view.floorRows <= rows).toBe(true);
				for (const line of lines) expect(width(line) <= columns).toBe(true);
			}
});

test("styled clipping counts display width and preserves colors", () => {
	const line = fit([{ text: "界界", fg: 123 }, { text: " tail" }], 5);
	expect(width(line) <= 5).toBe(true);
	expect(line[0]?.fg).toBe(123);
	expect(fit([{ text: "hello" }], 0)).toEqual([]);
});
