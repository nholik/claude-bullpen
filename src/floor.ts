// The floorplan: a half-block pixel canvas packed into Raster cells.
// Each terminal cell is two pixels stacked: '▀' with the top pixel as
// foreground and the bottom pixel as background. Only width-1 glyphs are
// used so it draws the same in GNOME Terminal (VTE) and Windows Terminal.

import type { Member } from "../types";
import { mix } from "./color";

/** Member colors, 0xRRGGBB, chosen to stay distinct on dark and light themes. */
export const PALETTE = [
	0x4fc3f7, 0xffb74d, 0x81c784, 0xf06292, 0xba68c8, 0xfff176, 0x4db6ac,
	0xe57373,
];

const UPPER_HALF = 0x2580;
const FLOOR = 0x2b2620;
const FLOOR_ALT = 0x2f2a23;
const WALL = 0x5d5346;
const TABLE = 0x8d6e4f;
const TABLE_EDGE = 0x6d543c;
const LOBBY = 0x3a4048;

type Pixels = { width: number; height: number; px: Uint32Array };

function canvas(width: number, height: number): Pixels {
	const px = new Uint32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const isWall = y === 0 || y === height - 1 || x === 0 || x === width - 1;
			px[y * width + x] = isWall
				? WALL
				: (x >> 2) % 2 === (y >> 1) % 2
					? FLOOR
					: FLOOR_ALT;
		}
	}
	return { width, height, px };
}

function rect(
	p: Pixels,
	x0: number,
	y0: number,
	w: number,
	h: number,
	color: number,
) {
	for (let y = Math.max(0, y0); y < Math.min(p.height, y0 + h); y++) {
		for (let x = Math.max(0, x0); x < Math.min(p.width, x0 + w); x++) {
			p.px[y * p.width + x] = color;
		}
	}
}

const WHITE = 0xffffff;

/** Halfway toward the floor color: how an idle member is drawn. */
const dim = (color: number) => mix(color, FLOOR, 0.5);

/** A 2x3 pixel person: light head over a body in the member's color. */
function person(p: Pixels, x: number, y: number, color: number) {
	rect(p, x, y, 2, 1, mix(color, WHITE, 0.55));
	rect(p, x, y + 1, 2, 2, color);
}

export type TextCell = {
	col: number;
	row: number;
	text: string;
	fg: number;
	bg: number;
};

export type FloorLayout = {
	columns: number;
	rows: number;
	/** Table top-left in cells, keyed by issue number. */
	tables: Map<number, { col: number; row: number }>;
};

const TABLE_COLS = 8;
const TABLE_ROWS = 2;

/** Places one table per issue across the floor, lobby on the right. */
export function layout(
	columns: number,
	rows: number,
	issues: number[],
): FloorLayout {
	const tables = new Map<number, { col: number; row: number }>();
	const usable = Math.max(TABLE_COLS + 2, columns - 12);
	const perRow = Math.max(1, Math.floor(usable / (TABLE_COLS + 4)));
	issues
		.slice(0, perRow * Math.max(1, Math.floor((rows - 1) / 4)))
		.forEach((issue, i) => {
			tables.set(issue, {
				col: 2 + (i % perRow) * (TABLE_COLS + 4),
				row: 1 + Math.floor(i / perRow) * 4,
			});
		});
	return { columns, rows, tables };
}

/**
 * Draws one frame. `frame` advances the idle animation: members whose loop is
 * running bob a pixel, everyone else sits still, so an idle team draws the
 * same cells every frame.
 */
export function drawFloor(
	members: Member[],
	columns: number,
	rows: number,
	frame: number,
): { cells: string; labels: TextCell[] } {
	const p = canvas(columns, rows * 2);
	const issues = [
		...new Set(
			members.map((m) => m.issue).filter((n): n is number => n !== undefined),
		),
	];
	const plan = layout(columns, rows, issues);
	const labels: TextCell[] = [];

	// Lobby for members with no issue yet.
	const lobbyCol = columns - 10;
	rect(p, lobbyCol, 1, 9, rows * 2 - 2, LOBBY);
	labels.push({
		col: lobbyCol + 1,
		row: rows - 1,
		text: "lobby",
		fg: 0x9aa4ae,
		bg: LOBBY,
	});

	for (const [issue, at] of plan.tables) {
		rect(p, at.col, at.row * 2 + 1, TABLE_COLS, TABLE_ROWS * 2 - 1, TABLE);
		rect(p, at.col, at.row * 2 + TABLE_ROWS * 2 - 1, TABLE_COLS, 1, TABLE_EDGE);
		labels.push({
			col: at.col + 1,
			row: at.row,
			text: `#${issue}`.slice(0, TABLE_COLS - 1),
			fg: 0xfff3e0,
			bg: TABLE,
		});
	}

	const seats = new Map<string, number>();
	let lobbyIndex = 0;
	for (const m of members) {
		if (m.status === "gone") continue;
		const color = PALETTE[m.color % PALETTE.length] ?? 0xffffff;
		const bob = m.status === "running" && (frame + m.color) % 4 < 2 ? 1 : 0;
		const table = m.issue === undefined ? undefined : plan.tables.get(m.issue);
		let x: number;
		let y: number;
		if (table) {
			const seat = seats.get(String(m.issue)) ?? 0;
			seats.set(String(m.issue), seat + 1);
			x = table.col + (seat % 3) * 3;
			y = (table.row + TABLE_ROWS) * 2 + (seat >= 3 ? 3 : 0);
		} else {
			x = lobbyCol + 1 + (lobbyIndex % 3) * 3;
			y = 2 + Math.floor(lobbyIndex / 3) * 4;
			lobbyIndex++;
		}
		person(p, x, y - bob, m.status === "idle" ? dim(color) : color);
	}

	return { cells: pack(p, labels), labels };
}

/** Packs pixels (and text overlays) into a Raster's base64 `cells`. */
function pack(p: Pixels, labels: TextCell[]): string {
	const columns = p.width;
	const rows = p.height / 2;
	const words = new Uint32Array(columns * rows * 3);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const i = (row * columns + col) * 3;
			words[i] = UPPER_HALF;
			words[i + 1] = p.px[row * 2 * columns + col] ?? 0;
			words[i + 2] = p.px[(row * 2 + 1) * columns + col] ?? 0;
		}
	}
	for (const label of labels) {
		for (let k = 0; k < label.text.length && label.col + k < columns; k++) {
			const i = (label.row * columns + label.col + k) * 3;
			words[i] = label.text.charCodeAt(k);
			words[i + 1] = label.fg;
			words[i + 2] = label.bg;
		}
	}
	return base64(new Uint8Array(words.buffer));
}

const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard padded base64; written out so it doesn't depend on runtime extras. */
export function base64(bytes: Uint8Array): string {
	const sextet = (n: number, shift: number) =>
		ALPHABET.charAt((n >> shift) & 63);
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const left = bytes.length - i;
		const n =
			((bytes[i] ?? 0) << 16) |
			((bytes[i + 1] ?? 0) << 8) |
			(bytes[i + 2] ?? 0);
		out += sextet(n, 18) + sextet(n, 12);
		out += left > 1 ? sextet(n, 6) : "=";
		out += left > 2 ? sextet(n, 0) : "=";
	}
	return out;
}
