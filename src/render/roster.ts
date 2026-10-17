import type { BullpenEvent, Member, Profile } from "../../types";
import { colorFor } from "../profile";
import { fit, type Line, textLine } from "./lines";

export function roster(
	list: Member[],
	events: BullpenEvent[],
	profile: Profile,
	columns: number,
	rows: number,
): Line[] {
	const lines: Line[] = list
		.filter((m) => m.status !== "gone")
		.map((m) =>
			fit(
				[
					{
						text: `${m.status === "running" ? "●" : "○"} ${m.name}`,
						fg: colorFor(m.name, profile, m.color),
					},
					{
						text: ` ${m.issue === undefined ? "no issue yet" : `#${m.issue}`}`,
						dim: true,
					},
				],
				columns,
			),
		);
	lines.push(textLine("── recent ──", columns));
	const room = Math.max(0, rows - lines.length);
	if (events.length === 0)
		lines.push(
			textLine(
				"Nothing yet. Spawn a teammate to see the floor come alive.",
				columns,
			),
		);
	else if (room > 0)
		for (const event of events.slice(-room))
			lines.push(
				textLine(
					`${event.who}${event.kind === "message" ? ` → ${event.target}` : ""}: ${event.detail}`,
					columns,
				),
			);
	return lines.slice(0, rows);
}
