import type { BurndownPoint } from "../../types";
import type { BullpenModel, Teammate } from "./types";

const MINUTE = 60_000;

/** Evidence of a possible stall, not a claim about the agent's reasoning. */
export function stuckReasons(
	model: BullpenModel,
	now: number,
): Record<string, string> {
	const reasons: Record<string, string> = {};
	for (const t of Object.values(model.teammates)) {
		if (
			t.status === "gone" ||
			(t.issue !== undefined && model.closed.includes(t.issue))
		)
			continue;
		const ship = model.ship.find((p) => p.issue === t.issue);
		if (ship?.stage === "merged" || ship?.stage === "shipped") continue;
		const quiet = Math.max(
			0,
			Math.floor((now - (t.lastProgressAt ?? t.lastActiveAt)) / MINUTE),
		);
		const idle = Math.max(0, Math.floor((now - t.lastActiveAt) / MINUTE));
		const reviewAge = ship
			? Math.max(0, Math.floor((now - ship.at) / MINUTE))
			: 0;
		const kickbacks = model.kickbacks.filter(
			(k) => t.issue !== undefined && k.issue === t.issue && k.at <= now,
		);
		const reason =
			(t.failureCount ?? 0) >= 3
				? `same command failed ${t.failureCount} times`
				: kickbacks.length >= 2 && ship?.stage !== "approved"
					? `sent back ${kickbacks.length} times`
					: ship?.stage === "in-review" && reviewAge >= 15
						? `review waiting ${reviewAge}m`
						: t.status === "running" && quiet >= 10
							? `no tool progress ${quiet}m`
							: t.status === "idle" && t.issue !== undefined && idle >= 5
								? `idle with open work ${idle}m`
								: undefined;
		if (reason) reasons[t.name] = reason;
	}
	return reasons;
}

export function activeTime(t: Teammate, now: number): number {
	return (
		(t.activeMs ?? 0) +
		(t.turnStartedAt === undefined ? 0 : Math.max(0, now - t.turnStartedAt))
	);
}

/** Net counts only: closures include reopened/moved work, so never call this "created". */
export function backlogTrend(
	series: readonly BurndownPoint[],
): { delta: number; minutes: number } | undefined {
	const last = series.at(-1);
	if (!last) return undefined;
	const first = series.find((p) => p.at >= last.at - 60 * MINUTE) ?? series[0];
	if (!first || last.at - first.at < MINUTE) return undefined;
	return {
		delta: last.open - first.open,
		minutes: Math.round((last.at - first.at) / MINUTE),
	};
}

/** Describe pressure and spare capacity without grading useful conversation. */
export function flowSummary(
	model: BullpenModel,
	series: readonly BurndownPoint[],
	now: number,
): { text: string; pressure: boolean } {
	const team = Object.values(model.teammates).filter(
		(t) => t.status !== "gone",
	);
	const working = team.filter((t) => t.status === "running").length;
	const reviews = model.ship.filter(
		(p) => p.stage === "in-review" || p.stage === "pr-open",
	).length;
	const idle = team.filter(
		(t) => t.status === "idle" && !model.stuck?.[t.name],
	).length;
	const stuck = Object.keys(model.stuck ?? {}).length;
	const trend = backlogTrend(series);
	const parts = [`${working} working`];
	if (stuck)
		parts.push(`${stuck} possible ${stuck === 1 ? "stall" : "stalls"}`);
	if (reviews) parts.push(`${reviews} awaiting review`);
	if (reviews >= 2 && idle) parts.push(`${idle} idle · consider review help`);
	else if (idle) parts.push(`${idle} idle`);
	if (trend)
		parts.push(
			`backlog ${trend.delta > 0 ? "+" : ""}${trend.delta} / ${trend.minutes}m`,
		);
	const handoffs = model.hallway.filter(
		(m) =>
			m.at <= now &&
			now - m.at < 5 * MINUTE &&
			team.some((t) => t.name === m.from) &&
			team.some((t) => t.name === m.to),
	).length;
	if (handoffs)
		parts.push(
			`${handoffs} team ${handoffs === 1 ? "message" : "messages"} / 5m`,
		);
	return {
		text: parts.join(" · "),
		pressure: stuck > 0 || reviews >= 3 || (trend?.delta ?? 0) > 0,
	};
}
