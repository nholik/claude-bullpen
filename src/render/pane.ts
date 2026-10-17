import type { GithubSource, Member, Profile } from "../../types";
import { floorRows } from "../floor";
import type { BullpenModel } from "../model";
import { DEFAULT_PROFILE } from "../profile";
import { band, footer, header } from "./header";
import { beside, type Line, textLine } from "./lines";
import { hallway, huddles } from "./regions";

export type Focus = "floor" | "huddles" | "talk";
export type PaneView = {
	header: Line[];
	floorRows: number;
	regions: Line[];
	footer: Line[];
	band: Line;
};
export type PaneOptions = {
	github?: GithubSource;
	profile?: Profile;
	focus?: Focus;
	seenAt?: number;
};
export function paneView(
	model: BullpenModel,
	_members: Member[],
	columns: number,
	rows: number,
	now: number,
	options: PaneOptions = {},
): PaneView {
	const github = options.github ?? { filter: "", burndown: [], checkedAt: 0 };
	const profile = options.profile ?? DEFAULT_PROFILE;
	const heading = header(model, github, columns, now).slice(
		0,
		Math.max(0, rows - 3),
	);
	const bottom = [
		...footer(github, columns),
		textLine("f floor · h huddles · t talk · r restore", columns),
	].slice(0, Math.max(0, rows - heading.length - 1));
	const available = Math.max(0, rows - heading.length - bottom.length - 1);
	const floorHeight =
		options.focus === "huddles" || options.focus === "talk"
			? 0
			: options.focus === "floor"
				? available
				: Math.min(floorRows(columns), Math.max(1, available - 7));
	const room = Math.max(0, available - floorHeight);
	let regions: Line[] = [];
	if (options.focus === "huddles")
		regions = huddles(model, github, profile, columns, room, now);
	else if (options.focus === "talk")
		regions = hallway(model, profile, columns, room, now);
	else if (options.focus !== "floor") {
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
		header: heading,
		floorRows: Math.max(0, floorHeight),
		regions: regions.slice(0, room),
		footer: bottom,
		band: band(model, github, profile, columns, options.seenAt ?? -1),
	};
}
