// Pure helpers that turn raw engine event fields into journal-friendly pieces.

import { shellSegments, withoutCd } from "./command";
import { ghTargets } from "./model/detect";
import { cells } from "./width";

const ISSUE_REF = /(?:^|[^\w&])#(\d{1,7})\b/g;

/** Issue numbers referenced as `#123` in `text`, in order, without repeats. */
export function issueRefs(text: string | undefined): number[] {
	if (!text) return [];
	const found: number[] = [];
	for (const match of text.matchAll(ISSUE_REF)) {
		const n = Number(match[1]);
		if (!found.includes(n)) found.push(n);
	}
	return found;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Flattens `text` to one line that fits `max` terminal columns, ending in `…`
 * when cut. Measures display width, so CJK and emoji in issue titles and
 * messages don't push a box's border out.
 */
export function oneLine(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (cells(flat) <= max) return flat;
	let out = "";
	let width = 0;
	for (const { segment } of graphemes.segment(flat)) {
		const w = cells(segment);
		if (width + w > max - 1) break;
		out += segment;
		width += w;
	}
	return `${out}…`;
}

function basename(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

/**
 * A short phrase for what a tool call is doing, from its flattened arguments
 * (`e.command` for Bash, `e.file_path` for Edit, ...).
 */
export function describeTool(
	tool: string,
	args: Record<string, unknown>,
): string {
	const str = (key: string) =>
		typeof args[key] === "string" ? (args[key] as string) : "";
	switch (tool) {
		case "Bash":
			return oneLine(withoutCd(str("command")), 60);
		case "Edit":
		case "Write":
		case "Read":
		case "NotebookEdit":
			return `${tool.toLowerCase()} ${basename(str("file_path") || str("notebook_path"))}`;
		case "TaskCreate":
			return `task: ${oneLine(str("subject"), 50)}`;
		case "TaskUpdate":
			return `task #${str("taskId")} ${str("status") || "updated"}`;
		case "SendMessage":
			return `message → ${str("to")}`;
		case "Agent":
			return `spawn ${str("name") || str("description")}`;
		default:
			return tool;
	}
}

/** All string arguments joined, for issue-ref scanning. */
export function argText(args: Record<string, unknown>): string {
	return Object.values(args)
		.filter((v): v is string => typeof v === "string")
		.join(" ");
}

/**
 * Text scanned for issue refs: the arguments, plus `gh issue <n>` targets.
 *
 * Ownership: running `gh issue view|comment|edit|close|reopen <n>` (ghTargets)
 * says you are working on that issue. A `gh pr <verb> <n>` number is a PR
 * (view, diff, checks, comment, review, merge...), never an issue, so its `#n`
 * is dropped whatever the verb. Only executed commands count: shellSegments
 * ignores quoted text and heredoc bodies, and echo/printf are skipped.
 */
export function toolText(args: Record<string, unknown>): string {
	const command = typeof args.command === "string" ? args.command : "";
	const targets = ghTargets(command).map((n) => `#${n}`);
	const scanned = command
		? shellSegments(command)
				.filter((part) => !/^(?:echo|printf)\b/.test(part))
				.map((part) => part.replace(/^(gh\s+pr\s+\w+\s+)#(\d+)/, "$1$2"))
				.join(" ")
		: argText(args);
	return [scanned, ...targets].join(" ");
}

/**
 * Which issue a teammate is on after an event, given the issues it referenced.
 *
 * Mentions are noisy: acknowledging someone else's issue in a message must not
 * walk you over to their table. So messages only adopt an issue when the
 * teammate has none yet, and work (tool calls, new turns) moves a teammate
 * only when it no longer references the issue it's on.
 */
export function nextIssue(
	kind: "spawn" | "turn-start" | "turn-end" | "tool" | "message",
	current: number | undefined,
	refs: number[],
): number | undefined {
	if (refs.length === 0 || kind === "spawn" || kind === "turn-end")
		return current;
	if (kind === "message") return current ?? refs[0];
	if (current !== undefined && refs.includes(current)) return current;
	return refs[0];
}
