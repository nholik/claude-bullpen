import type { BullpenEvent, GithubSource, Profile } from "../../types";
import { nextIssue } from "../events";
import { isKickback, isReviewer } from "../model/detect";
import { colorFor, colorIndex, roleFor } from "../profile";
import { fit, glyphLines, type Line, textLine, wrapText } from "./lines";

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
function storyLinesImpl(
	story: Story,
	profile: Profile,
	columns: number,
	rows: number,
): Line[] {
	const lines = [
		...wrapText(
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
	const groups: Line[][] = [];
	// At most one viewport of events can be shown, even before wrapping.
	const shown = room > 0 ? story.events.slice(-room) : [];
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
			const prefix = `${clock} ${e.who} `;
			const wrapped = wrapText(
				`${prefix}${kind}${e.kind === "message" ? ` → ${e.target}` : ""}: ${e.detail}`,
				columns,
			);
			groups.push(
				wrapped.map((line, index) =>
					index === 0
						? [
								{
									...line[0],
									text: line[0]?.text ?? "",
									fg: colorFor(e.who, profile, colorIndex(e.who)),
								},
							]
						: line,
				),
			);
		}
	// Reserve a marker only when the complete story actually overflows.
	if (
		groups.length === story.events.length &&
		groups.reduce((total, group) => total + group.length, 0) <= room
	) {
		lines.push(...groups.flat());
		return lines.slice(0, Math.max(0, rows));
	}
	const eventRoom = Math.max(0, room - (story.events.length > 1 ? 1 : 0));
	const selected: Line[][] = [];
	let used = 0;
	for (let i = groups.length - 1; i >= 0; i--) {
		const group = groups[i] ?? [];
		if (used + group.length > eventRoom) {
			if (selected.length === 0 && eventRoom > 0) {
				selected.unshift([
					...group.slice(0, eventRoom - 1),
					textLine("... more lines", columns),
				]);
			}
			break;
		}
		selected.unshift(group);
		used += group.length;
	}
	const hidden = story.events.length - selected.length;
	if (hidden > 0 && room > 0)
		lines.push(textLine(`... ${hidden} earlier events`, columns));
	lines.push(...selected.flat());
	return lines.slice(0, Math.max(0, rows));
}

export function storyLines(...args: Parameters<typeof storyLinesImpl>): Line[] {
	return glyphLines(storyLinesImpl(...args), args[1].glyphs);
}
