// The human's needs-you queue: decisions the lead puts to the person, found by
// an explicit `Decision:` line in the lead's final answer. No prose guessing.
import { oneLine } from "./events";

/** How many decisions one turn may queue; more is a lead that is not choosing. */
const PER_TURN = 5;
/** Longest context kept with a decision, in characters. */
const CONTEXT = 280;
/** How many queued decisions the pane lists before "+N more". */
export const SHOWN = 3;

export type Found = { text: string; context: string };

// `Decision: x`, `- Decision: x`, `> **Decision:** x`, `**Decision**: x`.
const LINE =
	/^[\s>*\-•]*(?:\*\*|__)?Decision(?:\*\*|__)?\s*:(?:\*\*|__)?\s*(\S.*)$/;
const FENCE = /^\s*(?:```|~~~)/;

/** The `Decision:` lines of a turn's answer, each with the paragraph before it. */
export function parseDecisions(answer: string): Found[] {
	const lines = answer.replace(/\r\n?/g, "\n").split("\n");
	const out: Found[] = [];
	let fenced = false;
	for (let i = 0; i < lines.length && out.length < PER_TURN; i++) {
		const line = lines[i] ?? "";
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		const text = LINE.exec(line)?.[1]
			?.replace(/(?:\*\*|__)\s*$/, "")
			.trim();
		if (!text) continue;
		out.push({ text: oneLine(text, 400), context: contextBefore(lines, i) });
	}
	return out;
}

/** The paragraph just above line `at`, skipping one blank gap and other Decision lines. */
function contextBefore(lines: readonly string[], at: number): string {
	const para: string[] = [];
	// Each pass moves `i` toward 0, so the walk ends.
	for (let i = at - 1; i >= 0; i--) {
		const line = (lines[i] ?? "").trim();
		if (!line) {
			if (para.length) break;
			continue;
		}
		if (LINE.test(line) || FENCE.test(line)) {
			if (para.length) break;
			continue;
		}
		para.unshift(line);
	}
	return oneLine(para.join(" "), CONTEXT);
}

type Queueable = { id: string; text: string; issues: readonly number[] };

/** The decisions still waiting: open and neither dismissed nor acted on. */
export function waiting<T extends Queueable>(
	decisions: readonly T[],
	handled: readonly string[],
): T[] {
	return decisions.filter((d) => !handled.includes(d.id));
}

/** The first `SHOWN` and how many more there are. */
export function capped<T>(
	queue: readonly T[],
	shown = SHOWN,
): { shown: T[]; more: number } {
	return {
		shown: queue.slice(0, shown),
		more: Math.max(0, queue.length - shown),
	};
}

/** The text Enter puts in the prompt: a quote the person answers under. */
export function quotedPrefix(d: Queueable): string {
	const ref = d.issues.length ? ` #${d.issues[0]}` : "";
	return `> re${ref}: ${d.text}\n`;
}

/** Moves a cursor by `by`, kept inside a list of `length`. */
export function moveCursor(cursor: number, by: number, length: number): number {
	return length < 1 ? 0 : Math.min(length - 1, Math.max(0, cursor + by));
}
