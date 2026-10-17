// The journal: what the team did, as validated `BullpenEvent`s. Kept as a ring
// buffer in `$.state` and appended to numbered JSONL chunks under
// `~/.claude/bullpen/<team>/` for replay, fixtures and tests. Each writer (one
// session, one process) has its own chunks, so teammates running the mod in
// other terminals never overwrite each other; readers merge them by time.

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
 * Characters per journal chunk before the next one starts. `$.fs` can only
 * write whole files, so appending rewrites the current chunk; small chunks
 * keep that cheap.
 */
export const CHUNK_CHARS = 100_000;

/**
 * Chunk files per writer, about 2 MB. They form a ring: after the last one the
 * first is overwritten, since `$.fs` can't delete.
 */
export const MAX_CHUNKS = 20;

export const BullpenEventSchema = object({
	version: literal(JOURNAL_VERSION),
	/** Milliseconds since the epoch, from `$.clock.now()`. */
	at: number(),
	kind: picklist([
		"spawn",
		"turn-start",
		"turn-end",
		"tool",
		"message",
		"leave",
	]),
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

/** A journal chunk: whose it is, its number and the lines it holds. */
export type Chunk = { writer: string; index: number; lines: string[] };

/** `events-<writer>-0001.jsonl` for a writer's chunk 1. */
export function chunkName(writer: string, index: number): string {
	return `events-${safeSegment(writer)}-${String(index).padStart(4, "0")}.jsonl`;
}

/** The writer and number in a chunk file name, or undefined for other files. */
export function parseChunkName(
	name: string,
): { writer: string; index: number } | undefined {
	const match = /^events-(.+)-(\d+)\.jsonl$/.exec(name);
	return match?.[1] === undefined
		? undefined
		: { writer: match[1], index: Number(match[2]) };
}

/**
 * The chunk `writer` wrote last among `entries`, or 0 for none. A ring wraps,
 * so it goes by modification time; one batch can write several chunks in the
 * same millisecond, so among those it takes the end of the run (the one whose
 * successor in the ring isn't among them: 1 over 20 after a wrap).
 */
export function lastChunk(
	entries: readonly { name: string; mtimeMs: number }[],
	writer: string,
	ring = MAX_CHUNKS,
): number {
	const own = safeSegment(writer);
	let newest = -1;
	let tied = new Set<number>();
	for (const { name, mtimeMs } of entries) {
		const chunk = parseChunkName(name);
		if (chunk?.writer !== own) continue;
		if (mtimeMs > newest) {
			newest = mtimeMs;
			tied = new Set();
		}
		if (mtimeMs === newest) tied.add(chunk.index);
	}
	const indexes = [...tied];
	const end = indexes.find((i) => !tied.has((i % ring) + 1));
	return end ?? Math.max(0, ...indexes);
}

/** The journal chunk file names among `names`, by writer and number. */
export function chunkNames(names: readonly string[]): string[] {
	return names
		.flatMap((name) => {
			const chunk = parseChunkName(name);
			return chunk ? [{ name, ...chunk }] : [];
		})
		.sort((a, b) =>
			a.writer === b.writer ? a.index - b.index : a.writer < b.writer ? -1 : 1,
		)
		.map((c) => c.name);
}

/**
 * The valid events in several chunk texts, merged in time order (stable, so
 * one writer's same-millisecond events keep their order). Skipped counts the
 * bad lines across all of them.
 */
export function readChunks(texts: readonly string[]): {
	events: BullpenEvent[];
	skipped: number;
} {
	const events: BullpenEvent[] = [];
	let skipped = 0;
	for (const text of texts) {
		const read = readJournal(text);
		events.push(...read.events);
		skipped += read.skipped;
	}
	events.sort((a, b) => a.at - b.at);
	return { events, skipped };
}

/** The characters a chunk's file holds. */
function chunkSize(lines: readonly string[]): number {
	return lines.reduce((n, line) => n + line.length + 1, 0);
}

/**
 * Appends `lines` to the `current` chunk, starting the next one once a chunk
 * holds `rollAt` characters; after chunk `ring` comes chunk 1 again, its old
 * lines replaced. Returns the files to write, whole, in order, and the new
 * current chunk.
 */
export function planAppend(
	current: Chunk,
	lines: readonly string[],
	rollAt = CHUNK_CHARS,
	ring = MAX_CHUNKS,
): { writes: { name: string; text: string }[]; current: Chunk } {
	const writes: { name: string; text: string }[] = [];
	const { writer } = current;
	let chunk: Chunk = { ...current, lines: [...current.lines] };
	let size = chunkSize(chunk.lines);
	let isDirty = false;
	for (const line of lines) {
		if (size > 0 && size + line.length + 1 > rollAt) {
			if (isDirty) writes.push(chunkFile(chunk));
			chunk = { writer, index: (chunk.index % ring) + 1, lines: [] };
			size = 0;
		}
		chunk.lines.push(line);
		size += line.length + 1;
		isDirty = true;
	}
	if (isDirty) writes.push(chunkFile(chunk));
	return { writes, current: chunk };
}

function chunkFile(chunk: Chunk): { name: string; text: string } {
	return {
		name: chunkName(chunk.writer, chunk.index),
		text: `${chunk.lines.join("\n")}\n`,
	};
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

/** Retention defaults: see `planRetention`. */
export const RETAIN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const RETAIN_SESSIONS = 10;
export const RETAIN_MAX_BYTES = 20_000_000;

/**
 * The chunk files to empty so the journal folder stops growing; `$.fs` can't
 * delete, so an emptied file is one that holds nothing. Sessions are judged
 * whole, by their newest chunk. Never touches `ownWriter`'s files, nor a
 * session active within `minAgeMs` (it may be live in another process). Of the
 * rest, the newest stay while there are at most `keepSessions` of them and their
 * files add up to at most `maxBytes`; once one is cut, every older one is too. Files
 * already empty are skipped.
 */
export function planRetention(
	files: readonly { name: string; mtimeMs: number; size: number }[],
	now: number,
	ownWriter: string,
	opts: { minAgeMs?: number; keepSessions?: number; maxBytes?: number } = {},
): string[] {
	const minAgeMs = opts.minAgeMs ?? RETAIN_MIN_AGE_MS;
	const keepSessions = opts.keepSessions ?? RETAIN_SESSIONS;
	const maxBytes = opts.maxBytes ?? RETAIN_MAX_BYTES;
	const own = safeSegment(ownWriter);
	const sessions = new Map<
		string,
		{ newest: number; bytes: number; names: string[] }
	>();
	for (const file of files) {
		const chunk = parseChunkName(file.name);
		if (!chunk || chunk.writer === own) continue;
		const s = sessions.get(chunk.writer) ?? { newest: 0, bytes: 0, names: [] };
		s.newest = Math.max(s.newest, file.mtimeMs);
		if (file.size > 0) {
			s.bytes += file.size;
			s.names.push(file.name);
		}
		sessions.set(chunk.writer, s);
	}
	const candidates = [...sessions.values()]
		.filter((s) => now - s.newest >= minAgeMs)
		.sort((a, b) => b.newest - a.newest);
	const out: string[] = [];
	let kept = 0;
	let bytes = 0;
	let cut = false;
	for (const s of candidates) {
		if (!cut && kept < keepSessions && bytes + s.bytes <= maxBytes) {
			kept++;
			bytes += s.bytes;
		} else {
			cut = true;
			out.push(...s.names);
		}
	}
	return out;
}
