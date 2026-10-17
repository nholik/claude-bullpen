import type { Member } from "../../types";
import { PALETTE } from "../floor";
import { type BullpenModel, isHallwayLive } from "../model";
import { beside, fit, type Line, textLine } from "./lines";

export type PaneView = {
	header: Line[];
	floorRows: number;
	regions: Line[];
	footer: Line[];
	band: Line;
};

/** Engine-free baseline composition; each region owns its terminal-cell budget. */
export function paneView(
	model: BullpenModel,
	members: Member[],
	columns: number,
	rows: number,
	now: number,
): PaneView {
	const active = members.filter((m) => m.status !== "gone");
	const header = [
		textLine(
			`Bullpen · ${active.length} on the floor · ${model.morale.glyph}`,
			columns,
		),
	];
	const ask = model.asks.find((a) => a.open);
	if (ask) header.push(textLine(`⚑ ${ask.from}: ${ask.text}`, columns));
	const floorRows = Math.min(
		columns < 110 ? 1 : 6,
		Math.max(0, rows - header.length - 4),
	);
	const room = Math.max(0, rows - header.length - floorRows - 2);
	const huddles = [
		textLine("── Huddles ──", columns),
		...model.huddles.map((h) =>
			fit(
				[
					{ text: `#${h.issue} · ${h.members.length} · ` },
					...h.members.map((name) => ({
						text: `${name} `,
						fg: PALETTE[(model.teammates[name]?.color ?? 0) % PALETTE.length],
					})),
				],
				columns,
			),
		),
	];
	if (huddles.length === 1)
		huddles.push(textLine("No active huddles", columns));
	const live = isHallwayLive(model.hallway, now);
	const hallway = [
		textLine(`── Hallway · ${live ? "live" : "quiet"} ──`, columns),
	];
	if (live)
		for (const m of model.hallway.slice(-Math.max(0, room - 1)))
			hallway.push(textLine(`${m.from} → ${m.to}: ${m.text}`, columns));
	const regions = (
		columns >= 110
			? beside(huddles, hallway, columns)
			: [...huddles, ...hallway]
	).slice(0, room);
	return {
		header,
		floorRows,
		regions,
		footer: [textLine("burndown · no GitHub data", columns)],
		band: textLine(
			`☰ bullpen ${model.morale.glyph} · ${active.length} teammates · ✉${model.hallway.length}`,
			columns,
		),
	};
}
