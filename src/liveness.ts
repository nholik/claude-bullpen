// Pure pacing for the liveness check, so the timer rules are testable.

/** A recheck lands this long after the grace window closes. */
export const RECHECK_MARGIN_MS = 250;

/**
 * Milliseconds until the view timer should be rechecked, or undefined when it
 * is already past its grace (restart it now). A heartbeat inside the grace
 * window looks alive, but if its timer was cancelled by a reload nothing would
 * look again until a tool call; this says when to look once more.
 */
export function recheckDelay(
	at: number,
	lastBeatAt: number,
	lastTimerStartAt: number,
	graceMs: number,
): number | undefined {
	const age = at - Math.max(lastBeatAt, lastTimerStartAt);
	if (age > graceMs) return undefined;
	return Math.max(0, graceMs - age) + RECHECK_MARGIN_MS;
}
