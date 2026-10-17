// The team model: what the views draw, derived from the journal's events.

import type { BullpenEventKind, MemberStatus } from "../../types";

/** One recent thing a teammate did, for the desk card's trail. */
export type TrailStep = {
	at: number;
	kind: BullpenEventKind;
	detail: string;
};

export type Teammate = {
	/** Team name; the key teammates are known by in messages too. */
	name: string;
	/** Loop id, when an event carried one. */
	agentId?: string;
	/** Index into the palette, in order of first appearance. */
	color: number;
	status: MemberStatus;
	/** Idle and silent a while: draw dimmed. Never takes anyone off a huddle. */
	away?: boolean;
	/** The issue this teammate is on, as `nextIssue` attributes it. */
	issue?: number;
	lastActiveAt: number;
	/** The last few steps, oldest first. */
	trail: TrailStep[];
};

/** Teammates gathered around one open issue. */
export type Huddle = {
	issue: number;
	/** Names, in order of first appearance. */
	members: string[];
	/** When someone first took this issue on. */
	startedAt: number;
	/** How many times work on this issue was sent back. */
	kickbacks: number;
	/** The last event that touched this issue or came from someone on it. */
	lastActiveAt: number;
};

export type HallwayMessage = {
	from: string;
	to: string;
	text: string;
	at: number;
	issues: number[];
};

/** A message to the lead that needs an answer. */
export type Ask = HallwayMessage & {
	/** False once the lead has messaged the asker since. */
	open: boolean;
};

/** Work sent back: by a gate failing it, or someone saying so. */
export type Kickback = {
	from: string;
	/** Who it was sent back to, when it was a message. */
	to?: string;
	issue?: number;
	at: number;
	text: string;
};

export type MoraleGlyph = "☀" | "☁" | "☂" | "☇";

export type Morale = {
	/** 0 (the office needs help) to 1 (all good). */
	score: number;
	glyph: MoraleGlyph;
	/** What moved the score, so views can hint ("#204 stalled 20m"). */
	factors: {
		/** Issues closed in the recent window. */
		closes: number;
		/** Kickbacks in the recent window. */
		kickbacks: number;
		openAsks: number;
		/** Issues whose huddle has gone quiet. */
		stalled: number[];
		/** Teammates idle a while though work is still open. */
		idle: string[];
	};
};

export type BullpenModel = {
	teammates: Record<string, Teammate>;
	/** Open issues with someone on them, busiest first. */
	huddles: Huddle[];
	/** Recent messages, oldest first. */
	hallway: HallwayMessage[];
	asks: Ask[];
	kickbacks: Kickback[];
	/** Issues seen closed, in order. */
	closed: number[];
	morale: Morale;
};
