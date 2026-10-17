import type { GithubSource, Profile } from "../../types";
import { glow } from "../anim";
import { mix } from "../color";
import { type BullpenModel, isHallwayLive } from "../model";
import { STALL_MS } from "../model/morale";
import { colorFor, colorIndex } from "../profile";
import { fit, type Line, textLine, width } from "./lines";

export function huddles(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): Line[] {
	if (rows < 1) return [];
	const lines = [textLine("── Huddles ──", columns)];
	const sorted = [...model.huddles].sort(
		(a, b) => b.lastActiveAt - a.lastActiveAt || a.issue - b.issue,
	);
	if (!sorted.length)
		return [...lines, textLine("No active huddles", columns)].slice(0, rows);
	let shown = 0;
	for (const h of sorted) {
		const reserve = shown < sorted.length - 1 ? 1 : 0;
		if (lines.length + 3 + reserve > rows) break;
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
		const heading = fit(
			[
				{
					story: h.issue,
					text: `╭ #${h.issue}${title ? ` ${title}` : ""} · ${h.members.length} · ${age}m${h.kickbacks ? ` ↺${h.kickbacks}` : ""} ${activity}${stalled ? " stalled" : ""}`,
					dim: stalled,
					fg: profile.animations
						? mix(0x555555, 0xd8e9ff, glow(now, h.lastActiveAt))
						: 0x777777,
				},
			],
			Math.max(0, columns - 1),
		);
		lines.push([
			...heading,
			{
				text: `${"─".repeat(Math.max(0, columns - width(heading) - 1))}╮`,
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
		lines.push(textLine(`╰${"─".repeat(Math.max(0, columns - 2))}╯`, columns));
		shown++;
	}
	if (shown < sorted.length)
		lines.push(textLine(`+${sorted.length - shown} more huddles`, columns));
	return lines.slice(0, rows);
}

export function hallway(
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
	const lines = [textLine("── Hallway ▾ live ──", columns)];
	if (rows > 1)
		for (const m of model.hallway.slice(-(rows - 1)))
			lines.push(
				fit(
					[
						{
							text: `${m.from} → ${m.to}: `,
							fg: colorFor(m.from, profile, colorIndex(m.from)),
						},
						{ text: m.text },
					],
					columns,
				),
			);
	return lines;
}
