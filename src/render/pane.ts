import type { GithubSource, Member, Profile } from "../../types";
import { floorRows } from "../floor";
import type { BullpenModel } from "../model";
import { DEFAULT_PROFILE } from "../profile";
import type { CardWidthTracker } from "./card-width";
import { band, footer, header } from "./header";
import { beside, glyphLines, type Line, textLine } from "./lines";
import { hallway, huddles } from "./regions";
import { shippingSection } from "./shipping";
import { teamStudioView } from "./team-studio";

export type Focus = "floor" | "huddles" | "shipping" | "talk";
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
	if (
		options.focus !== "huddles" &&
		options.focus !== "shipping" &&
		options.focus !== "talk" &&
		columns >= 60 &&
		rows >= 16
	) {
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
		);
		return {
			header: view.header,
			floorRows: 0,
			floorColumns: columns,
			sidebar: [],
			regions: view.regions,
			footer: glyphLines(
				[
					...footer(github, columns, options.mode),
					textLine("a: answer · s: shipping · t: talk (toggle)", columns),
				],
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
		textLine("a: answer · s: shipping · t: talk (toggle)", columns),
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
		options.raster === false ||
		options.focus === "huddles" ||
		options.focus === "shipping" ||
		options.focus === "talk"
			? 0
			: profile.glyphs === "ascii"
				? Math.min(1, available)
				: options.focus === "floor"
					? available
					: studio
						? Math.max(0, available - 6)
						: Math.min(
								available,
								floorRows(columns),
								Math.max(1, available - 7),
							);
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
	else if (options.focus === "huddles")
		regions = huddles(model, github, profile, columns, room, now);
	else if (options.focus === "talk")
		regions = hallway(model, profile, columns, room, now);
	else if (options.focus !== "floor" || options.raster === false) {
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
