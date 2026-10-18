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
