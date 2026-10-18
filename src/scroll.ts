// Following the tail of a scrolled list: pin to the end until the person
// scrolls up, and pin again when they come back to the bottom.

/** True when a window at `offset` over `contentRows` rows already shows the last row. */
export function atTail(
	offset: number,
	bodyRows: number,
	contentRows: number,
): boolean {
	return offset + bodyRows >= contentRows;
}

/** Names a hallway message's header row; the same message keeps it between draws. */
export function messageKey(m: {
	from: string;
	to: string;
	at: number;
	text: string;
}): string {
	return `msg-${m.at}-${m.from}-${m.to}-${m.text.length}`;
}

/** Where a keyed row starts in the tree. */
export type RowStart = { key: string; row: number };

/** The keyed rows of `lines`, whose first row sits at `base` in the tree. */
export function rowStarts(
	lines: { key?: string }[][],
	base: number,
): RowStart[] {
	return lines.flatMap((line, i) => {
		const key = line[0]?.key;
		return key === undefined ? [] : [{ key, row: base + i }];
	});
}

/**
 * The row to scroll back to when a scrolled-up window's content moved under
 * it: the hallway drops its oldest message at the top once full, so rows
 * shift while `offset` stays. Anchors on the message the window's top row
 * was in before the draw and returns its key when it now starts elsewhere
 * (or the first kept message when it was dropped). Nothing while the window
 * followed the tail, or when nothing moved.
 */
export function reanchor(
	before: RowStart[],
	after: RowStart[],
	offset: number,
	bodyRows: number,
	rowsBefore: number,
): string | undefined {
	if (atTail(offset, bodyRows, rowsBefore)) return undefined;
	const old = before.findLast((s) => s.row <= offset);
	if (!old) return undefined;
	const now = after.find((s) => s.key === old.key);
	if (!now) return after[0]?.key;
	return now.row === old.row ? undefined : now.key;
}
