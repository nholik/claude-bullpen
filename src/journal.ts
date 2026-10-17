// The journal: what the team did, as validated `BullpenEvent`s. Kept as a ring
// buffer in `$.state` and appended to numbered JSONL chunks under
// `~/.claude/bullpen/<team>/` for replay, fixtures and tests.

import type { BullpenEvent as DeclaredEvent } from "../types";
import {
	array,
	type InferOutput,
	integer,
	literal,
	minValue,
	number,
	object,
	optional,
	picklist,
	pipe,
	safeParse,
	string,
} from "./vendor/valibot.js";

/** Bump when an event's shape changes; `readJournal` skips other versions. */
export const JOURNAL_VERSION = 1;

/** How many events `$.state` keeps; older ones live only in the file. */
export const STATE_EVENTS = 300;

/**
 * Lines per journal chunk. `$.fs` can only write whole files, so appending
 * rewrites the current chunk; small chunks keep that cheap.
 */
export const CHUNK_LINES = 500;

/**
 * Chunks kept with content. `$.fs` can't delete, so older ones are emptied
 * rather than removed.
 */
export const MAX_CHUNKS = 20;

export const BullpenEventSchema = object({
	version: literal(JOURNAL_VERSION),
	/** Milliseconds since the epoch, from `$.clock.now()`. */
	at: number(),
	kind: picklist(["spawn", "turn-start", "turn-end", "tool", "message"]),
	/** The loop it happened in; absent for the lead (main loop). */
	agentId: optional(string()),
	/** Who did it, by team name (`lead` for the main loop). */
	who: string(),
	/** Tool name for `tool`, recipient for `message`. */
	target: optional(string()),
	/** A short human-readable summary. */
	detail: string(),
	/** Issue numbers referenced (`#123`). */
	issues: array(pipe(number(), integer(), minValue(1))),
});

export type BullpenEvent = InferOutput<typeof BullpenEventSchema>;

// `types/index.d.ts` declares the same shape for `$.state`; fail to compile
// when the two drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const inSync: Same<BullpenEvent, DeclaredEvent> = true;
void inSync;

/** One journal line per event, without the trailing newline. */
export function toLine(event: BullpenEvent): string {
	return JSON.stringify(event);
}

/**
 * The valid events in JSONL `text`, in order. Blank, malformed, invalid and
 * other-version lines are skipped and counted, so a torn last line or an old
 * file never stops a replay.
 */
export function readJournal(text: string): {
	events: BullpenEvent[];
	skipped: number;
} {
	const events: BullpenEvent[] = [];
	let skipped = 0;
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			skipped++;
			continue;
		}
		const parsed = safeParse(BullpenEventSchema, raw);
		if (parsed.success) events.push(parsed.output);
		else skipped++;
	}
	return { events, skipped };
}

/** A journal chunk: its number and the lines it holds. */
export type Chunk = { index: number; lines: string[] };

/** `events-0001.jsonl` for chunk 1. */
export function chunkName(index: number): string {
	return `events-${String(index).padStart(4, "0")}.jsonl`;
}

/** The chunk number in a file name, or undefined for other files. */
export function chunkIndex(name: string): number | undefined {
	const match = /^events-(\d+)\.jsonl$/.exec(name);
	return match ? Number(match[1]) : undefined;
}

/** The journal chunk file names among `names`, oldest first. */
export function chunkNames(names: readonly string[]): string[] {
	return names
		.flatMap((name) => {
			const index = chunkIndex(name);
			return index === undefined ? [] : [{ name, index }];
		})
		.sort((a, b) => a.index - b.index)
		.map((c) => c.name);
}

/**
 * Appends `lines` to the `current` chunk, starting a new one every `rollAt`
 * lines. Returns the files to write, whole, in order (each touched chunk, and
 * an empty text for any chunk now more than `keep` behind) and the new current
 * chunk.
 */
export function planAppend(
	current: Chunk,
	lines: readonly string[],
	rollAt = CHUNK_LINES,
	keep = MAX_CHUNKS,
): { writes: { name: string; text: string }[]; current: Chunk } {
	const writes: { name: string; text: string }[] = [];
	let chunk: Chunk = { index: current.index, lines: [...current.lines] };
	let isDirty = false;
	for (const line of lines) {
		if (chunk.lines.length >= rollAt) {
			if (isDirty) writes.push(chunkFile(chunk));
			chunk = { index: chunk.index + 1, lines: [] };
			if (chunk.index > keep)
				writes.push({ name: chunkName(chunk.index - keep), text: "" });
		}
		chunk.lines.push(line);
		isDirty = true;
	}
	if (isDirty) writes.push(chunkFile(chunk));
	return { writes, current: chunk };
}

function chunkFile(chunk: Chunk): { name: string; text: string } {
	return { name: chunkName(chunk.index), text: `${chunk.lines.join("\n")}\n` };
}

/** The non-blank lines of a chunk file's text. */
export function chunkLines(text: string): string[] {
	return text.split("\n").filter((line) => line.trim() !== "");
}

/** A team or session name made safe as one path segment. */
export function safeSegment(name: string): string {
	const safe = name.replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "");
	return safe.slice(0, 64) || "session";
}

/** The team name in a teammate address `<name>@<team>`, if there is one. */
export function teamOf(teammateId: string | undefined): string | undefined {
	const at = teammateId?.lastIndexOf("@") ?? -1;
	return at < 0 ? undefined : teammateId?.slice(at + 1) || undefined;
}

/**
 * The folder a team's journal chunks go in. Joins with `/`, which Windows
 * accepts too, and drops a trailing separator from `home`.
 */
export function journalDir(home: string, team: string): string {
	return `${home.replace(/[\\/]+$/, "")}/.claude/bullpen/${safeSegment(team)}`;
}
