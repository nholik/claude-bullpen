import { oneLine } from "../events";
import { type GlyphMode, glyphText } from "../glyphs";
import { wrapAnsi } from "../vendor/wrap-ansi.js";
import { cells } from "../width";

export type Seg = {
	text: string;
	story?: number;
	agentId?: string;
	/** Names the row this segment starts, so the window can be scrolled back to it. */
	key?: string;
	fg?: number;
	bg?: number;
	bold?: boolean;
	dim?: boolean;
};
export type Line = Seg[];

export function width(line: Line): number {
	return line.reduce((n, seg) => n + cells(seg.text), 0);
}

/** Clip by terminal cells, preserving each segment's style. */
export function fit(line: Line, columns: number): Line {
	const out: Line = [];
	let left = Math.max(0, Math.floor(columns));
	for (const seg of line) {
		if (!left) break;
		// oneLine trims: preserve intentional spacing between styled segments.
		const flat = glyphText(seg.text.replace(/[\r\n\t]/g, " "));
		const text = cells(flat) <= left ? flat : oneLine(flat, left);
		out.push({ ...seg, text: glyphText(text) });
		left -= cells(text);
	}
	return out;
}

export function textLine(text: string, columns: number): Line {
	return fit([{ text }], columns);
}

export function beside(left: Line[], right: Line[], columns: number): Line[] {
	const split = Math.floor((columns - 3) * 0.6);
	return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
		const a = fit(left[i] ?? [], split);
		return [
			...a,
			{ text: `${" ".repeat(split - width(a))} │ `, dim: true },
			...fit(right[i] ?? [], columns - split - 3),
		];
	});
}

export function glyphLines(lines: Line[], mode: GlyphMode = "unicode"): Line[] {
	return lines.map((line) =>
		line.map((seg) => ({ ...seg, text: glyphText(seg.text, mode) })),
	);
}

/** Wrap long words as well as prose; each returned line stays within its cells. */
export function wrapText(text: string, columns: number): Line[] {
	if (columns < 1) return [];
	const safe = text
		.replace(/\r\n?/g, "\n")
		.replace(/\t/g, " ")
		.split("\n")
		.map((line) => glyphText(line))
		.join("\n");
	return wrapAnsi(safe, Math.floor(columns), { hard: true })
		.split("\n")
		.map((line) => textLine(line, columns));
}
