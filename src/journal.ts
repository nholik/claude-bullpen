// The journal: what the team did, as validated `BullpenEvent`s. Kept as a ring
// buffer in `$.state` and appended to `~/.claude/bullpen/<team>/events.jsonl`
// for replay, fixtures and tests.

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
 * The most characters the journal file holds. Past it the oldest lines go, a
 * quarter at a time so a busy team doesn't trim on every write. Well under the
 * 4 MiB `$.fs.read` limit even when every character takes 3 bytes.
 */
export const JOURNAL_MAX_CHARS = 1_000_000;

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

/**
 * `existing` journal text with `lines` appended. When it would pass `max`
 * characters, drops whole lines from the front until it is at most three
 * quarters of `max`.
 */
export function appendCapped(
	existing: string,
	lines: string[],
	max = JOURNAL_MAX_CHARS,
): string {
	if (lines.length === 0) return existing;
	const head =
		existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
	const text = `${head}${lines.join("\n")}\n`;
	if (text.length <= max) return text;
	const keep = Math.floor((max * 3) / 4);
	const cut = text.indexOf("\n", text.length - keep - 1);
	return cut < 0 ? "" : text.slice(cut + 1);
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
 * Where a team's journal goes. Joins with `/`, which Windows accepts too, and
 * drops a trailing separator from `home`.
 */
export function journalPath(home: string, team: string): string {
	return `${home.replace(/[\\/]+$/, "")}/.claude/bullpen/${safeSegment(team)}/events.jsonl`;
}
