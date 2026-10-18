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
/** A card squeezed beside a shrinking neighbour wraps below this width. */
const SQUEEZE_MIN = 16;

/** Cards per row: the pane's capacity, but never more than there are cards. */
export function cardsPerRow(across: number, shown: number): number {
	return Math.max(1, Math.min(across, shown));
}

/** The width cards settle at once nothing is moving. */
export function settledCardWidth(leftWidth: number, perRow: number): number {
	const n = Math.max(1, perRow);
	return Math.min(
		MAX_CARD_WIDTH,
		Math.max(MIN_CARD_WIDTH, Math.floor((leftWidth - (n - 1) * CARD_GAP) / n)),
	);
}

/**
 * Per-row card widths for `count` cards. At rest every card is `width` wide.
 * Mid-tween, while a growing team's cards have not shrunk enough to sit side
 * by side, a card takes the space left in its row, or wraps to the next row
 * when that is too little. Each pass places at least one card, so `left`
 * shrinks every time round.
 */
export function packRows(
	count: number,
	perRow: number,
	width: number,
	leftWidth: number,
): number[][] {
	const rows: number[][] = [];
	let left = Math.max(0, count);
	while (left > 0) {
		const row: number[] = [];
		let used = 0;
		while (row.length < perRow && row.length < left) {
			const gap = row.length ? CARD_GAP : 0;
			const w = Math.min(width, leftWidth - used - gap);
			if (row.length && w < SQUEEZE_MIN) break;
			row.push(Math.max(MIN_CARD_WIDTH, w));
			used += gap + w;
		}
		rows.push(row);
		left -= row.length;
	}
	return rows;
}

export type CardWidthTracker = {
	/**
	 * The width to draw at `now`. A change in `perRow` starts a tween from the
	 * width on screen; a change in `settled` alone (the pane was resized), a
	 * first draw or time running backwards snaps. With animations off every
	 * change snaps.
	 */
	sample(
		perRow: number,
		settled: number,
		now: number,
		animations: boolean,
	): number;
	/** True while the last sample was mid-tween: the caller keeps redrawing. */
	moving(): boolean;
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
				tween = from === nextSettled ? undefined : { from, startAt: now };
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
		moving: () => tween !== undefined,
	};
}
