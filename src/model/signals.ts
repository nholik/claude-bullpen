import type { BurndownPoint } from "../../types";
import { isReviewer } from "./detect";
import type { ShipPath } from "./ship";
import type { BullpenModel, Teammate } from "./types";

const MINUTE = 60_000;

/** Reviewers and designers finish by reporting a verdict; idle afterwards is done. */
export function isVerdictRole(t: Teammate, role: string | undefined): boolean {
	return (
		isReviewer(t.name, role ?? t.agentType) ||
		/designer|reviewer/i.test(role ?? t.agentType ?? "")
	);
}

/**
 * The ship path for the teammate's issue. Messages say "PR #121" as often as
 * "#121", so a teammate's issue may really be a PR number: match that too.
 */
function shipOf(model: BullpenModel, t: Teammate): ShipPath | undefined {
	if (t.issue === undefined) return undefined;
	return (
		model.ship.find((p) => p.issue === t.issue) ??
		model.ship.find((p) => p.pr === t.issue)
	);
}

/** An open PR (not yet merged) on the issue: its owner is waiting, not stalled. */
export function waitingStage(
	model: BullpenModel,
	t: Teammate,
): "review" | "merge" | undefined {
	const ship = shipOf(model, t);
	if (ship?.stage === "approved") return "merge";
	if (ship?.stage === "pr-open" || ship?.stage === "in-review") return "review";
	return undefined;
}

/** Idle builders with an open PR; running teammates and verdict roles never wait. */
export function waitingOn(
	model: BullpenModel,
	t: Teammate,
	role?: string,
): "review" | "merge" | undefined {
	if (t.status !== "idle" || isVerdictRole(t, role)) return undefined;
	return waitingStage(model, t);
}

/** Evidence of a possible stall, not a claim about the agent's reasoning. */
export function stuckReasons(
	model: BullpenModel,
	now: number,
	roles: Readonly<Record<string, string>> = {},
): Record<string, string> {
	const reasons: Record<string, string> = {};
	for (const t of Object.values(model.teammates)) {
		if (
			t.status === "gone" ||
			(t.issue !== undefined && model.closed.includes(t.issue))
		)
			continue;
		// Said it was done, then ended its turn: finished, not stuck.
		if (t.status === "idle" && t.reportedDone) continue;
		const ship = shipOf(model, t);
		if (ship?.stage === "merged" || ship?.stage === "shipped") continue;
		const quiet = Math.max(
			0,
			Math.floor((now - (t.lastProgressAt ?? t.lastActiveAt)) / MINUTE),
		);
		const idle = Math.max(0, Math.floor((now - t.lastActiveAt) / MINUTE));
		const kickbacks = model.kickbacks.filter(
			(k) => t.issue !== undefined && k.issue === t.issue && k.at <= now,
		);
		const verdictRole = isVerdictRole(t, roles[t.name]);
		const waiting = waitingOn(model, t, roles[t.name]) !== undefined;
		// A bounced builder usually waits for the lead to route the fix.
		const idleLimit = ship?.stage === "changes" ? 15 : 5;
		const reason =
			(t.failureCount ?? 0) >= 3
				? `same command failed ${t.failureCount} times`
				: kickbacks.length >= 2 && ship?.stage !== "approved"
					? `sent back ${kickbacks.length} times`
					: t.status === "running" && quiet >= 10
						? `no tool progress ${quiet}m`
						: t.status === "idle" &&
								t.issue !== undefined &&
								idle >= idleLimit &&
								!verdictRole &&
								!waiting
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
