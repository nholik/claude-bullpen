import type { BurndownPoint, GithubSource, Profile } from "../../types";
import { exactCounts, headerText } from "../github";
import type { BullpenModel } from "../model";
import { backlogTrend } from "../model/signals";
import { colorFor, colorIndex, DEFAULT_PROFILE } from "../profile";
import { fit, glyphLines, type Line, textLine, width, wrapText } from "./lines";
import { moraleHint } from "./morale";
import { STUDIO } from "./studio";

/** Time-bucketed samples preserve the time axis even when snapshots compress. */
export function sparkline(
	series: readonly BurndownPoint[],
	columns: number,
): string {
	if (!series.length || columns < 1) return "";
	const first = series[0];
	const last = series[series.length - 1];
	if (!first || !last) return "";
	const count = Math.min(columns, Math.max(1, series.length));
	const max = Math.max(1, ...series.map((p) => p.open));
	let index = 0;
	return Array.from({ length: count }, (_, i) => {
		const at = first.at + ((last.at - first.at) * i) / Math.max(1, count - 1);
		while (
			index + 1 < series.length &&
			(series[index + 1]?.at ?? Infinity) <= at
		)
			index++;
		return (
			"▁▂▃▄▅▆▇█"[
				Math.min(7, Math.round((7 * (series[index]?.open ?? 0)) / max))
			] ?? "▁"
		);
	}).join("");
}

export function pace(series: readonly BurndownPoint[]): string {
	const first = series[0];
	const last = series[series.length - 1];
	if (!first || !last || last.at <= first.at) return "pace —";
	if (last.open === 0) return "done";
	const closed = last.closed - first.closed;
	if (closed <= 0) return "pace —";
	return `pace ~${Math.max(1, Math.ceil((last.open * (last.at - first.at)) / closed / 60000))}m`;
}

export function header(
	model: BullpenModel,
	github: GithubSource,
	columns: number,
	now: number,
	profile: Profile = DEFAULT_PROFILE,
): Line[] {
	const counts =
		github.result?.status === "ok" ? exactCounts(github.result) : undefined;
	const total = counts ? counts.open + counts.closed : 0;
	const progress =
		counts && total ? Math.round((8 * counts.closed) / total) : 0;
	const date = new Date(now);
	const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
	const teammates = Object.values(model.teammates).filter(
		(m) => m.status !== "gone",
	).length;
	const suffix =
		columns >= 110
			? ` ● LIVE · ${teammates} teammates · ${clock}`
			: ` ${model.morale.glyph} ${clock}`;
	const prefix = fit(
		[
			{
				text: `${profile.style === "operations" ? "Bullpen / OPERATIONS" : "Bullpen"} · ${github.filter || "all issues"}${github.result ? ` · ${headerText(github.result)}` : ""} `,
				bold: true,
				fg: STUDIO.text,
			},
			{
				text: counts ? "━".repeat(progress) + "─".repeat(8 - progress) : "",
				fg: STUDIO.mint,
			},
		],
		Math.max(0, columns - suffix.length),
	);
	const lines = [
		fit(
			[
				...prefix,
				{
					text:
						" ".repeat(Math.max(0, columns - width(prefix) - suffix.length)) +
						suffix,
					fg: STUDIO.mint,
				},
			],
			columns,
		),
	];
	const ask = model.asks.find((a) => a.open);
	if (ask)
		lines.push(
			...wrapText(` NEEDS YOU · ${ask.from}: "${ask.text}"`, columns).map(
				(line) =>
					line.map((seg) => ({ ...seg, fg: STUDIO.amber, bg: STUDIO.panel })),
			),
		);
	else if (columns >= 60)
		lines.push(
			fit(
				[
					{
						text: ` ${model.closed.length ? `✓ ${model.closed.length} shipped` : profile.style === "operations" ? "OPERATIONS" : "STUDIO"}`,
						fg: STUDIO.mint,
						bold: true,
					},
					{
						text: ` · ${model.huddles.length} active huddles · ${Object.values(model.teammates).filter((m) => m.status === "running").length} working`,
						fg: STUDIO.muted,
					},
				],
				columns,
			),
		);
	const hint = moraleHint(model, now);
	if (hint && !hint.includes(ask?.text ?? "\0"))
		lines.push(textLine(hint, columns));
	return lines;
}

export function footer(github: GithubSource, columns: number): Line[] {
	if (github.result?.status !== "ok")
		return [
			textLine(
				`burndown · no GitHub data${github.result ? ` · ${github.result.message}` : ""}`,
				columns,
			),
		];
	const series = github.burndown;
	const first = series[0];
	const last = series[series.length - 1];
	const flat =
		!first ||
		!last ||
		(first.open === last.open && first.closed === last.closed);
	const trend = backlogTrend(series);
	return [
		fit(
			[
				{ text: "burndown ", fg: STUDIO.muted },
				{
					text: sparkline(series, Math.max(1, Math.min(24, columns - 45))),
					fg: trend && trend.delta > 0 ? STUDIO.amber : STUDIO.mint,
				},
				{
					text: ` · ${last?.open ?? "—"} open · ${trend && trend.delta > 0 ? `backlog +${trend.delta} / ${trend.minutes}m` : flat ? "no change yet" : pace(series)}`,
					fg: STUDIO.muted,
				},
			],
			columns,
		),
	];
}

export function band(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	seenAt: number,
): Line {
	const segments: Line = [
		{ text: "☰ bullpen" },
		{ text: ` ${model.morale.glyph} ` },
	];
	const asks = model.asks.filter((a) => a.open).length;
	if (asks) segments.push({ text: ` !${asks} `, fg: STUDIO.amber, bold: true });
	const stuck = Object.keys(model.stuck ?? {}).length;
	if (stuck) segments.push({ text: ` ${stuck} stalled `, fg: STUDIO.coral });
	for (const h of model.huddles) {
		const name = h.members[0] ?? "";
		const running = h.members.some(
			(n) => model.teammates[n]?.status === "running",
		);
		const ask = model.asks.some((a) => a.open && a.issues.includes(h.issue));
		segments.push({
			text: ` ${running ? "●" : "◐"}#${h.issue}×${h.members.length}${ask ? "⚑" : ""}`,
			fg: colorFor(name, profile, colorIndex(name)),
		});
	}
	const unread = model.hallway.filter((m) => m.at > seenAt).length;
	segments.push({
		text: ` ✉${unread}${github.result ? ` ${headerText(github.result)}` : ""} ${sparkline(github.burndown, 5)}`,
	});
	return glyphLines([fit(segments, columns)], profile.glyphs)[0] ?? [];
}
