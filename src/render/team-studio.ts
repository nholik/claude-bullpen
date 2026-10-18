import type { GithubSource, Profile } from "../../types";
import type { BullpenModel, Teammate } from "../model";
import { activeTime, flowSummary, waitingOn } from "../model/signals";
import { colorFor, colorIndex, memberRole, roleLabel } from "../profile";
import { messageKey } from "../scroll";
import { activityPhrase } from "./activity";
import {
	type CardWidthTracker,
	cardsPerRow,
	settledCardWidth,
} from "./card-width";
import { age, align, clock, edge, inside, section, text } from "./layout";
import { fit, glyphLines, type Line, textLine, width, wrapText } from "./lines";
import { moodFor, snoozeFrame } from "./mood";
import { needsSection, needsYou } from "./needs";
import { shippingRows, shippingSection } from "./shipping";
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

function workstation(
	member: Teammate,
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	now: number,
	compact = false,
): Line[] {
	const color = colorFor(
		member.name,
		profile,
		colorIndex(member.name),
		member.agentType,
	);
	const role = roleLabel(member.name, member.agentType, profile);
	const waiting = waitingOn(model, member, memberRole(member, profile));
	const feel = moodFor({
		status: member.status,
		away: member.away,
		stuckReason: model.stuck?.[member.name],
		waitingOnReview: waiting !== undefined,
		waitingOnMerge: waiting === "merge",
		failingChecks: member.failureCount,
		justMerged: model.ship.some(
			(p) =>
				p.issue === member.issue &&
				(p.stage === "merged" || p.stage === "shipped") &&
				now - p.at < 120_000,
		),
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
		model.stuck?.[member.name] ?? phrase ?? spoken ?? "Waiting for activity",
		STUDIO.text,
	);
	const earlier: Line = text(
		`${member.turns ?? 0} turns · ${Math.floor(activeTime(member, now) / 60000)}m active${spoken && phrase ? ` · ${spoken}` : ""}`,
		STUDIO.muted,
	);
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
	// The state word outranks the age: drop the age when the line is tight,
	// keeping a gap before the right edge text. The role has its own row.
	const stamp = age(now, member.lastActiveAt);
	const word = text(feel.kind === "stuck" ? "stuck" : feel.label, feel.color);
	const dot = " · ";
	const tails: Line[] = [
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
	if (compact)
		return [
			align(
				soften([
					...name,
					...text(role ? ` · ${role}` : "", STUDIO.muted),
					...(member.issue === undefined
						? []
						: [
								{
									text: ` #${member.issue}`,
									story: member.issue,
									fg: STUDIO.text,
								},
							]),
				]),
				text(feel.kind === "stuck" ? "stuck" : feel.label, feel.color),
				columns,
			),
			fit(
				soften([
					...text("    ", STUDIO.muted),
					...doing,
					...text(
						` · ${member.turns ?? 0}t/${Math.floor(activeTime(member, now) / 60000)}m`,
						STUDIO.muted,
					),
				]),
				columns,
			),
		];
	return [
		edge(columns, false, border),
		inside(align(soften(name), soften(tail), columns - 4), columns, border),
		inside(
			soften(
				align(
					member.issue === undefined
						? text("Unassigned", STUDIO.muted)
						: [
								{
									text: `#${member.issue} ${title ?? ""}`,
									fg: STUDIO.text,
									story: member.issue,
								},
							],
					text(role, STUDIO.muted),
					columns - 4,
				),
			),
			columns,
			border,
		),
		inside(soften(doing), columns, border),
		inside(soften(earlier), columns, border),
		edge(columns, true, border),
	];
}

/** The line ending in one "…": a cell is left for it, and `fit` may already have added it. */
function withCutMarker(line: Line, columns: number): Line {
	const last = fit(line, columns - 1);
	return last.at(-1)?.text.endsWith("…")
		? last
		: [...last, { text: "…", fg: STUDIO.muted }];
}

/** Hallway messages as a sender/time row, up to two wrapped lines and a gap. */
function messageLines(
	messages: BullpenModel["hallway"],
	profile: Profile,
	columns: number,
	maxLines = 2,
	keyed = false,
): Line[] {
	// Wrapping a 2000-char message to keep six lines is wasted work: wrap a
	// prefix with room to spare (two chars a cell) and mark the cut ourselves.
	const reach = (maxLines + 1) * Math.max(1, columns) * 2;
	return messages.flatMap((message) => {
		const clipped = message.text.length > reach;
		const wrapped = wrapText(
			clipped ? message.text.slice(0, reach) : message.text,
			columns,
		);
		const body = wrapped.slice(0, maxLines);
		if ((clipped || wrapped.length > maxLines) && body.length)
			body.push(withCutMarker(body.pop() ?? [], columns));
		const header = align(
			text(
				`${message.from} → ${message.to}`,
				colorFor(message.from, profile, colorIndex(message.from)),
			),
			text(clock(message.at).slice(0, 5), STUDIO.muted),
			columns,
		);
		const first = header[0];
		if (keyed && first) header[0] = { ...first, key: messageKey(message) };
		return [header, ...body, []];
	});
}

/**
 * The whole kept hallway, oldest first, as a tree taller than the window: the
 * engine scrolls it row by row. A message over six lines ends in "…".
 */
export function allMessages(
	messages: BullpenModel["hallway"],
	profile: Profile,
	columns: number,
): Line[] {
	return messageLines(messages, profile, columns, 6, true);
}

/** A people-first terminal view: measured text and symbols, not an office illustration. */
export function teamStudioView(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
	mode: "live" | "demo" | "replay" = "live",
	cardWidths?: CardWidthTracker,
	wallNow = now,
	focus?: "shipping" | "talk" | "needs",
	cursor = 0,
): { header: Line[]; regions: Line[] } {
	const urgency = (m: Teammate) =>
		model.asks.some((a) => a.open && a.from === m.name)
			? 0
			: model.stuck?.[m.name]
				? 1
				: m.status === "running"
					? 2
					: m.status === "gone"
						? 4
						: 3;
	const all = Object.values(model.teammates);
	const away = all.filter(
		(m) =>
			m.away &&
			!model.stuck?.[m.name] &&
			!model.asks.some((a) => a.open && a.from === m.name),
	);
	const team = all
		.filter(
			(m) =>
				!away.includes(m) &&
				(m.status !== "gone" || now - (m.goneAt ?? m.lastActiveAt) < 120_000),
		)
		.sort(
			(a, b) =>
				urgency(a) - urgency(b) ||
				a.color - b.color ||
				a.name.localeCompare(b.name),
		);
	const flow = flowSummary(model, github.burndown, now);
	const working = team.filter((m) => m.status === "running").length;
	const shipping = shippingRows(model, now);
	const inFlight = shipping.filter(
		(r) => r.stage !== "merged" && r.stage !== "shipped",
	).length;
	const header = [
		align(
			text(" BULLPEN / TEAM STUDIO", STUDIO.lavender),
			[
				{ text: `${model.morale.glyph} `, fg: STUDIO.amber },
				...text(
					`● ${mode.toUpperCase()}  ${clock(now).slice(0, 5)} `,
					STUDIO.mint,
				),
			],
			columns,
		),
		align(
			text(
				` ${github.repo || github.workspace || "workspace"} · ${team.filter((t) => t.status !== "gone").length + away.length} teammates · ${inFlight} in flight`,
				STUDIO.muted,
			),
			text(`${model.shipped} shipped this session `, STUDIO.muted),
			columns,
		),
		...(focus === "needs" ? [] : needsYou(model.decisions, columns, now)),
		fit(
			text(` FLOW · ${flow.text}`, flow.pressure ? STUDIO.amber : STUDIO.mint),
			columns,
		),
	];
	const room = Math.max(0, rows - header.length);
	if (focus) {
		// A focused list fills the body under the same header.
		// Messages are not cut to the window: the pane scrolls the tall tree.
		const body =
			focus === "shipping"
				? shippingSection(model, github, profile, columns, room, now).slice(
						0,
						room,
					)
				: focus === "needs"
					? needsSection(model.decisions, columns, now, cursor, room)
					: [
							section("MESSAGES / hallway", columns),
							...(model.hallway.length
								? allMessages(model.hallway, profile, columns)
								: [textLine("The hallway is quiet.", columns)]),
						];
		return {
			header: glyphLines(header, profile.glyphs),
			regions: glyphLines(
				body.map((line) => fit(line, columns)),
				profile.glyphs,
			),
		};
	}
	const leftWidth = columns >= 110 ? Math.floor((columns - 3) * 0.68) : columns;
	const rightWidth = columns - leftWidth - 3;
	const compact = columns < 110;
	const across = compact ? 1 : leftWidth >= 105 ? 3 : leftWidth >= 64 ? 2 : 1;
	// SHIPPING keeps its rows: cards give way before the path to merge does.
	const reserve = Math.min(shipping.length + 1, 6) + 1 + (away.length ? 1 : 0);
	const slot = compact ? 2 : CARD_ROWS + 1;
	const capacity =
		across * Math.max(0, Math.floor((room - 3 - reserve) / slot));
	const shown = team.slice(0, capacity);
	// A small team gets wider cards (up to a cap) instead of empty space.
	const perRow = compact ? 1 : cardsPerRow(across, shown.length);
	const settled = compact
		? Math.max(12, leftWidth)
		: settledCardWidth(leftWidth, perRow);
	const cardWidth =
		compact || !cardWidths || !shown.length
			? settled
			: cardWidths.sample(perRow, settled, wallNow, profile.animations);
	const left: Line[] = shippingSection(
		model,
		github,
		profile,
		leftWidth,
		Math.min(Math.max(0, room - 3), Math.min(shipping.length + 1, 6)),
		now,
	);
	left.push(section("WORKSTATIONS / teammates", leftWidth));
	for (let index = 0; index < shown.length; index += perRow) {
		const cards = shown
			.slice(index, index + perRow)
			.map((member) =>
				workstation(member, model, github, profile, cardWidth, now, compact),
			);
		for (let row = 0; row < (compact ? 2 : CARD_ROWS); row++) {
			const line: Line = [];
			for (const [i, card] of cards.entries()) {
				if (i) line.push({ text: "  " });
				line.push(...(card[row] ?? []));
			}
			left.push(line);
		}
		if (!compact) left.push([]);
	}
	if (shown.length < team.length)
		left.push(
			textLine(`+${team.length - shown.length} more teammates`, leftWidth),
		);
	if (!team.length)
		left.push(textLine("Waiting for teammates to join.", leftWidth));
	if (away.length) {
		const out: Line = text("out: ", STUDIO.muted);
		for (const [i, m] of away.entries()) {
			const item: Line = [
				...text(i ? " · " : "", STUDIO.muted),
				{
					text: m.name,
					fg: colorFor(m.name, profile, m.color, m.agentType),
					agentId: m.agentId,
				},
				...text(` ${age(now, m.lastActiveAt)}`, STUDIO.muted),
			];
			const more = away.length - i - 1;
			if (
				width(out) + width(item) + (more ? ` · +${more}`.length : 0) >
				leftWidth
			) {
				out.push(...text(`${i ? " · " : ""}+${away.length - i}`, STUDIO.muted));
				break;
			}
			out.push(...item);
		}
		left.push(fit(out, leftWidth));
	}
	if (left.length + 4 < room) {
		if (columns >= 110) left.push([]);
		// Narrow panes have no hallway column: use the rows left over for it.
		const spare = room - left.length;
		if (columns < 110 && spare >= 2) {
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
		columns >= 110 ? [section("HALLWAY / conversation", rightWidth)] : [];
	if (columns >= 110) {
		const history = model.hallway.slice(
			-Math.max(1, Math.floor((room - 10) / 4)),
		);
		right.push(...messageLines(history, profile, rightWidth));
		if (!history.length)
			right.push(
				textLine(
					working ? `heads-down · ${working} working` : "The hallway is quiet.",
					rightWidth,
				),
			);
	}
	const regions: Line[] = [];
	for (let row = 0; row < room; row++) {
		const line = fit(left[row] ?? [], leftWidth);
		regions.push(
			columns >= 110
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
