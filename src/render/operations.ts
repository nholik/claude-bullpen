import type { GithubSource, Profile } from "../../types";
import { headerText } from "../github";
import type { BullpenModel } from "../model";
import { colorFor, colorIndex, roleFor } from "../profile";
import { fit, glyphLines, type Line, textLine, width } from "./lines";
import { issueStatus, STUDIO } from "./studio";

export const text = (value: string, fg = STUDIO.text): Line => [
	{ text: value, fg },
];
export function align(left: Line, right: Line, columns: number): Line {
	const tail = fit(right, Math.max(0, columns - 2));
	const head = fit(left, Math.max(0, columns - width(tail) - 1));
	return [
		...head,
		{ text: " ".repeat(Math.max(0, columns - width(head) - width(tail))) },
		...tail,
	];
}
export function section(title: string, columns: number): Line {
	const label = fit(
		[{ text: `─ ${title} `, fg: STUDIO.muted, bold: true }],
		columns,
	);
	return [
		...label,
		{ text: "─".repeat(Math.max(0, columns - width(label))), fg: STUDIO.edge },
	];
}
export function inside(line: Line, columns: number, color = STUDIO.edge): Line {
	const content = fit(line, Math.max(0, columns - 4));
	return [
		{ text: "│ ", fg: color },
		...content,
		{
			text: `${" ".repeat(Math.max(0, columns - 4 - width(content)))} │`,
			fg: color,
		},
	];
}
export function edge(
	columns: number,
	bottom = false,
	color = STUDIO.edge,
): Line {
	return text(
		`${bottom ? "╰" : "╭"}${"─".repeat(Math.max(0, columns - 2))}${bottom ? "╯" : "╮"}`,
		color,
	);
}
export function age(now: number, at: number): string {
	const seconds = Math.max(0, Math.floor((now - at) / 1000));
	// Minute steps: a ticking seconds counter forces a redraw every second.
	return seconds < 60 ? "<1m ago" : `${Math.floor(seconds / 60)}m ago`;
}
export function clock(at: number): string {
	const date = new Date(at);
	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((n) => String(n).padStart(2, "0"))
		.join(":");
}
function issueCards(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): Line[] {
	const out: Line[] = [section("WORKSTREAMS / live assignment", columns)];
	const capacity = Math.max(0, Math.floor((rows - 2) / 8));
	const groups = model.huddles.slice(0, capacity);
	for (const huddle of groups) {
		const state = issueStatus(model, huddle.issue, profile, now);
		const title =
			github.result?.status === "ok"
				? github.result.issues.find((i) => i.number === huddle.issue)?.title
				: undefined;
		const members = huddle.members.slice(0, columns >= 86 ? 3 : 2);
		const contentWidth = Math.max(0, columns - 4);
		out.push(edge(columns));
		out.push(
			inside(
				align(
					[
						{
							text: `#${huddle.issue} ${title ?? ""}`,
							story: huddle.issue,
							bold: true,
							fg: STUDIO.text,
						},
					],
					text(`[${state.label}]`, state.color),
					contentWidth,
				),
				columns,
			),
		);
		out.push(
			inside(
				align(
					text(
						`${huddle.members.length} agent${huddle.members.length === 1 ? "" : "s"}${huddle.members.length > members.length ? ` · +${huddle.members.length - members.length} more` : ""}${huddle.kickbacks ? ` · ${huddle.kickbacks} sent back` : ""}`,
						STUDIO.muted,
					),
					text(age(now, huddle.lastActiveAt), STUDIO.muted),
					contentWidth,
				),
				columns,
			),
		);
		const nodeWidth = Math.max(
			8,
			Math.floor(
				(contentWidth - (members.length - 1) * 3) / Math.max(1, members.length),
			),
		);
		const nodeRows: Line[] = [[], [], []];
		for (const [i, name] of members.entries()) {
			const member = model.teammates[name];
			const color = colorFor(name, profile, colorIndex(name));
			const nodeName = fit(text(`─ ${name} `, color), nodeWidth - 2);
			const node: Line[] = [
				[
					{ text: "┌", fg: color },
					...nodeName,
					{
						text: `${"─".repeat(Math.max(0, nodeWidth - 2 - width(nodeName)))}┐`,
						fg: color,
					},
				],
				inside(
					[
						{
							text: `${member?.status === "running" ? "● RUN" : member?.away ? "○ AWAY" : "○ IDLE"} `,
							fg: color,
							agentId: member?.agentId,
						},
						{ text: roleFor(name, profile)?.role ?? "agent", fg: STUDIO.muted },
					],
					nodeWidth,
				),
				text(`└${"─".repeat(nodeWidth - 2)}┘`, color),
			];
			for (let row = 0; row < 3; row++) {
				if (i)
					nodeRows[row]?.push({
						text: row === 1 ? " ┄ " : "   ",
						fg: STUDIO.edge,
					});
				nodeRows[row]?.push(...(node[row] ?? []));
			}
		}
		for (const line of nodeRows) out.push(inside(line.flat(), columns));
		const latest = model.hallway.findLast(
			(m) => huddle.members.includes(m.from) || m.issues.includes(huddle.issue),
		);
		out.push(
			inside(
				text(
					latest
						? `${latest.from} → ${latest.to}: ${latest.text}`
						: "No conversation yet",
					STUDIO.muted,
				),
				columns,
			),
		);
		out.push(edge(columns, true));
	}
	if (groups.length < model.huddles.length)
		out.push(
			textLine(
				`+${model.huddles.length - groups.length} more workstreams · h to focus`,
				columns,
			),
		);
	if (!model.huddles.length)
		out.push(
			textLine("No active workstreams. Waiting for assignments.", columns),
		);
	return out.slice(0, rows);
}
function agentRegister(
	model: BullpenModel,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): Line[] {
	const out = [section("AGENT REGISTER", columns)];
	const members = Object.values(model.teammates).filter(
		(m) => m.status !== "gone",
	);
	const shown = members.slice(0, Math.max(0, Math.floor((rows - 3) / 2)));
	for (const member of shown) {
		const color = colorFor(
			member.name,
			profile,
			colorIndex(member.name),
			member.agentType,
		);
		out.push(
			align(
				[
					{
						text: `${member.status === "running" ? "●" : "○"} ${member.name}`,
						fg: color,
						agentId: member.agentId,
						bold: true,
					},
				],
				text(
					member.issue === undefined ? "unassigned" : `#${member.issue}`,
					STUDIO.muted,
				),
				columns,
			),
		);
		const last = member.trail[member.trail.length - 1];
		out.push(
			fit(
				text(
					`  ${member.status.toUpperCase()} · ${last ? `${last.detail} · ${age(now, last.at)}` : "waiting"}`,
					STUDIO.muted,
				),
				columns,
			),
		);
	}
	if (shown.length < members.length)
		out.push(
			textLine(`+${members.length - shown.length} more agents`, columns),
		);
	return out.slice(0, rows);
}
function decisions(model: BullpenModel, columns: number, rows: number): Line[] {
	if (rows < 1) return [];
	const out = [section("DECISION QUEUE", columns)];
	const asks = model.asks.filter((a) => a.open);
	if (!asks.length) return [...out, textLine("✓ No open decisions", columns)];
	for (const ask of asks.slice(0, Math.max(0, Math.floor((rows - 1) / 3)))) {
		out.push(fit(text(`! ${ask.from} → lead`, STUDIO.amber), columns));
		out.push(fit(text(`  ${ask.text}`, STUDIO.amber), columns));
		out.push(fit(text("  t · view conversation", STUDIO.muted), columns));
	}
	return out.slice(0, rows);
}
function trace(model: BullpenModel, columns: number, rows: number): Line[] {
	if (rows < 1) return [];
	const out = [section("EVENT TRACE / recent conversation", columns)];
	for (const message of model.hallway.slice(-Math.max(0, rows - 1)))
		out.push(
			fit(
				[
					{ text: `${clock(message.at)}  `, fg: STUDIO.muted },
					{ text: `${message.from} → ${message.to}  `, fg: STUDIO.mint },
					{ text: message.text },
				],
				columns,
			),
		);
	return out.slice(0, rows);
}

