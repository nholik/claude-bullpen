// Card widths for the Studio floor: how wide cards are when the team is small,
// and the gentle tween when a change in team size resizes them.

import { easeInOutCubic } from "../anim";

/** A card never grows past this, so lines stay readable on a wide pane. */
export const MAX_CARD_WIDTH = 70;
export const MIN_CARD_WIDTH = 12;
export const CARD_GAP = 2;
export const TWEEN_MS = 400;
/** Redraw rate while a tween runs; the caller owns the timer. */
export const TWEEN_REDRAW_MS = 100;

/** Cards per row: the pane's capacity, but never more than there are cards. */
export function cardsPerRow(across: number, shown: number): number {
	return Math.max(1, Math.min(across, shown));
}

/** Below this many spare columns, a capped card fills its region instead. */
const SLIVER = 8;

/** The width cards settle at once nothing is moving. */
export function settledCardWidth(leftWidth: number, perRow: number): number {
	const n = Math.max(1, perRow);
	const fit = Math.max(
		MIN_CARD_WIDTH,
		Math.floor((leftWidth - (n - 1) * CARD_GAP) / n),
	);
	return fit > MAX_CARD_WIDTH && fit - MAX_CARD_WIDTH < SLIVER
		? fit
		: Math.min(MAX_CARD_WIDTH, fit);
}

export type CardWidthTracker = {
	/**
	 * The width to draw at `now` (the real clock, not the scene's, which replay
	 * clamps), never more than `settled`, so the cards always
	 * fit their row. When a change in `perRow` makes cards wider (the team
	 * shrank) they ease from the width on screen; when it makes them narrower
	 * (the team grew) they snap. A change in `settled` alone (the pane was
	 * resized), a first draw or time running backwards snaps. With animations
	 * off every change snaps.
	 */
	sample(
		perRow: number,
		settled: number,
		now: number,
		animations: boolean,
	): number;
	/**
	 * True while a tween is still inside its duration on the real clock, whether
	 * or not anything sampled since: a detached surface or a pane gone compact
	 * stops being "moving" on time.
	 */
	moving(now: number): boolean;
};

export function createCardWidthTracker(): CardWidthTracker {
	let perRow: number | undefined;
	let settled = 0;
	let lastNow = -Infinity;
	let tween: { from: number; startAt: number } | undefined;
	const valueAt = (now: number): number => {
		if (!tween) return settled;
		const t = (now - tween.startAt) / TWEEN_MS;
		if (!(t < 1)) return settled;
		return Math.round(
			tween.from + (settled - tween.from) * easeInOutCubic(Math.max(0, t)),
		);
	};
	return {
		sample(nextPerRow, nextSettled, now, animations) {
			const rewound = now < lastNow;
			lastNow = now;
			if (perRow === undefined || !animations || rewound) {
				tween = undefined;
			} else if (nextPerRow !== perRow) {
				const from = valueAt(now);
				tween = from >= nextSettled ? undefined : { from, startAt: now };
			} else if (nextSettled !== settled) {
				tween = undefined;
			}
			perRow = nextPerRow;
			settled = nextSettled;
			const width = valueAt(now);
			if (tween && width === settled && now - tween.startAt >= TWEEN_MS)
				tween = undefined;
			return width;
		},
		moving: (now) => tween !== undefined && now - tween.startAt < TWEEN_MS,
	};
}

/** One tracker per surface: surfaces draw at different widths and must not reset each other's tween. */
export function createCardWidthTrackers() {
	const trackers = new Map<string, CardWidthTracker>();
	return {
		for(surface: string): CardWidthTracker {
			let tracker = trackers.get(surface);
			if (!tracker) {
				tracker = createCardWidthTracker();
				trackers.set(surface, tracker);
			}
			return tracker;
		},
		anyMoving: (now: number) =>
			[...trackers.values()].some((t) => t.moving(now)),
		clear: () => trackers.clear(),
	};
}
