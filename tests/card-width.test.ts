import { expect, test } from "claude-code/testing";
import {
	cardsPerRow,
	createCardWidthTracker,
	MAX_CARD_WIDTH,
	packRows,
	settledCardWidth,
	TWEEN_MS,
} from "../src/render/card-width";

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
	expect(settledCardWidth(LEFT_110, 1)).toBe(MAX_CARD_WIDTH);
	expect(settledCardWidth(LEFT_110, 2)).toBe(35);
	expect(settledCardWidth(LEFT_160, 1)).toBe(MAX_CARD_WIDTH);
	expect(settledCardWidth(LEFT_160, 2)).toBe(52);
	expect(settledCardWidth(LEFT_160, 3)).toBe(34);
	for (const left of [LEFT_110, LEFT_160, 300])
		for (const n of [1, 2, 3])
			expect(settledCardWidth(left, n)).toBeLessThanOrEqual(MAX_CARD_WIDTH);
});

test("packRows places equal cards at rest and squeezes or wraps mid-tween", () => {
	expect(packRows(3, 3, 34, LEFT_160)).toEqual([[34, 34, 34]]);
	expect(packRows(5, 3, 34, LEFT_160)).toEqual([
		[34, 34, 34],
		[34, 34],
	]);
	// A card beside a still-wide neighbour takes what is left.
	expect(packRows(2, 2, 54, LEFT_110)).toEqual([[54, 16]]);
	expect(packRows(2, 2, 58, LEFT_110)).toEqual([[58], [58]]);
	expect(packRows(2, 2, 70, LEFT_110)).toEqual([[70], [70]]);
	expect(packRows(0, 3, 34, LEFT_160)).toEqual([]);
	// Always terminates and places every card.
	for (let w = 12; w <= 70; w++)
		expect(packRows(7, 3, w, LEFT_160).flat().length).toBe(7);
});

test("the first draw and a pure resize snap", () => {
	const tracker = createCardWidthTracker();
	expect(tracker.sample(1, 70, 1000, true)).toBe(70);
	expect(tracker.moving()).toBe(false);
	expect(tracker.sample(1, 60, 1100, true)).toBe(60);
	expect(tracker.moving()).toBe(false);
});

test("a change in cards per row tweens with an eased, monotonic, settling width", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(1, 70, 1000, true);
	expect(tracker.sample(2, 35, 2000, true)).toBe(70);
	expect(tracker.moving()).toBe(true);
	const samples: number[] = [];
	for (let t = 2000; t <= 2000 + TWEEN_MS; t += 100)
		samples.push(tracker.sample(2, 35, t, true));
	expect(samples[0]).toBe(70);
	expect(samples.at(-1)).toBe(35);
	for (const [i, w] of samples.entries())
		expect(w).toBeLessThanOrEqual(samples[i - 1] ?? 70);
	expect(samples.every((w) => w >= 35 && w <= 70)).toBe(true);
	// Eased: starts slowly, so the first step is smaller than the middle.
	expect((samples[0] ?? 0) - (samples[1] ?? 0)).toBeLessThan(
		(samples[1] ?? 0) - (samples[2] ?? 0),
	);
	expect(tracker.moving()).toBe(false);
	expect(tracker.sample(2, 35, 9000, true)).toBe(35);
});

test("a retarget mid-tween starts from the width on screen", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(1, 70, 0, true);
	tracker.sample(2, 35, 1000, true);
	const mid = tracker.sample(2, 35, 1200, true);
	expect(mid).toBeLessThan(70);
	expect(mid).toBeGreaterThan(35);
	expect(tracker.sample(1, 70, 1200, true)).toBe(mid);
});

test("animations off snaps every change", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(1, 70, 0, false);
	expect(tracker.sample(2, 35, 1000, false)).toBe(35);
	expect(tracker.moving()).toBe(false);
	expect(tracker.sample(3, 23, 1010, false)).toBe(23);
	expect(tracker.moving()).toBe(false);
});

test("time running backwards snaps instead of replaying a tween", () => {
	const tracker = createCardWidthTracker();
	tracker.sample(1, 70, 5000, true);
	expect(tracker.sample(2, 35, 100, true)).toBe(35);
	expect(tracker.moving()).toBe(false);
});
