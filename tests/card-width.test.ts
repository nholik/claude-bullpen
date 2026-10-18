import { expect, test } from "claude-code/testing";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE } from "../src/profile";
import {
	cardsPerRow,
	createCardWidthTracker,
	createCardWidthTrackers,
	MAX_CARD_WIDTH,
	settledCardWidth,
	TWEEN_MS,
} from "../src/render/card-width";
import { teamStudioView } from "../src/render/team-studio";
import type { BullpenEvent } from "../types";

// Left column widths the Studio uses: floor((columns - 3) * 0.68).
const LEFT_110 = 72;
const LEFT_160 = 106;

test("cards per row never exceeds the number of cards", () => {
	expect(cardsPerRow(3, 1)).toBe(1);
	expect(cardsPerRow(3, 2)).toBe(2);
	expect(cardsPerRow(3, 7)).toBe(3);
	expect(cardsPerRow(2, 0)).toBe(1);
});

test("settled widths for 1, 2 and 3 cards at 110 and 160 columns", () => {
	// 72 is only 2 over the cap: fill the region rather than leave a sliver.
	expect(settledCardWidth(LEFT_110, 1)).toBe(72);
	expect(settledCardWidth(77, 1)).toBe(77);
	expect(settledCardWidth(78, 1)).toBe(MAX_CARD_WIDTH);
	expect(settledCardWidth(LEFT_110, 2)).toBe(35);
	expect(settledCardWidth(LEFT_160, 1)).toBe(MAX_CARD_WIDTH);
	expect(settledCardWidth(LEFT_160, 2)).toBe(52);
	expect(settledCardWidth(LEFT_160, 3)).toBe(34);
	for (const left of [LEFT_160, 300])
		for (const n of [1, 2, 3])
			expect(settledCardWidth(left, n)).toBeLessThanOrEqual(MAX_CARD_WIDTH);
});

test("the first draw and a pure resize snap", () => {
	const tracker = createCardWidthTracker();
	expect(tracker.sample(1, 70, 1000, true)).toBe(70);
	expect(tracker.moving(1000)).toBe(false);
	expect(tracker.sample(1, 60, 1100, true)).toBe(60);
	expect(tracker.moving(1100)).toBe(false);
});

test("cards ease wider when the team shrinks, and snap narrower when it grows", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(2, 35, 1000, true);
	// Growing 2 -> 3 cards: never wider than what fits the row, no tween.
	expect(tracker.sample(3, 23, 2000, true)).toBe(23);
	expect(tracker.moving(2000)).toBe(false);
	// Shrinking 3 -> 1: ease from 23 up to 70, monotonic and capped.
	expect(tracker.sample(1, 70, 3000, true)).toBe(23);
	expect(tracker.moving(3000)).toBe(true);
	const samples: number[] = [];
	for (let t = 3000; t <= 3000 + TWEEN_MS; t += 100)
		samples.push(tracker.sample(1, 70, t, true));
	expect(samples[0]).toBe(23);
	expect(samples.at(-1)).toBe(70);
	for (const [i, w] of samples.entries())
		expect(w).toBeGreaterThanOrEqual(samples[i - 1] ?? 23);
	expect(samples.every((w) => w >= 23 && w <= 70)).toBe(true);
	expect((samples[1] ?? 0) - (samples[0] ?? 0)).toBeLessThan(
		(samples[2] ?? 0) - (samples[1] ?? 0),
	);
	expect(tracker.moving(3000 + TWEEN_MS)).toBe(false);
	expect(tracker.sample(1, 70, 9000, true)).toBe(70);
});

test("a retarget mid-tween starts from the width on screen", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(3, 23, 0, true);
	tracker.sample(1, 70, 1000, true);
	const mid = tracker.sample(1, 70, 1200, true);
	expect(mid).toBeGreaterThan(23);
	expect(mid).toBeLessThan(70);
	expect(tracker.sample(2, 35, 1200, true)).toBe(Math.min(mid, 35));
});

