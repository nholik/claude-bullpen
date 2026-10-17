import type { BurndownPoint, GithubSource, Profile } from "../../types";
import { exactCounts, headerText } from "../github";
import type { BullpenModel } from "../model";
import { colorFor, colorIndex } from "../profile";
import { fit, type Line, textLine, width } from "./lines";

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
): Line[] {
	const counts =
		github.result?.status === "ok" ? exactCounts(github.result) : undefined;
	const total = counts ? counts.open + counts.closed : 0;
	const progress =
		counts && total ? Math.round((8 * counts.closed) / total) : 0;
	const date = new Date(now);
	const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
	const suffix = ` ${model.morale.glyph} ${clock}`;
	const prefix = fit(
		[
			{
				text: `Bullpen · ${github.filter || "all issues"} · ${github.result ? headerText(github.result) : "no GitHub data"} `,
				bold: true,
			},
			{ text: counts ? "━".repeat(progress) + "─".repeat(8 - progress) : "" },
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
				},
			],
			columns,
		),
	];
	const ask = model.asks.find((a) => a.open);
	if (ask) lines.push(textLine(`⚑ ${ask.from}: "${ask.text}"`, columns));
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
	return [
		textLine(
			`burndown ${series[0]?.open ?? "—"} ${sparkline(series, Math.max(1, Math.min(24, columns - 45)))} ${series[series.length - 1]?.open ?? "—"} · ${pace(series)}`,
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
	const segments: Line = [{ text: `☰ bullpen ${model.morale.glyph} ` }];
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
		text: ` ✉${unread} ${github.result ? headerText(github.result) : "no GitHub data"} ${sparkline(github.burndown, 5)}`,
	});
	return fit(segments, columns);
}
