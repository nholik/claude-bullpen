import type { ReadyPr } from "../../types";
import { mix } from "../color";
import { SHOWN } from "../decisions";
import type { Decision } from "../model/types";
import { age, section, text } from "./layout";
import { fit, type Line, textLine, wrapText } from "./lines";
import { STUDIO } from "./studio";

/** The first decision pulses this long after it is raised, then holds steady. */
export const PULSE_MS = 10_000;
/** One breath of the pulse. */
const BREATH_MS = 1200;
/** Context lines shown under a decision in the list. */
const CONTEXT_LINES = 3;

/** True while the first decision is young enough to pulse. */
export function pulsing(queue: readonly Decision[], now: number): boolean {
	const first = queue[0];
	return first !== undefined && now - first.at < PULSE_MS;
}

/** Amber, swelling toward a warmer one for `PULSE_MS`; plain amber after. */
export function pulseColor(at: number, now: number): number {
	if (now - at >= PULSE_MS) return STUDIO.amber;
	const phase = ((now - at) % BREATH_MS) / BREATH_MS;
	return mix(STUDIO.amber, 0xfff0cf, 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI));
}

const refs = (d: Decision) => d.issues.map((n) => `#${n}`).join(" ");

/** First under the header: up to three decisions for the person, or nothing at all. */
export function needsYou(
	queue: readonly Decision[],
	columns: number,
	now = 0,
	ready: readonly ReadyPr[] = [],
): Line[] {
	const lines: Line[] = queue.slice(0, SHOWN).map((d, i) =>
		fit(
			[
				{
					text: ` ! NEEDS YOU · ${age(now, d.at)} · ${d.text}`,
					fg: i === 0 ? pulseColor(d.at, now) : STUDIO.amber,
					bg: STUDIO.panel,
					bold: i === 0,
				},
			],
			columns,
		),
	);
	if (queue.length > SHOWN)
		lines.push(
			textLine(` +${queue.length - SHOWN} more · n lists them`, columns),
		);
	const mergeable = ready.filter((pr) => !pr.codexPending).length;
	if (mergeable)
		lines.push(
			fit(
				[
					{
						text: ` ✓ ${mergeable} merge-ready · n lists ${mergeable === 1 ? "it" : "them"}`,
						fg: STUDIO.mint,
						bg: STUDIO.panel,
					},
				],
				columns,
			),
		);
	return lines;
}

/**
 * One merge-ready PR: number and title, the three marks, and what Enter does.
 * While Codex is still reviewing the head the row waits: a muted `…` for codex.
 */
function readyBlock(pr: ReadyPr, i: number, on: boolean, columns: number) {
	const wide = Math.max(1, columns - 3);
	const waiting = pr.codexPending === true;
	const color = on && !waiting ? STUDIO.mint : STUDIO.muted;
	return [
		fit(
			[
				{ text: on ? " ▌ " : "   ", fg: STUDIO.mint, bold: true },
				{
					text: `${i + 1} · ${waiting ? "waiting on codex" : "merge-ready"} · #${pr.number}`,
					fg: STUDIO.muted,
				},
			],
			columns,
		),
		...wrapText(pr.title, wide).map((line) => [
			{ text: "   " },
			...line.map((seg) => ({ ...seg, fg: color, bold: on })),
		]),
		fit(
			[
				{ text: "   " },
				{
					text: waiting ? "gate ✓  codex …  ci ✓" : "gate ✓  codex ✓  ci ✓",
					fg: waiting ? STUDIO.muted : STUDIO.mint,
				},
				{ text: on ? " · enter: copy PR link" : "", fg: STUDIO.muted },
			],
			columns,
		),
		text("", STUDIO.muted),
	];
}

/** One decision as it reads in the `n` view; `on` marks the selected one. */
function block(
	d: Decision,
	i: number,
	on: boolean,
	columns: number,
	now: number,
) {
	const wide = Math.max(1, columns - 3);
	const color = on ? pulseColor(d.at, now) : STUDIO.amber;
	const meta = [age(now, d.at), refs(d)].filter(Boolean).join(" · ");
	const wrapped = d.context ? wrapText(d.context, wide) : [];
	const context = wrapped.slice(0, CONTEXT_LINES);
	if (wrapped.length > CONTEXT_LINES && context.length)
		context.push([...fit(context.pop() ?? [], wide - 1), { text: "…" }]);
	return [
		fit(
			[
				{ text: on ? " ▌ " : "   ", fg: color, bold: true },
				{ text: `${i + 1} · ${meta}`, fg: STUDIO.muted },
			],
			columns,
		),
		...wrapText(d.text, wide).map((line) => [
			{ text: "   ", fg: color },
			...line.map((seg) => ({ ...seg, fg: color, bold: on })),
		]),
		...context.map((line) => [
			{ text: "   " },
			...line.map((seg) => ({ ...seg, fg: STUDIO.muted })),
		]),
		text("", STUDIO.muted),
	];
}

/**
 * The `n` view: each decision with the lead's words before it, `cursor`
 * marking one. Shows the run of decisions around the cursor that fits `room`.
 */
export function needsSection(
	queue: readonly Decision[],
	columns: number,
	now: number,
	cursor: number,
	room = Number.POSITIVE_INFINITY,
	ready: readonly ReadyPr[] = [],
): Line[] {
	const total = queue.length + ready.length;
	if (!total)
		return [
			section("NEEDS YOU", columns),
			textLine("Nothing is waiting on you.", columns),
		];
	const at = Math.min(Math.max(0, cursor), total - 1);
	const blocks = [
		...queue.map((d, i) => block(d, i, i === at, columns, now)),
		...ready.map((pr, i) =>
			readyBlock(pr, queue.length + i, queue.length + i === at, columns),
		),
	];
	// Start at the cursor and take earlier decisions while they still fit with
	// it, so the selected one is always on screen; then fill below.
	let first = at;
	let used = 1 + (blocks[at]?.length ?? 0);
	for (; first > 0; first--) {
		const before = blocks[first - 1]?.length ?? 0;
		if (used + before > room) break;
		used += before;
	}
	let last = at + 1;
	for (; last < blocks.length; last++) {
		const after = blocks[last]?.length ?? 0;
		if (used + after > room) break;
		used += after;
	}
	return [
		section(`NEEDS YOU / ${at + 1} of ${total}`, columns),
		...blocks.slice(first, last).flat(),
	];
}