test("animations off snaps every change", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(3, 23, 0, false);
	expect(tracker.sample(1, 70, 1000, false)).toBe(70);
	expect(tracker.moving(1000)).toBe(false);
	expect(tracker.sample(3, 23, 1010, false)).toBe(23);
	expect(tracker.moving(1010)).toBe(false);
});

test("time running backwards snaps instead of replaying a tween", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(3, 23, 5000, true);
	expect(tracker.sample(1, 70, 100, true)).toBe(70);
	expect(tracker.moving(100)).toBe(false);
});

test("the Studio never wraps a card to a new row mid-tween", () => {
	const names = ["ada", "smith", "gate", "iris"];
	const draw = (
		count: number,
		at: number,
		columns: number,
		tracker: ReturnType<typeof createCardWidthTracker>,
	) => {
		const events: BullpenEvent[] = names.slice(0, count).map((who) => ({
			version: 1 as const,
			at: 0,
			kind: "spawn" as const,
			who,
			issues: [1],
			detail: "joined",
		}));
		const view = teamStudioView(
			buildModel(events, at),
			{ filter: "", checkedAt: 0, burndown: [] },
			DEFAULT_PROFILE,
			columns,
			40,
			at,
			"live",
			tracker,
		);
		const lines = view.regions.map((l) => l.map((s) => s.text).join(""));
		return lines.filter((l) => l.includes("╭")).length;
	};
	for (const columns of [110, 160]) {
		const across = columns === 110 ? 2 : 3;
		const tracker = createCardWidthTracker();
		let at = 1000;
		for (const sequence of [
			[1, 2, 3, 2, 1],
			[3, 1, 2, 4, 1],
		]) {
			for (const count of sequence) {
				for (let step = 0; step < 8; step++, at += 100)
					expect(draw(count, at, columns, tracker)).toBeLessThanOrEqual(
						Math.ceil(count / across),
					);
			}
		}
	}
});

test("surfaces keep separate trackers and the set stays moving until all settle", () => {
	const set = createCardWidthTrackers();
	set.for("terminal").sample(3, 23, 0, true);
	set.for("desktop").sample(1, 70, 0, true);
	expect(set.for("terminal").sample(1, 70, 1000, true)).toBe(23);
	expect(set.for("desktop").sample(1, 70, 1000, true)).toBe(70);
	expect(set.anyMoving(1000)).toBe(true);
	expect(set.for("terminal").sample(1, 70, 1500, true)).toBe(70);
	expect(set.for("desktop").sample(1, 70, 1500, true)).toBe(70);
	expect(set.anyMoving(1500)).toBe(false);
	set.clear();
	expect(set.anyMoving(1500)).toBe(false);
});

test("moving is time-based: it ends on the real clock without another sample", () => {
	// A surface that detaches, or a pane gone compact or empty, never samples again.
	const set = createCardWidthTrackers();
	set.for("desktop").sample(3, 23, 0, true);
	set.for("desktop").sample(1, 70, 1000, true);
	expect(set.anyMoving(1000)).toBe(true);
	expect(set.anyMoving(1000 + TWEEN_MS - 1)).toBe(true);
	expect(set.anyMoving(1000 + TWEEN_MS)).toBe(false);
});

test("a replay whose scene time stops still settles, because the tween follows the real clock", () => {
	// The pane passes the real clock to sample(); the scene's clamped time never reaches it.
	const tracker = createCardWidthTracker();
	tracker.sample(3, 23, 5000, true);
	expect(tracker.sample(1, 70, 6000, true)).toBe(23);
	expect(tracker.moving(6100)).toBe(true);
	expect(tracker.sample(1, 70, 6000 + TWEEN_MS, true)).toBe(70);
	expect(tracker.moving(6000 + TWEEN_MS)).toBe(false);
});
