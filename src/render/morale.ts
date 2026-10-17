import type { BullpenModel } from "../model";

/** One actionable cause, in priority order, only when morale is low. */
export function moraleHint(
	model: BullpenModel,
	now: number,
): string | undefined {
	if (model.morale.score >= 0.5) return undefined;
	const stalled = model.huddles
		.filter((h) => model.morale.factors.stalled.includes(h.issue))
		.sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
	if (stalled)
		return `#${stalled.issue} stalled ${Math.max(0, Math.floor((now - stalled.lastActiveAt) / 60000))}m — check in?`;
	const ask = model.asks.find((a) => a.open);
	if (ask) return `${ask.from} needs you — ${ask.text}`;
	const counts = new Map<number, number>();
	for (const k of model.kickbacks)
		if (k.issue !== undefined && k.at <= now && now - k.at <= 3600000)
			counts.set(k.issue, (counts.get(k.issue) ?? 0) + 1);
	const repeated = [...counts]
		.filter(([, n]) => n >= 2)
		.sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
	if (repeated)
		return `#${repeated[0]} sent back ${repeated[1]} times — pair on it?`;
	const idle = model.morale.factors.idle[0];
	return idle ? `${idle} idle with open work — check in?` : undefined;
}
