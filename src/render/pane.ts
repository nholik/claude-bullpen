import type { GithubSource, Member, Profile } from "../../types";
import { floorRows } from "../floor";
import type { BullpenModel } from "../model";
import { DEFAULT_PROFILE } from "../profile";
import type { CardWidthTracker } from "./card-width";
import { band, footer, header } from "./header";
import { beside, glyphLines, type Line, textLine } from "./lines";
import { needsSection } from "./needs";
import { hallway, huddles } from "./regions";
import { shippingSection } from "./shipping";
import { teamStudioView } from "./team-studio";

export type Focus = "shipping" | "talk" | "needs";

/**
 * The key hints. `n` shows only while a decision waits on the person or the
 * needs-you view is open; in it the list's own keys lead.
 */
export function keys(focus: Focus | undefined, waiting: number): string {
	if (focus === "needs")
		return "j/k: move · enter: reply or copy PR link · d: dismiss · n: back";
	const needs = waiting > 0 ? `n: needs you (${waiting}) · ` : "";
	return `${needs}s: ${focus === "shipping" ? "back" : "shipping"} · t: ${focus === "talk" ? "back" : "messages"}`;
}
export type PaneView = {
	header: Line[];
	floorRows: number;
	floorColumns: number;
	sidebar: Line[];
	regions: Line[];
	footer: Line[];
	band: Line;
};
export type PaneOptions = {
	github?: GithubSource;
	profile?: Profile;
	focus?: Focus;
	/** The needs-you view's selected row. */
	cursor?: number;
	seenAt?: number;
	/** False when this surface cannot draw a Raster. */
	raster?: boolean;
	mode?: "live" | "demo" | "replay";
	/** Keeps card widths between draws so a resize can tween. */
	cardWidths?: CardWidthTracker;
	/** The real clock, for the card tween; `now` may be replayed. */
	wallNow?: number;
};
export function paneView(
	model: BullpenModel,
	members: Member[],
	columns: number,
	rows: number,
	now: number,
	options: PaneOptions = {},
): PaneView {
	model = {
		...model,
		teammates: Object.fromEntries(
			Object.entries(model.teammates).map(([name, t]) => [
				name,
				{
					...t,
					agentId: (
						members.find((m) => m.name === name)?.id ?? t.agentId
					)?.startsWith("demo-")
						? undefined
						: (members.find((m) => m.name === name)?.id ?? t.agentId),
				},
			]),
		),
	};
	const github = options.github ?? { filter: "", burndown: [], checkedAt: 0 };
	const profile = options.profile ?? DEFAULT_PROFILE;
	const hints = keys(
		options.focus,
		model.decisions.length + (github.ready?.length ?? 0),
	);
	if (columns >= 60 && rows >= 16) {
		const view = teamStudioView(
			model,
			github,
			profile,
			columns,
			rows - 3,
			now,
			options.mode,
			options.cardWidths,
			options.wallNow,
			options.focus,
			options.cursor,
		);
		return {
			header: view.header,
			floorRows: 0,
			floorColumns: columns,
			sidebar: [],
			regions: view.regions,
			footer: glyphLines(
				[...footer(github, columns, options.mode), textLine(hints, columns)],
				profile.glyphs,
			),
			band: band(model, github, profile, columns, options.seenAt ?? -1),
		};
	}
	const heading = header(model, github, columns, now).slice(
		0,
		Math.max(0, rows - 3),
	);
	const bottom = [
		...footer(github, columns, options.mode),
		textLine(hints, columns),
	].slice(0, Math.max(0, rows - heading.length - 1));
	const available = Math.max(0, rows - heading.length - bottom.length - 1);
	const studio =
		columns >= 110 &&
		rows >= 28 &&
		!options.focus &&
		options.raster !== false &&
		profile.glyphs !== "ascii";
	const floorColumns = studio ? Math.floor((columns - 3) * 0.64) : columns;
	const floorHeight =
		options.raster === false || options.focus
			? 0
			: profile.glyphs === "ascii"
				? Math.min(1, available)
				: studio
					? Math.max(0, available - 6)
					: Math.min(available, floorRows(columns), Math.max(1, available - 7));
	const room = Math.max(0, available - floorHeight);
	const sidebar = studio
		? huddles(
				model,
				github,
				profile,
				columns - floorColumns - 3,
				floorHeight,
				now,
			)
		: [];
	let regions: Line[] = [];
	if (studio) regions = hallway(model, profile, columns, room, now);
	else if (options.focus === "shipping")
		regions = shippingSection(model, github, profile, columns, room, now);
	else if (options.focus === "needs")
		regions = needsSection(
			model.decisions,
			columns,
			now,
			options.cursor ?? 0,
			room,
			github.ready,
		);
	else if (options.focus === "talk")
		regions = hallway(model, profile, columns, room, now);
	else {
		if (columns >= 60) {
			const left = Math.floor((columns - 3) * 0.6);
			regions = beside(
				huddles(model, github, profile, left, room, now),
				hallway(model, profile, columns - left - 3, room, now),
				columns,
			);
		} else {
			const talkRoom = Math.min(4, Math.max(1, Math.floor(room / 3)));
			regions = [
				...huddles(model, github, profile, columns, room - talkRoom, now),
				...hallway(model, profile, columns, talkRoom, now),
			];
		}
	}
	return {
		header: glyphLines(heading, profile.glyphs),
		floorRows: Math.max(0, floorHeight),
		floorColumns,
		sidebar: glyphLines(sidebar, profile.glyphs),
		regions: glyphLines(regions.slice(0, room), profile.glyphs),
		footer: glyphLines(bottom, profile.glyphs),
		band: band(model, github, profile, columns, options.seenAt ?? -1),
	};
}
