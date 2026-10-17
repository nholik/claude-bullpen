import type { BullpenEvent, GithubSource, Profile } from "../../types";
import { nextIssue } from "../events";
import { isKickback, isReviewer } from "../model/detect";
import { colorFor, colorIndex, roleFor } from "../profile";
import { fit, type Line, textLine } from "./lines";

export type Story = {
	issue: number;
	title?: string;
	state: string;
	events: BullpenEvent[];
};
/** Follow each actor's work attribution, retaining explicit cross-issue mentions. */
export function storyFor(
	issue: number,
	events: readonly BullpenEvent[],
	github: GithubSource,
): Story {
	const assigned = new Map<string, number>();
	const selected: BullpenEvent[] = [];
	for (const event of events) {
		const name =
			event.kind === "spawn" ? (event.target ?? event.who) : event.who;
		const previous = assigned.get(name);
		const current =
			event.kind === "spawn"
				? (previous ?? event.issues[0])
				: event.kind === "leave"
					? previous
					: nextIssue(event.kind, previous, event.issues);
		if (current !== undefined) assigned.set(name, current);
		if (event.issues.includes(issue) || current === issue) selected.push(event);
	}
	const gh =
		github.result?.status === "ok"
			? github.result.issues.find((i) => i.number === issue)
			: undefined;
	return {
		issue,
		title: gh?.title,
		state: gh?.state ?? "GitHub state unavailable",
		events: selected,
	};
}
export function storyLines(
	story: Story,
	profile: Profile,
	columns: number,
	rows: number,
): Line[] {
	const lines = [
		textLine(
			`#${story.issue}${story.title ? ` ${story.title}` : ""} · ${story.state}`,
			columns,
		),
	];
	const ribbon = fit(
		story.events.slice(-columns).map((e) => ({
			text: "█",
			fg: colorFor(e.who, profile, colorIndex(e.who)),
		})),
		columns,
	);
	lines.push(ribbon);
	if (!story.events.length)
		lines.push(textLine("No journal events for this issue yet.", columns));
	const room = Math.max(0, rows - lines.length);
	const count = Math.max(0, room - (story.events.length > room ? 1 : 0));
	const shown = count > 0 ? story.events.slice(-count) : [];
	if (story.events.length > room)
		lines.push(
			textLine(
				`… ${story.events.length - shown.length} earlier events`,
				columns,
			),
		);
	if (room > 0)
		for (const e of shown) {
			const date = new Date(e.at);
			const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
			const kind =
				e.kind === "spawn"
					? "assigned"
					: e.kind === "tool"
						? /\b(edit|write)\b/i.test(e.detail)
							? "edit"
							: "tool"
						: e.kind === "message"
							? isKickback(
									e.detail,
									isReviewer(e.who, roleFor(e.who, profile)?.role),
								)
								? "kickback"
								: /\b(PASS|FAIL|LGTM|approved)\b/i.test(e.detail)
									? "verdict"
									: "message"
							: e.kind;
			lines.push(
				fit(
					[
						{
							text: `${clock} ${e.who} `,
							fg: colorFor(e.who, profile, colorIndex(e.who)),
						},
						{
							text: `${kind}${e.kind === "message" ? ` → ${e.target}` : ""}: ${e.detail}`,
						},
					],
					columns,
				),
			);
		}
	return lines.slice(0, Math.max(0, rows));
}
