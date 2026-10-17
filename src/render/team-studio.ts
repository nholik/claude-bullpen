import type { GithubSource, Profile } from "../../types";
import type { BullpenModel, Teammate } from "../model";
import { colorFor, colorIndex, roleFor } from "../profile";
import { fit, glyphLines, type Line, textLine, width, wrapText } from "./lines";
import { age, align, clock, edge, inside, section, text } from "./operations";
import { STUDIO } from "./studio";

function workstation(
	member: Teammate,
	github: GithubSource,
	profile: Profile,
	columns: number,
	now: number,
): Line[] {
	const color = colorFor(member.name, profile, colorIndex(member.name));
	const role = roleFor(member.name, profile)?.role ?? "teammate";
	const title =
		github.result?.status === "ok"
			? github.result.issues.find((i) => i.number === member.issue)?.title
			: undefined;
	const last = member.trail[member.trail.length - 1];
	const action = wrapText(
		last?.detail ?? "Waiting for activity",
		Math.max(1, columns - 4),
	);
	const name: Line = [
		{ text: member.name, fg: color, agentId: member.agentId, bold: true },
	];
	return [
		edge(columns),
		inside(align(name, text(role, STUDIO.muted), columns - 4), columns),
		inside(
			align(
				text(
					`${member.status === "running" ? "● RUNNING" : member.away ? "○ AWAY" : "○ IDLE"}`,
					color,
				),
				text(age(now, member.lastActiveAt), STUDIO.muted),
				columns - 4,
			),
			columns,
		),
		inside(
			member.issue === undefined
				? text("Unassigned", STUDIO.muted)
				: [
						{
							text: `#${member.issue} ${title ?? ""}`,
							fg: STUDIO.text,
							story: member.issue,
						},
					],
			columns,
		),
		inside(text("─".repeat(Math.max(0, columns - 4)), STUDIO.edge), columns),
		inside(action[0] ?? [], columns),
		inside(action[1] ?? [], columns),
		edge(columns, true),
	];
}

/** A people-first terminal view: measured text and symbols, not an office illustration. */
export function teamStudioView(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): { header: Line[]; regions: Line[] } {
	const team = Object.values(model.teammates)
		.filter((m) => m.status !== "gone")
		.sort(
			(a, b) =>
				(a.issue ?? Infinity) - (b.issue ?? Infinity) ||
				a.name.localeCompare(b.name),
		);
	const header = [
		align(
			text(" BULLPEN / TEAM STUDIO", STUDIO.lavender),
			text(`● LIVE  ${clock(now)} `, STUDIO.mint),
			columns,
		),
		align(
			text(
				` ${github.repo ?? "workspace"} · ${team.length} teammates · ${model.huddles.length} huddles`,
				STUDIO.muted,
			),
			text(`${model.closed.length} shipped this session `, STUDIO.muted),
			columns,
		),
	];
	const room = Math.max(0, rows - header.length);
	const leftWidth = columns >= 120 ? Math.floor((columns - 3) * 0.68) : columns;
	const rightWidth = columns - leftWidth - 3;
	const across = leftWidth >= 105 ? 3 : leftWidth >= 64 ? 2 : 1;
	const cardWidth = Math.max(
		12,
		Math.floor((leftWidth - (across - 1) * 2) / across),
	);
	const capacity = across * Math.max(0, Math.floor((room - 3) / 9));
	const shown = team.slice(0, capacity);
	const left: Line[] = [section("WORKSTATIONS / teammates", leftWidth)];
	for (let index = 0; index < shown.length; index += across) {
		const cards = shown
			.slice(index, index + across)
			.map((member) => workstation(member, github, profile, cardWidth, now));
		for (let row = 0; row < 8; row++) {
			const line: Line = [];
			for (const [i, card] of cards.entries()) {
				if (i) line.push({ text: "  " });
				line.push(...(card[row] ?? []));
			}
			left.push(line);
		}
		left.push([]);
	}
	if (shown.length < team.length)
		left.push(
			textLine(`+${team.length - shown.length} more teammates`, leftWidth),
		);
	if (!team.length)
		left.push(textLine("Waiting for teammates to join.", leftWidth));
	const asks = model.asks.filter((a) => a.open);
	if (columns < 120 && asks[0])
		left.push(
			fit(
				text(`! ${asks[0].from} needs you: ${asks[0].text}`, STUDIO.amber),
				leftWidth,
			),
		);
	if (left.length + 4 < room) {
		left.push(section("HUDDLES / working together", leftWidth));
		for (const huddle of model.huddles.slice(
			0,
			Math.floor((room - left.length - 1) / 2),
		)) {
			const title =
				github.result?.status === "ok"
					? github.result.issues.find((i) => i.number === huddle.issue)?.title
					: undefined;
			left.push(
				fit(
					[
						{
							text: `#${huddle.issue} ${title ?? ""}  `,
							fg: STUDIO.text,
							story: huddle.issue,
						},
						...huddle.members.flatMap((name) => [
							{
								text: `${name} `,
								fg: colorFor(name, profile, colorIndex(name)),
								agentId: model.teammates[name]?.agentId,
							},
						]),
					],
					leftWidth,
				),
			);
			left.push([]);
		}
	}
	const right: Line[] =
		columns >= 120 ? [section("HALLWAY / conversation", rightWidth)] : [];
	if (columns >= 120) {
		const history = model.hallway.slice(
			-Math.max(1, Math.floor((room - 10) / 4)),
		);
		for (const message of history) {
			right.push(
				align(
					text(
						`${message.from} → ${message.to}`,
						colorFor(message.from, profile, colorIndex(message.from)),
					),
					text(clock(message.at).slice(0, 5), STUDIO.muted),
					rightWidth,
				),
			);
			right.push(...wrapText(message.text, rightWidth).slice(0, 2));
			right.push([]);
		}
		if (!history.length)
			right.push(textLine("The hallway is quiet.", rightWidth));
		while (right.length < room - 7) right.push([]);
		right.push(section("NEEDS YOU", rightWidth));
		if (asks[0]) {
			right.push(fit(text(`${asks[0].from} → lead`, STUDIO.amber), rightWidth));
			right.push(
				...wrapText(asks[0].text, rightWidth)
					.slice(0, 3)
					.map((line) => line.map((seg) => ({ ...seg, fg: STUDIO.amber }))),
			);
			right.push(textLine("t · open conversation", rightWidth));
		} else right.push(textLine("✓ No open decisions", rightWidth));
	}
	const regions: Line[] = [];
	for (let row = 0; row < room; row++) {
		const line = fit(left[row] ?? [], leftWidth);
		regions.push(
			columns >= 120
				? [
						...line,
						{
							text: `${" ".repeat(Math.max(0, leftWidth - width(line)))} │ `,
							fg: STUDIO.edge,
						},
						...fit(right[row] ?? [], rightWidth),
					]
				: line,
		);
	}
	return {
		header: glyphLines(header, profile.glyphs),
		regions: glyphLines(regions, profile.glyphs),
	};
}
