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

const QUOTE = /^> re(?: #(\d+))?: (.*)$/gm;
/** Case and whitespace folded: what makes two decision texts the same. */
export const plain = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The ids of the open decisions a submitted prompt quotes (`> re #N: text`, as
 * Enter fills it). Per quote: with a `#N`, only decisions on #N are candidates.
 * An exact text match wins; else a prefix match (either way) counts only when it
 * is the single candidate matching; else an edited body still names the one
 * decision on #N, but only when the body matches nothing in the whole open set
 * (a body quoting a decision on another issue closes nothing here).
 * Anything ambiguous closes nothing, and so does an unquoted prompt.
 */
export function repliedTo(
	text: string,
	open: readonly { id: string; text: string; issues: readonly number[] }[],
): string[] {
	const ids: string[] = [];
	for (const m of text.matchAll(QUOTE)) {
		const body = plain(m[2] ?? "");
		const ref = m[1] ? Number(m[1]) : undefined;
		const pool =
			ref === undefined ? open : open.filter((d) => d.issues[0] === ref);
		const exact = body === "" ? [] : pool.filter((d) => plain(d.text) === body);
		const near = (d: { text: string }) => {
			const t = plain(d.text);
			return body !== "" && (t.startsWith(body) || body.startsWith(t));
		};
		const prefix = pool.filter(near);
		const quotesElsewhere =
			body !== "" && open.some((d) => plain(d.text) === body || near(d));
		const found = exact.length
			? exact
			: prefix.length === 1
				? prefix
				: ref !== undefined && pool.length === 1 && !quotesElsewhere
					? pool
					: [];
		for (const d of found) if (!ids.includes(d.id)) ids.push(d.id);
	}
	return ids;
}

/** Moves a cursor by `by`, kept inside a list of `length`. */
export function moveCursor(cursor: number, by: number, length: number): number {
	return length < 1 ? 0 : Math.min(length - 1, Math.max(0, cursor + by));
}
