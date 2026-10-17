import { fit, type Line, width } from "./lines";
import { STUDIO } from "./studio";

export const text = (value: string, fg = STUDIO.text): Line => [
	{ text: value, fg },
];
export function align(left: Line, right: Line, columns: number): Line {
	const tail = fit(right, Math.max(0, columns - 2));
	const head = fit(left, Math.max(0, columns - width(tail) - 1));
	return [
		...head,
		{ text: " ".repeat(Math.max(0, columns - width(head) - width(tail))) },
		...tail,
	];
}
export function section(title: string, columns: number): Line {
	const label = fit(
		[{ text: `─ ${title} `, fg: STUDIO.muted, bold: true }],
		columns,
	);
	return [
		...label,
		{ text: "─".repeat(Math.max(0, columns - width(label))), fg: STUDIO.edge },
	];
}
export function inside(line: Line, columns: number, color = STUDIO.edge): Line {
	const content = fit(line, Math.max(0, columns - 4));
	return [
		{ text: "│ ", fg: color },
		...content,
		{
			text: `${" ".repeat(Math.max(0, columns - 4 - width(content)))} │`,
			fg: color,
		},
	];
}
export function edge(
	columns: number,
	bottom = false,
	color = STUDIO.edge,
): Line {
	return text(
		`${bottom ? "╰" : "╭"}${"─".repeat(Math.max(0, columns - 2))}${bottom ? "╯" : "╮"}`,
		color,
	);
}
export function age(now: number, at: number): string {
	const seconds = Math.max(0, Math.floor((now - at) / 1000));
	// Minute steps: a ticking seconds counter forces a redraw every second.
	return seconds < 60 ? "<1m ago" : `${Math.floor(seconds / 60)}m ago`;
}
export function clock(at: number): string {
	const date = new Date(at);
	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((n) => String(n).padStart(2, "0"))
		.join(":");
}
