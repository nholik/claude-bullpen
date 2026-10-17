import { oneLine } from "../events";
import stringWidth from "../vendor/string-width.js";

export type Seg = {
	text: string;
	fg?: number;
	bg?: number;
	bold?: boolean;
	dim?: boolean;
};
export type Line = Seg[];

export function width(line: Line): number {
	return line.reduce((n, seg) => n + stringWidth(seg.text), 0);
}

/** Clip by terminal cells, preserving each segment's style. */
export function fit(line: Line, columns: number): Line {
	const out: Line = [];
	let left = Math.max(0, Math.floor(columns));
	for (const seg of line) {
		if (!left) break;
		// oneLine trims: preserve intentional spacing between styled segments.
		const flat = seg.text.replace(/[\r\n\t]/g, " ");
		const text = stringWidth(flat) <= left ? flat : oneLine(flat, left);
		out.push({ ...seg, text });
		left -= stringWidth(text);
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
