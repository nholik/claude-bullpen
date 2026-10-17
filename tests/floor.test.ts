import { expect, test } from "claude-code/testing";
import { drawFloor, floorRows, layout } from "../src/floor";
import type { Member } from "../types";

function team(count: number, perIssue = 6): Member[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `m${i}`,
		name: `m${i}`,
		color: i,
		issue: Math.floor(i / perIssue) + 1,
		status: "idle",
		lastActiveAt: 0,
	}));
}

test("tables use both dimensions, wrap and never overlap", async () => {
	for (const columns of [110, 160, 240]) {
		for (const rows of [10, 13, 20, 30]) {
			const issues = Array.from({ length: 30 }, (_, i) => i + 1);
			const plan = layout(columns, rows, issues);
			expect(plan.tables.size + plan.overflow.length).toBe(issues.length);
			const tables = [...plan.tables.values()];
			for (const [i, a] of tables.entries()) {
				expect(a.col).toBeGreaterThan(0);
				expect(a.col + a.width).toBeLessThan(plan.lobbyCol);
				expect(a.row * 2 - 4).toBeGreaterThan(0);
				expect(a.row * 2 + 6).toBeLessThan(rows * 2 - 1);
				for (const b of tables.slice(i + 1)) {
					const separated =
						a.col + a.width <= b.col ||
						b.col + b.width <= a.col ||
						Math.abs(a.row - b.row) >= 6;
					expect(separated).toBe(true);
				}
			}
		}
	}
	expect(
		new Set(
			[...layout(110, 13, [1, 2, 3, 4, 5, 6]).tables.values()].map(
				(t) => t.row,
			),
		).size,
	).toBe(2);
	expect(
		layout(
			110,
			25,
			Array.from({ length: 20 }, (_, i) => i),
		).tables.size,
	).toBeGreaterThan(
		layout(
			110,
			10,
			Array.from({ length: 20 }, (_, i) => i),
		).tables.size,
	);
});

test("six members per table and lobby members all have distinct in-bounds seats", async () => {
	const members = [
		...team(36),
		...team(8).map((m) => ({ ...m, id: `lobby-${m.id}`, issue: undefined })),
	];
	for (const columns of [110, 160]) {
		const result = drawFloor(members, columns, 13, 0);
		expect(result.seats.size).toBe(members.length);
		expect(result.overflowMembers).toEqual([]);
		const pixels = new Set<string>();
		for (const seat of result.seats.values()) {
			for (let x = seat.col; x < seat.col + 2; x++) {
				// Include the entire running bob envelope.
				for (let y = seat.pixel - 1; y < seat.pixel + 3; y++) {
					expect(x).toBeGreaterThan(0);
					expect(x).toBeLessThan(columns - 1);
					expect(y).toBeGreaterThan(0);
					expect(y).toBeLessThan(25);
					const key = `${x},${y}`;
					expect(pixels.has(key)).toBe(false);
					pixels.add(key);
				}
			}
		}
	}
});

test("overflow issues and teammates are counted instead of silently dropped", async () => {
	const members = team(60, 1);
	const result = drawFloor(members, 110, 13, 0);
	const plan = layout(
		110,
		13,
		members.flatMap((m) => m.issue ?? []),
	);
	expect(result.labels.map((l) => l.text)).toContain(
		`+${plan.overflow.length} more issues`,
	);
	expect(result.seats.size + result.overflowMembers.length).toBe(
		members.length,
	);
	const crowded = drawFloor(team(10, 10), 110, 13, 0);
	expect(crowded.seats.size).toBe(6);
	expect(crowded.overflowMembers.length).toBe(4);
	expect(crowded.labels.map((l) => l.text)).toContain("+4");
	const lobby = drawFloor(
		team(40).map((m) => ({ ...m, issue: undefined })),
		110,
		13,
		0,
	);
	expect(lobby.seats.size + lobby.overflowMembers.length).toBe(40);
	expect(lobby.labels.some((l) => l.text.endsWith("more"))).toBe(true);
});

test("narrow floors use one row with grouped blocks and explicit overflow", async () => {
	expect(floorRows(80)).toBe(1);
	for (const columns of [1, 8, 20, 80, 109]) {
		const members = team(40);
		const result = drawFloor(members, columns, 1, 0);
		expect(result.cells.length).toBe(columns * 16);
		expect(
			result.labels.every(
				(l) => l.row === 0 && l.col >= 0 && l.col + l.text.length <= columns,
			),
		).toBe(true);
		expect(result.seats.size + result.overflowMembers.length).toBe(
			members.length,
		);
	}
	const result = drawFloor(team(3), 80, 1, 0);
	expect(result.labels.map((l) => l.text)).toContain("#1");
	expect(result.seats.size).toBe(3);
});

test("gone members have no tables; titles use single-cell characters; idle frames stay fixed", async () => {
	const members = [
		...team(6),
		{
			...team(1)[0],
			id: "gone",
			name: "gone",
			status: "gone",
			color: 0,
			lastActiveAt: 0,
			issue: 999,
		} satisfies Member,
	];
	const a = drawFloor(members, 110, 13, 0, { 1: "Auth 界\n😀" });
	const b = drawFloor(members, 110, 13, 3, { 1: "Auth 界\n😀" });
	expect(a.cells).toBe(b.cells);
	expect(a.labels.some((l) => l.text.includes("999"))).toBe(false);
	expect(
		a.labels.some((l) => l.text.includes("界") || l.text.includes("😀")),
	).toBe(false);
	expect(
		drawFloor(
			team(6).map((m) => ({ ...m, status: "running" })),
			110,
			13,
			0,
		).cells ===
			drawFloor(
				team(6).map((m) => ({ ...m, status: "running" })),
				110,
				13,
				3,
			).cells,
	).toBe(false);
});
