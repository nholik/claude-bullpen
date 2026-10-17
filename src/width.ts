import stringWidth from "./vendor/string-width.js";

const PRINTABLE = /^[\x20-\x7e]*$/;

/** True when `text` is printable ASCII: one cell per character, nothing to check. */
export function printable(text: string): boolean {
	return PRINTABLE.test(text);
}

/**
 * Terminal cells for `text`. Printable ASCII, nearly all of what the pane
 * draws, skips string-width's grapheme and emoji checks.
 */
export function cells(text: string): number {
	if (printable(text)) return text.length;
	const seen = measured.get(text);
	if (seen !== undefined) return seen;
	const width = stringWidth(text);
	if (measured.size >= 2048) measured.clear();
	measured.set(text, width);
	return width;
}

/** Widths of non-ASCII strings: borders and status glyphs repeat every redraw. */
const measured = new Map<string, number>();
