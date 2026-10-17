// Office morale: one number and a weather glyph for how the team is doing.

import type { TeamState } from "./team";
import type { Huddle, Morale, MoraleGlyph } from "./types";

const MINUTE = 60_000;
/** Closes and kickbacks count toward morale for this long. */
export const RECENT_MS = 60 * MINUTE;
/** A huddle with no activity for this long has stalled. */
export const STALL_MS = 20 * MINUTE;
/** A teammate idle this long while work is open is waiting on someone. */
export const IDLE_MS = 5 * MINUTE;

/** Where a team with nothing good or bad going on sits. */
const BASE = 0.7;
const WEIGHTS = {
	close: 0.1,
	kickback: 0.12,
	openAsk: 0.12,
	stalled: 0.1,
	idle: 0.05,
};
/** Closes beyond this many don't lift morale further. */
const MAX_CLOSES = 3;

export function moraleGlyph(score: number): MoraleGlyph {
	if (score >= 0.7) return "☀";
	if (score >= 0.5) return "☁";
	if (score >= 0.3) return "☂";
	return "☇";
}

/**
 * Morale at `now`: recent closes lift it; recent kickbacks, unanswered asks,
 * stalled huddles and teammates idling while work is open pull it down.
 */
export function moraleOf(
	state: TeamState,
	huddles: readonly Huddle[],
	now: number,
	leads: readonly string[],
): Morale {
	const recent = (at: number) => now - at <= RECENT_MS;
	const closes = state.closes.filter((c) => recent(c.at)).length;
	const kickbacks = state.kickbacks.filter((k) => recent(k.at)).length;
	const openAsks = state.asks.filter((a) => a.open).length;
	const stalled = huddles
		.filter((h) => now - h.lastActiveAt > STALL_MS)
		.map((h) => h.issue);
	const idle =
		huddles.length === 0
			? []
			: Object.values(state.teammates)
					.filter(
						(t) =>
							t.status === "idle" &&
							!leads.includes(t.name) &&
							now - t.lastActiveAt > IDLE_MS,
					)
					.map((t) => t.name);

	const raw =
		BASE +
		WEIGHTS.close * Math.min(closes, MAX_CLOSES) -
		WEIGHTS.kickback * kickbacks -
		WEIGHTS.openAsk * openAsks -
		WEIGHTS.stalled * stalled.length -
		WEIGHTS.idle * idle.length;
	const score = Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
	return {
		score,
		glyph: moraleGlyph(score),
		factors: { closes, kickbacks, openAsks, stalled, idle },
	};
}
