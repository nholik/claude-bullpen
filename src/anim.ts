// Pure animation math. The caller supplies timestamps and owns redraws/timers.

export type Ease = (progress: number) => number;

export const linear: Ease = (t) => t;
export const easeInOutCubic: Ease = (t) =>
	t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOutBack: Ease = (t) => {
	const overshoot = 1.70158;
	return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
};

export type Tween = {
	id: string;
	from: number;
	to: number;
	durationMs: number;
	startAt: number;
	ease?: Ease;
};

function finite(value: number): void {
	if (!Number.isFinite(value))
		throw new RangeError("Animation values must be finite");
}

function duration(value: number): void {
	finite(value);
	if (value < 0) throw new RangeError("Animation duration must be nonnegative");
}

function valueAt(tween: Tween, now: number): number {
	if (now < tween.startAt) return tween.from;
	// Exact endpoints, including instantaneous tweens, independent of easing.
	if (now >= tween.startAt + tween.durationMs) return tween.to;
	if (now === tween.startAt) return tween.from;
	const t = (now - tween.startAt) / tween.durationMs;
	return tween.from + (tween.to - tween.from) * (tween.ease ?? linear)(t);
}

/**
 * IDs replace earlier tweens. Samples include scheduled starting values and
 * completed final values until explicitly pruned. `active` includes scheduled
 * work, so a caller's animation clock doesn't stop before a delayed start.
 */
export function createTweens() {
	const tweens = new Map<string, Tween>();
	return {
		add(tween: Tween): void {
			finite(tween.from);
			finite(tween.to);
			finite(tween.startAt);
			duration(tween.durationMs);
			finite(tween.startAt + tween.durationMs);
			tweens.set(tween.id, { ...tween });
		},
		sample(now: number): Map<string, number> {
			finite(now);
			return new Map(
				[...tweens].map(([id, tween]) => [id, valueAt(tween, now)]),
			);
		},
		active(now: number): boolean {
			finite(now);
			return [...tweens.values()].some(
				(tween) => now < tween.startAt + tween.durationMs,
			);
		},
		prune(now: number): void {
			finite(now);
			for (const [id, tween] of tweens)
				if (now >= tween.startAt + tween.durationMs) tweens.delete(id);
		},
	};
}

export type Point = { x: number; y: number };

/** Straight path; permits eased overshoot rather than clamping its progress. */
export function lerpPoint(from: Point, to: Point, progress: number): Point {
	return {
		x: from.x + (to.x - from.x) * progress,
		y: from.y + (to.y - from.y) * progress,
	};
}

/** A change starts bright and fades smoothly to zero over one minute. */
export function glow(
	now: number,
	startAt: number,
	durationMs = 60_000,
): number {
	finite(now);
	finite(startAt);
	duration(durationMs);
	if (now < startAt || durationMs === 0) return 0;
	const remaining = Math.max(0, 1 - (now - startAt) / durationMs);
	return remaining * remaining;
}
