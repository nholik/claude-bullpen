import { type GlyphMode, glyphText } from "./glyphs";
// The floorplan: a half-block pixel canvas packed into Raster cells.
// Each terminal cell is two pixels stacked: '▀' with the top pixel as
// foreground and the bottom pixel as background. Only width-1 glyphs are
// used so it draws the same in GNOME Terminal (VTE) and Windows Terminal.

import type { Member } from "../types";
import { mix, moraleLight } from "./color";
import { oneLine } from "./events";
import type { BullpenModel } from "./model";
import { issueStatus, STUDIO } from "./render/studio";
import stringWidth from "./vendor/string-width.js";

export { PALETTE } from "./palette";

import type { Profile } from "../types";
import { colorFor, DEFAULT_PROFILE } from "./profile";

const UPPER_HALF = 0x2580;
const FLOOR = STUDIO.background;
const TABLE = 0x263b49;
const TABLE_EDGE = STUDIO.edge;
const LOBBY = STUDIO.panel;

type Pixels = { width: number; height: number; px: Uint32Array };

function canvas(width: number, height: number, morale = 0.7): Pixels {
	const light = moraleLight(morale);
	const px = new Uint32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const isWall = y === 0 || y === height - 1 || x === 0 || x === width - 1;
			px[y * width + x] = isWall
				? light.wall
				: (x >> 2) % 2 === (y >> 1) % 2
					? light.floor
					: light.alternate;
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
const dim = (color: number) => mix(color, FLOOR, 0.3);

/** A 2x3 pixel person: light head over a body in the member's color. */
function person(
	p: Pixels,
	x: number,
	y: number,
	color: number,
	detailed = false,
	phase = 0,
) {
	if (!detailed) {
		rect(p, x, y, 2, 1, mix(color, WHITE, 0.55));
		rect(p, x, y + 1, 2, 2, color);
		return;
	}
	// Chair, hair, face, shirt, hands and feet: five cells by seven half-cells.
	rect(p, x, y + 3, 5, 3, TABLE_EDGE);
	rect(p, x + 1, y, 3, 1, 0x28313f);
	rect(p, x + 1, y + 1, 3, 2, 0xd7ae91);
	rect(p, x + 3, y + 1, 1, 1, 0x192330);
	rect(p, x + 1, y + 3, 3, 3, color);
	rect(p, x, y + 4 + phase, 1, 1, 0xd7ae91);
	rect(p, x + 4, y + 4, 1, 1, 0xd7ae91);
	rect(p, x + 1, y + 6, 1, 1, 0x8296a8);
	rect(p, x + 3, y + 6, 1, 1, 0x8296a8);
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
	/** Table top-left in cells; width includes room for a short title. */
	tables: Map<number, { col: number; row: number; width: number }>;
	overflow: number[];
	lobbyCol: number;
};

/** Below 48 pane columns the caller only needs a single raster row. */
export const floorRows = (columns: number) => (columns < 48 ? 1 : 13);

/** Spread table groups across both dimensions, reserving a right-hand lobby. */
export function layout(
	columns: number,
	rows: number,
	issues: number[],
): FloorLayout {
	const unique = [...new Set(issues)].sort((a, b) => a - b);
	const tables: FloorLayout["tables"] = new Map();
	const lobbyCol = Math.max(0, columns - 17);
	const across =
		columns < 48
			? 0
			: Math.max(0, Math.floor((lobbyCol - 3) / (rows >= 18 ? 26 : 18)));
	const down = Math.max(0, Math.floor((rows * 2 - 2) / (rows >= 18 ? 28 : 12)));
	const visible = unique.slice(0, across * down);
	const cols = Math.min(across, Math.ceil(visible.length / Math.max(1, down)));
	const bands = cols > 0 ? Math.ceil(visible.length / cols) : 0;
	visible.forEach((issue, i) => {
		const span = (lobbyCol - 3) / cols;
		const bandHeight = (rows * 2 - 2) / bands;
		const width = Math.min(rows >= 18 ? 32 : 26, Math.floor(span) - 6);
		tables.set(issue, {
			col: 2 + Math.floor((i % cols) * span + (span - width) / 2),
			row: Math.floor(
				(1 + Math.floor(i / cols) * bandHeight + (bandHeight - 2) / 2) / 2 -
					(rows >= 18 ? 1 : 0),
			),
			width,
		});
	});
	return {
		columns,
		rows,
		tables,
		overflow: unique.slice(visible.length),
		lobbyCol,
	};
}

type Seat = { col: number; pixel: number };
export type FloorEffects = {
	closed: number[];
	walkers: { id: string; x: number; y: number }[];
	dots: { x: number; y: number; color: number; spark?: boolean }[];
	tables: { issue: number; x: number; y: number; color: number }[];
};

export type FloorFrame = {
	cells: string;
	labels: TextCell[];
	/** Actual rendered seats; overflow members are accounted for separately. */
	seats: Map<string, Seat>;
	overflowMembers: string[];
};

/** Raster text must use one cell per code point, including user-supplied titles. */
function cellText(text: string, width: number): string {
	const safe = Array.from(text.replace(/\s+/g, " "), (ch) =>
		stringWidth(ch) === 1 ? ch : "?",
	).join("");
	return oneLine(safe, Math.max(1, width));
}

function memberColor(m: Member, profile: Profile): number {
	const color = colorFor(m.name, profile, m.color);
	return m.status === "idle" ? dim(color) : color;
}

/** Compact grouped blocks, with overflow kept visible even on tiny terminals. */
function strip(
	members: Member[],
	columns: number,
	rows: number,
	profile: Profile,
): FloorFrame {
	const p = canvas(columns, rows * 2);
	rect(p, 0, 0, columns, rows * 2, FLOOR);
	const labels: TextCell[] = [];
	const seats = new Map<string, Seat>();
	const groups = new Map<number | undefined, Member[]>();
	for (const m of members) {
		const group = groups.get(m.issue) ?? [];
		group.push(m);
		groups.set(m.issue, group);
	}
	// Reserve a marker if necessary; every member is seated or counted in it.
	const required = [...groups].reduce(
		(n, [issue, group]) =>
			n +
			(issue === undefined ? 5 : String(issue).length + 1) +
			1 +
			group.length * 2 +
			2,
		0,
	);
	const reserve =
		required > columns
			? Math.min(columns, `+${members.length} more`.length + 1)
			: 0;
	const limit = columns - reserve;
	let col = 0;
	for (const [issue, group] of groups) {
		const text = issue === undefined ? "lobby" : `#${issue}`;
		if (col + text.length + 3 > limit) break;
		labels.push({ col, row: 0, text, fg: 0xc9bba8, bg: FLOOR });
		col += text.length + 1;
		for (const m of group) {
			if (col + 2 > limit) break;
			labels.push({
				col,
				row: 0,
				text: "█",
				fg: memberColor(m, profile),
				bg: FLOOR,
			});
			seats.set(m.id, { col, pixel: 0 });
			col += 2;
		}
		col += 2;
	}
	const overflowMembers = members
		.filter((m) => !seats.has(m.id))
		.map((m) => m.id);
	if (overflowMembers.length > 0 && columns > 0 && rows > 0) {
		const text = cellText(`+${overflowMembers.length} more`, columns);
		labels.push({
			col: columns - text.length,
			row: 0,
			text,
			fg: WHITE,
			bg: FLOOR,
		});
	}
	return {
		cells: pack(p, labels, profile.glyphs),
		labels,
		seats,
		overflowMembers,
	};
}

/** Idle frames stay identical; running members retain their one-pixel bob. */
export function drawFloor(
	members: Member[],
	columns: number,
	rows: number,
	frame: number,
	titles: Record<number, string> = {},
	profile: Profile = DEFAULT_PROFILE,
	effects: FloorEffects = { closed: [], walkers: [], dots: [], tables: [] },
	morale = 0.7,
	context?: { model: BullpenModel; now: number },
): FloorFrame {
	const active = members
		.filter((m) => m.status !== "gone")
		.map((m) =>
			effects.closed.includes(m.issue ?? -1) ? { ...m, issue: undefined } : m,
		);
	if (columns < 48 || rows < 6 || profile.glyphs === "ascii")
		return strip(active, columns, rows, profile);
	const p = canvas(columns, rows * 2, morale);
	const plan = layout(columns, rows, [
		...active.flatMap((m) => (m.issue === undefined ? [] : [m.issue])),
		...effects.closed,
	]);
	const labels: TextCell[] = [];
	const seats = new Map<string, Seat>();
	const detailed = rows >= 18;
	const operations = profile.style === "operations";
	const overflowMembers: string[] = [];
	const label = (
		col: number,
		row: number,
		text: string,
		fg = 0xfff3e0,
		bg = FLOOR,
	) => labels.push({ col, row, text, fg, bg });
	// A quiet studio: dotted circulation lane, lobby bench, and plant.
	for (let x = 3; x < plan.lobbyCol - 1; x += 4)
		rect(p, x, rows * 2 - 3, 1, 1, TABLE_EDGE);
	label(2, 0, operations ? " TOPOLOGY" : " FLOOR", STUDIO.muted);
	// Quiet lobby with a bottom door gap.
	rect(p, plan.lobbyCol, 1, columns - plan.lobbyCol - 1, rows * 2 - 2, LOBBY);
	rect(p, plan.lobbyCol + 5, rows * 2 - 1, 6, 1, LOBBY);
	label(
		plan.lobbyCol + 2,
		0,
		operations ? "UNASSIGNED" : "LOUNGE",
		STUDIO.muted,
		LOBBY,
	);
	if (rows >= 10 && !operations) {
		rect(p, plan.lobbyCol + 2, rows * 2 - 8, 11, 1, TABLE_EDGE);
		rect(p, plan.lobbyCol + 2, rows * 2 - 7, 11, 3, 0x29404e);
		rect(p, plan.lobbyCol + 3, rows * 2 - 4, 1, 1, TABLE_EDGE);
		rect(p, plan.lobbyCol + 11, rows * 2 - 4, 1, 1, TABLE_EDGE);
		label(plan.lobbyCol + 3, rows - 3, "take five", STUDIO.muted, 0x29404e);
	}
	for (const [issue, at] of plan.tables) {
		if (effects.closed.includes(issue)) continue;
		const state = context
			? issueStatus(context.model, issue, profile, context.now)
			: undefined;
		rect(
			p,
			at.col - 1,
			at.row * 2 - 1,
			at.width + 2,
			detailed ? 7 : 5,
			0x0c131c,
		);
		rect(p, at.col, at.row * 2, at.width, detailed ? 4 : 2, TABLE);
		rect(
			p,
			at.col,
			at.row * 2 + (detailed ? 4 : 2),
			at.width,
			1,
			state?.color ?? TABLE_EDGE,
		);
		if (detailed && !operations) {
			rect(p, at.col + 1, at.row * 2 + 5, 1, 2, TABLE_EDGE);
			rect(p, at.col + at.width - 2, at.row * 2 + 5, 1, 2, TABLE_EDGE);
		}
		if (detailed && !operations) {
			rect(p, at.col + at.width + 1, at.row * 2 + 1, 2, 1, 0x73a78a);
			rect(p, at.col + at.width + 2, at.row * 2, 1, 3, 0x73a78a);
			rect(p, at.col + at.width + 1, at.row * 2 + 3, 2, 1, TABLE_EDGE);
		}
		const title = titles[issue];
		label(
			at.col + 1,
			at.row,
			cellText(`#${issue}${title ? ` ${title}` : ""}`, at.width - 2),
			STUDIO.text,
			TABLE,
		);
		const group = active.filter((m) => m.issue === issue);
		group.forEach((m, i) => {
			if (i >= 6) {
				overflowMembers.push(m.id);
				return;
			}
			const slot = detailed ? Math.floor(i / 2) : i % 3;
			const col =
				at.col +
				Math.floor(
					((slot + 1) * at.width) /
						(detailed ? Math.ceil(Math.min(6, group.length) / 2) + 1 : 4),
				) -
				(detailed ? 2 : 1);
			const upper = detailed ? i % 2 === 0 : i < 3;
			const pixel = at.row * 2 + (detailed ? (upper ? -7 : 7) : upper ? -3 : 4);
			seats.set(m.id, { col, pixel });
			if (detailed) {
				label(
					col,
					at.row + (upper ? -5 : 7),
					cellText(
						m.name,
						Math.max(
							1,
							Math.floor(
								at.width / (Math.ceil(Math.min(6, group.length) / 2) + 1),
							) - 1,
						),
					),
					memberColor(m, profile),
				);
				// Each place has a small laptop on the desk.
				if (!operations)
					rect(p, col + 1, at.row * 2 + (upper ? -1 : 4), 3, 1, STUDIO.muted);
			}
		});
		if (detailed) {
			const message = context?.model.hallway.findLast(
				(m) =>
					group.some((member) => member.name === m.from) &&
					context.now - m.at >= 0 &&
					context.now - m.at < 12_000,
			);
			label(
				at.col + 1,
				at.row + 1,
				cellText(
					message
						? `> ${message.text}`
						: `${state?.label ?? "HUDDLE"} · ${group.length} teammate${group.length === 1 ? "" : "s"}`,
					at.width - 2,
				),
				message ? STUDIO.text : (state?.color ?? STUDIO.muted),
				TABLE,
			);
		}
		if (group.length > 6)
			label(
				at.col + at.width - 6,
				at.row + 1,
				`+${group.length - 6}`,
				0xc9bba8,
			);
	}
	let lobbyIndex = 0;
	const lobbyCapacity =
		(detailed ? 2 : 4) *
		Math.max(
			0,
			Math.floor((rows * 2 - (detailed ? 12 : 4)) / (detailed ? 9 : 4)),
		);
	for (const m of active) {
		if (m.issue !== undefined) {
			if (!plan.tables.has(m.issue)) overflowMembers.push(m.id);
			continue;
		}
		if (lobbyIndex >= lobbyCapacity) {
			overflowMembers.push(m.id);
			continue;
		}
		seats.set(m.id, {
			col:
				plan.lobbyCol +
				2 +
				(lobbyIndex % (detailed ? 2 : 4)) * (detailed ? 6 : 3),
			pixel:
				(detailed ? 5 : 3) +
				Math.floor(lobbyIndex / (detailed ? 2 : 4)) * (detailed ? 9 : 4),
		});
		lobbyIndex++;
	}
	for (const m of active) {
		const seat = seats.get(m.id);
		if (!seat) continue;
		if (detailed && m.issue === undefined)
			label(
				seat.col,
				Math.floor(seat.pixel / 2) - 1,
				cellText(m.name, 5),
				memberColor(m, profile),
				LOBBY,
			);
		const bob = m.status === "running" && (frame + m.color) % 4 < 2 ? 1 : 0;
		const moving = effects.walkers.find((w) => w.id === m.id);
		if (operations) {
			const x = Math.round(moving?.x ?? seat.col);
			const y = Math.round(moving?.y ?? seat.pixel);
			const size = detailed ? 5 : 2;
			if (detailed && !moving && m.issue !== undefined) {
				const hub = plan.tables.get(m.issue);
				if (hub)
					for (
						let y0 = Math.min(y + 2, hub.row * 2);
						y0 < Math.max(y + 2, hub.row * 2);
						y0 += 2
					)
						rect(p, x + 2, y0, 1, 1, TABLE_EDGE);
			}
			rect(p, x, y, size, detailed ? 5 : 3, TABLE_EDGE);
			rect(
				p,
				x + (detailed ? 1 : 0),
				y + 1,
				detailed ? 3 : 2,
				1,
				memberColor(m, profile),
			);
			if (detailed)
				label(
					x,
					Math.floor(y / 2) + 1,
					m.status === "running" ? " RUN " : " IDLE",
					memberColor(m, profile),
					STUDIO.panel,
				);
		} else
			person(
				p,
				Math.round(moving?.x ?? seat.col),
				Math.round(moving?.y ?? seat.pixel) - (detailed ? 0 : bob),
				memberColor(m, profile),
				detailed,
				bob,
			);
	}
	const overflow = plan.overflow.filter(
		(issue) => !effects.closed.includes(issue),
	);
	if (overflow.length > 0)
		label(2, rows - 1, `+${overflow.length} more issues`);
	const lobbyOverflow =
		active.filter((m) => m.issue === undefined).length - lobbyIndex;
	if (lobbyOverflow > 0)
		label(
			plan.lobbyCol + 1,
			rows - 1,
			cellText(`+${lobbyOverflow} more`, 14),
			0xc9bba8,
			LOBBY,
		);
	for (const table of effects.tables) {
		const x = Math.round(table.x),
			y = Math.round(table.y);
		rect(p, x, y, 10, 2, table.color);
		label(x, Math.floor(y / 2), `#${table.issue}`, 0x122018, table.color);
	}
	for (const dot of effects.dots) {
		rect(
			p,
			Math.round(dot.x),
			Math.round(dot.y),
			dot.spark && !operations ? 3 : 1,
			1,
			dot.color,
		);
		if (dot.spark && !operations)
			rect(p, Math.round(dot.x) + 1, Math.round(dot.y) - 1, 1, 3, dot.color);
	}
	if (effects.closed.length)
		label(
			plan.lobbyCol + 1,
			rows - 1,
			cellText(
				`${operations ? "CLOSED" : "DONE"} ${effects.closed.length}`,
				14,
			),
			0x81c784,
			LOBBY,
		);
	return {
		cells: pack(p, labels, profile.glyphs),
		labels,
		seats,
		overflowMembers,
	};
}

/** Packs pixels (and text overlays) into a Raster's base64 `cells`. */
function pack(
	p: Pixels,
	labels: TextCell[],
	mode: GlyphMode = "unicode",
): string {
	const columns = p.width;
	const rows = p.height / 2;
	const words = new Uint32Array(columns * rows * 3);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const i = (row * columns + col) * 3;
			words[i] = mode === "ascii" ? 32 : UPPER_HALF;
			words[i + 1] = p.px[row * 2 * columns + col] ?? 0;
			words[i + 2] = p.px[(row * 2 + 1) * columns + col] ?? 0;
		}
	}
	for (const label of labels) {
		label.text = glyphText(label.text, mode);
		if (label.row < 0 || label.row >= rows || label.col < 0) continue;
		let k = 0;
		for (const ch of label.text) {
			if (label.col + k >= columns) break;
			const i = (label.row * columns + label.col + k) * 3;
			words[i] = ch.codePointAt(0) ?? 32;
			words[i + 1] = label.fg;
			words[i + 2] = label.bg;
			k++;
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
