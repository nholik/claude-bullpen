import { expect, test } from "claude-code/testing";
import type { Line } from "../src/render/lines";
import { atTail, reanchor, rowStarts } from "../src/scroll";

test("a window shows the tail when it reaches the last row or the tree fits", () => {
	expect(atTail(0, 10, 8)).toBe(true);
	expect(atTail(0, 10, 10)).toBe(true);
	expect(atTail(30, 10, 40)).toBe(true);
	expect(atTail(29, 10, 40)).toBe(false);
	expect(atTail(0, 10, 100)).toBe(false);
});

const keys = (rows: [string, number][]) =>
	rows.map(([key, row]) => ({ key, row }));

test("a window scrolled up stays on its message when the hallway drops the oldest", () => {
	const before = keys([
		["a", 2],
		["b", 6],
		["c", 12],
		["d", 16],
	]);
	const after = keys([
		["b", 2],
		["c", 8],
		["d", 12],
		["e", 16],
	]);
	// Top row 13 was in "c"; "c" now starts at row 8.
	expect(reanchor(before, after, 13, 5, 40)).toBe("c");
	// Nothing moved: no scroll.
	expect(reanchor(before, before, 13, 5, 40)).toBeUndefined();
});

test("a dropped anchor falls back to the first kept message", () => {
	const before = keys([
		["a", 2],
		["b", 6],
	]);
	const after = keys([
		["b", 2],
		["c", 8],
	]);
	expect(reanchor(before, after, 3, 5, 40)).toBe("b");
});

test("a window following the tail is left to the engine", () => {
	const before = keys([
		["a", 2],
		["b", 6],
	]);
	const after = keys([
		["b", 2],
		["c", 8],
	]);
	expect(reanchor(before, after, 35, 5, 40)).toBeUndefined();
});

test("keyed rows are found by their first segment", () => {
	const lines: Line[] = [
		[{ text: "x" }],
		[{ text: "h", key: "k1" }],
		[],
		[{ text: "h", key: "k2" }],
	];
	expect(rowStarts(lines, 4)).toEqual(
		keys([
			["k1", 5],
			["k2", 7],
		]),
	);
});