/** Uses only measured single-cell terminal text; there is no image conversion. */
export function operationsView(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): { header: Line[]; regions: Line[] } {
	const header = [
		align(
			text(" BULLPEN / OPERATIONS", STUDIO.mint),
			text(`● LIVE  ${clock(now).slice(0, 5)} `, STUDIO.mint),
			columns,
		),
		align(
			text(
				` ${github.repo ?? "workspace"} · ${Object.values(model.teammates).filter((m) => m.status !== "gone").length} agents · ${model.huddles.length} workstreams`,
				STUDIO.muted,
			),
			text(
				`${github.result ? headerText(github.result) : "no GitHub data"} `,
				STUDIO.muted,
			),
			columns,
		),
	];
	const ask = model.asks.find((a) => a.open);
	if (columns < 120 && ask && header.length < rows)
		header.push(
			fit(
				text(` ! NEEDS YOU · ${ask.from}: ${ask.text}`, STUDIO.amber),
				columns,
			),
		);
	const room = Math.max(0, rows - header.length);
	const traceRows = Math.min(7, Math.max(3, Math.floor(room / 4)));
	const topRows = Math.max(0, room - traceRows - 1);
	const leftWidth = columns >= 120 ? Math.floor((columns - 3) * 0.64) : columns;
	const left = issueCards(model, github, profile, leftWidth, topRows, now);
	const rightWidth = columns - leftWidth - 3;
	const right =
		columns >= 120
			? agentRegister(model, profile, rightWidth, Math.max(1, topRows - 8), now)
			: [];
	if (columns >= 120) {
		while (right.length < Math.max(1, topRows - 8)) right.push([]);
		right.push(...decisions(model, rightWidth, 8));
	}
	const regions: Line[] = [];
	for (let i = 0; i < topRows; i++) {
		const line = fit(left[i] ?? [], leftWidth);
		regions.push(
			columns >= 120
				? [
						...line,
						{
							text: `${" ".repeat(Math.max(0, leftWidth - width(line)))} │ `,
							fg: STUDIO.edge,
						},
						...fit(right[i] ?? [], rightWidth),
					]
				: line,
		);
	}
	regions.push([]);
	regions.push(...trace(model, columns, traceRows));
	return {
		header: glyphLines(header.slice(0, rows), profile.glyphs),
		regions: glyphLines(regions.slice(0, room), profile.glyphs),
	};
}
