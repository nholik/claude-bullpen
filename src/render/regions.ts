import type { GithubSource, Profile } from "../../types";
import { glow } from "../anim";
import { mix } from "../color";
import { type BullpenModel, isHallwayLive } from "../model";
import { STALL_MS } from "../model/morale";
import { colorFor, colorIndex } from "../profile";
import { fit, glyphLines, type Line, textLine, width } from "./lines";
import { issueStatus, STUDIO } from "./studio";

function huddlesImpl(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): Line[] {
	if (rows < 1) return [];
	const lines = [
		textLine(
			profile.style === "operations" ? "── Workstreams ──" : "── Huddles ──",
			columns,
		),
	];
	const sorted = [...model.huddles].sort(
		(a, b) => b.lastActiveAt - a.lastActiveAt || a.issue - b.issue,
	);
	if (!sorted.length)
		return [...lines, textLine("No active huddles", columns)].slice(0, rows);
	const expanded = columns >= 34 && rows >= 11;
	const cardRows = expanded ? 5 : 3;
	let shown = 0;
	for (const h of sorted) {
		const reserve = shown < sorted.length - 1 ? 1 : 0;
		if (lines.length + cardRows + reserve > rows) break;
		const title =
			github.result?.status === "ok"
				? github.result.issues.find((i) => i.number === h.issue)?.title
				: undefined;
		const stalled = now - h.lastActiveAt > STALL_MS;
		const age = Math.max(0, Math.floor((now - h.startedAt) / 60000));
		const activity = Array.from({ length: 4 }, (_, i) => {
			const end = now - (3 - i) * 60000;
			const count = h.members.reduce(
				(n, name) =>
					n +
					(model.teammates[name]?.trail.filter(
						(t) => t.at <= end && t.at > end - 60000,
					).length ?? 0),
				0,
			);
			return "▁▂▃▄▅▆▇█"[Math.min(7, count)] ?? "▁";
		}).join("");
		const state = issueStatus(model, h.issue, profile, now);
		const heading = fit(
			[
				{
					story: h.issue,
					text: `╭ #${h.issue}${title ? ` ${title}` : ""}`,
					dim: stalled,
					fg: profile.animations
						? mix(0x555555, 0xd8e9ff, glow(now, h.lastActiveAt))
						: 0x777777,
				},
			],
			Math.max(0, columns - state.label.length - 5),
		);
		lines.push([
			...heading,
			{ text: ` ${state.label} `, fg: state.color, bold: true },
			{
				text: `${"─".repeat(Math.max(0, columns - width(heading) - state.label.length - 3))}╮`,
				dim: stalled,
				fg: profile.animations
					? mix(0x555555, 0xd8e9ff, glow(now, h.lastActiveAt))
					: 0x777777,
			},
		]);
		const members: Line = [{ text: "│ " }];
		for (const name of h.members) {
			const m = model.teammates[name];
			const kickback = model.kickbacks.some(
				(k) => k.issue === h.issue && k.to === name,
			);
			members.push({
				text: `${m?.status === "running" ? "●" : "○"}${name}${h.members.length > 1 ? " ⇄" : ""}${kickback ? " ↺" : ""}${m?.away ? " away" : ""} `,
				fg: colorFor(name, profile, colorIndex(name)),
				agentId: m?.agentId,
				dim: m?.status !== "running" || m?.away,
			});
		}
		const clipped = fit(members, Math.max(0, columns - 1));
		lines.push([
			...clipped,
			{ text: `${" ".repeat(Math.max(0, columns - width(clipped) - 1))}│` },
		]);
		if (expanded) {
			const steps: Line = [{ text: "│ " }];
			for (const [index, name] of [
				"assigned",
				"working",
				"review",
				"done",
			].entries()) {
				steps.push({
					text: `${index ? " ─ " : ""}${name}`,
					fg: index === state.step ? state.color : STUDIO.muted,
					bold: index === state.step,
				});
			}
			const track = fit(steps, columns - 1);
			lines.push([
				...track,
				{ text: `${" ".repeat(Math.max(0, columns - width(track) - 1))}│` },
			]);
			const meta = fit(
				[
					{
						text: `│ ${activity}  ${age}m together${h.kickbacks ? ` · ↺${h.kickbacks} sent back` : ""}`,
						fg: STUDIO.muted,
					},
				],
				columns - 1,
			);
			lines.push([
				...meta,
				{ text: `${" ".repeat(Math.max(0, columns - width(meta) - 1))}│` },
			]);
		}
		lines.push(textLine(`╰${"─".repeat(Math.max(0, columns - 2))}╯`, columns));
		shown++;
	}
	if (shown < sorted.length)
		lines.push(textLine(`+${sorted.length - shown} more huddles`, columns));
	return lines.slice(0, rows);
}

function hallwayImpl(
	model: BullpenModel,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): Line[] {
	if (rows < 1) return [];
	const last = model.hallway[model.hallway.length - 1];
	if (!isHallwayLive(model.hallway, now))
		return [
			textLine(
				`Hallway ▸ quiet${last ? ` · ${Math.max(0, Math.floor((now - last.at) / 60000))}m ago ${last.from} → ${last.to}` : " · no messages"}`,
				columns,
			),
		];
	const lines = [
		textLine(
			profile.style === "operations"
				? "── Recent events ▾ live ──"
				: "── Hallway ▾ live ──",
			columns,
		),
	];
	if (rows > 1)
		for (const m of model.hallway.slice(-(rows - 1))) {
			const date = new Date(m.at);
			const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
			lines.push(
				fit(
					[
						{ text: `${clock}  `, fg: STUDIO.muted },
						{
							text: `${m.from} → ${m.to}: `,
							fg: colorFor(m.from, profile, colorIndex(m.from)),
						},
						{ text: m.text },
					],
					columns,
				),
			);
		}
	return lines;
}

export function huddles(...args: Parameters<typeof huddlesImpl>): Line[] {
	return glyphLines(huddlesImpl(...args), args[2].glyphs);
}

export function hallway(...args: Parameters<typeof hallwayImpl>): Line[] {
	return glyphLines(hallwayImpl(...args), args[1].glyphs);
}
