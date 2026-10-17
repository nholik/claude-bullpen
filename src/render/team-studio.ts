import type { GithubSource, Profile } from "../../types";
import type { BullpenModel, Teammate } from "../model";
import { colorFor, colorIndex, roleLabel } from "../profile";
import { activityPhrase } from "./activity";
import { fit, glyphLines, type Line, textLine, width, wrapText } from "./lines";
import { moodFor, snoozeFrame } from "./mood";
import { moraleHint } from "./morale";
import { age, align, clock, edge, inside, section, text } from "./operations";
import { STUDIO } from "./studio";

/** Short-lived signals use the existing one-second view refresh; no extra timer. */
function activity(member: Teammate, model: BullpenModel, now: number) {
	const recent = (at: number) => at <= now && now - at < 4000;
	const message = model.hallway.findLast(
		(m) => recent(m.at) && (m.from === member.name || m.to === member.name),
	);
	const last = member.trail[member.trail.length - 1];
	if (
		last?.kind === "turn-end" &&
		recent(last.at) &&
		(!message || last.at > message.at)
	)
		return { at: last.at, label: "✓ TURN DONE", color: STUDIO.mint };
	if (message)
		return {
			at: message.at,
			label:
				message.from === member.name
					? `→ TO ${message.to}`
					: `← FROM ${message.from}`,
			color: STUDIO.lavender,
		};
	return undefined;
}

/** Top edge, four rows, bottom edge. */
const CARD_ROWS = 6;

/** Minutes the member's issue has been stalled, when the morale model says so. */
function stalledMin(member: Teammate, model: BullpenModel, now: number) {
	const huddle = model.huddles.find(
		(h) =>
			h.issue === member.issue &&
			model.morale.factors.stalled.includes(h.issue),
	);
	return huddle
		? Math.max(0, Math.floor((now - huddle.lastActiveAt) / 60000))
		: undefined;
}

function workstation(
	member: Teammate,
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	now: number,
): Line[] {
	const color = colorFor(
		member.name,
		profile,
		colorIndex(member.name),
		member.agentType,
	);
	const role = roleLabel(member.name, member.agentType, profile);
	const feel = moodFor({
		status: member.status,
		away: member.away,
		stalledMin: stalledMin(member, model, now),
		needsYou: model.asks.some((a) => a.open && a.from === member.name),
	});
	// The z's drift once per redraw (1 s while a highlight fades, else 15 s).
	const zs = feel.snoozes ? snoozeFrame(now, profile.animations) : "";
	const signal = profile.animations ? activity(member, model, now) : undefined;
	const bright = signal && Math.floor((now - signal.at) / 1000) % 2 === 0;
	const border = bright ? signal.color : (feel.frame ?? STUDIO.edge);
	const title =
		github.result?.status === "ok"
			? github.result.issues.find((i) => i.number === member.issue)?.title
			: undefined;
	const tool = member.trail.findLast((s) => s.kind === "tool");
	const said = model.hallway.findLast(
		(m) => m.from === member.name || m.to === member.name,
	);
	const phrase = tool ? activityPhrase(tool) : undefined;
	const spoken = said
		? said.from === member.name
			? `→ ${said.to}: ${said.text}`
			: `← ${said.from}: ${said.text}`
		: undefined;
	// What it is doing, else the latest message (shown once), else nothing yet.
	const doing: Line = text(
		phrase ?? spoken ?? "Waiting for activity",
		STUDIO.text,
	);
	const earlier: Line = spoken && phrase ? text(spoken, STUDIO.muted) : [];
	// Messages and finished turns recolor the face and frame; they take no row.
	const mood: Line = [
		{
			text: `${feel.face} `,
			fg: bright && signal ? signal.color : feel.color,
			bold: feel.pulse || Boolean(bright),
		},
	];
	const name: Line = [
		...mood,
		{ text: member.name, fg: color, agentId: member.agentId, bold: true },
		{ text: zs ? ` ${zs.trim()}` : "", fg: STUDIO.muted },
	];
	// The state word outranks the role, and the role the age: drop in that order
	// when the line is tight, keeping a gap before the right edge text.
	const stamp = age(now, member.lastActiveAt);
	const word = text(feel.label, feel.color);
	const dot = " · ";
	const tails: Line[] = [
		[...word, ...text(`${dot}${role}${dot}${stamp}`, STUDIO.muted)],
		[...word, ...text(`${dot}${stamp}`, STUDIO.muted)],
		word,
	];
	const tail =
		tails.find((t) => width(name) + width(t) + 2 <= columns - 4) ??
		tails[tails.length - 1] ??
		[];
	// Idle, away and gone cards sit back so working cards stand out.
	const soften = (line: Line): Line =>
		feel.dim ? line.map((seg) => ({ ...seg, dim: true })) : line;
	return [
		edge(columns, false, border),
		inside(align(soften(name), soften(tail), columns - 4), columns, border),
		inside(
			soften(
				member.issue === undefined
					? text("Unassigned", STUDIO.muted)
					: [
							{
								text: `#${member.issue} ${title ?? ""}`,
								fg: STUDIO.text,
								story: member.issue,
							},
						],
			),
			columns,
			border,
		),
		inside(soften(doing), columns, border),
		inside(soften(earlier), columns, border),
		edge(columns, true, border),
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
	const hint = moraleHint(model, now);
	const working = team.filter((m) => m.status === "running").length;
	const header = [
		align(
			text(" BULLPEN / TEAM STUDIO", STUDIO.lavender),
			[
				{ text: `${model.morale.glyph} `, fg: STUDIO.amber },
				...text(`● LIVE  ${clock(now).slice(0, 5)} `, STUDIO.mint),
			],
			columns,
		),
		align(
			hint
				? text(` ${hint}`, STUDIO.amber)
				: text(
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
	const capacity =
		across * Math.max(0, Math.floor((room - 3) / (CARD_ROWS + 1)));
	const shown = team.slice(0, capacity);
	const left: Line[] = [section("WORKSTATIONS / teammates", leftWidth)];
	for (let index = 0; index < shown.length; index += across) {
		const cards = shown
			.slice(index, index + across)
			.map((member) =>
				workstation(member, model, github, profile, cardWidth, now),
			);
		for (let row = 0; row < CARD_ROWS; row++) {
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
			if (columns >= 120) left.push([]);
		}
		// Narrow panes have no hallway column: use the rows left over for it.
		const spare = room - left.length;
		if (columns < 120 && spare >= 2) {
			left.push(section("HALLWAY / conversation", leftWidth));
			for (const message of model.hallway.slice(-(spare - 1)))
				left.push(
					fit(
						[
							{
								text: `${message.from} → ${message.to}: `,
								fg: colorFor(message.from, profile, colorIndex(message.from)),
							},
							{ text: message.text, fg: STUDIO.muted },
						],
						leftWidth,
					),
				);
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
			right.push(
				textLine(
					working ? `heads-down · ${working} working` : "The hallway is quiet.",
					rightWidth,
				),
			);
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
