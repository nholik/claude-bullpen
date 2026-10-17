export type BullpenEventKind =
	| "spawn"
	| "turn-start"
	| "turn-end"
	| "tool"
	| "message"
	/** A member left: gone from `$.agent.list()`, or a demo `leave` step. */
	| "leave";

/**
 * One normalized thing that happened on the team, as the journal keeps it.
 * Mirrors `BullpenEventSchema` in `src/journal.ts`, which fails to compile if
 * the two drift apart.
 */
export type BullpenEvent = {
	/** Schema version (`JOURNAL_VERSION`). */
	version: 1;
	/** Milliseconds since the epoch, from `$.clock.now()`. */
	at: number;
	kind: BullpenEventKind;
	/** The loop it happened in; absent for the lead (main loop). */
	agentId?: string;
	/** Who did it, by team name (`lead` for the main loop). */
	who: string;
	/** Tool name for `tool`, recipient for `message`. */
	target?: string;
	/** A short human-readable summary. */
	detail: string;
	/** Issue numbers referenced (`#123`). */
	issues: number[];
};

export type MemberStatus = "running" | "idle" | "gone";

export type Member = {
	/** Loop id, or `lead` for the main loop. */
	id: string;
	name: string;
	status: MemberStatus;
	/** Last issue this member referenced. */
	issue?: number;
	/** Index into the palette; stable for the session. */
	color: number;
	lastActiveAt: number;
};

/** A teammate's role entry in `.claude/bullpen.json`. */
export type ProfileRole = {
	role?: string;
	/** `#rrggbb`, or an index into the floor palette. */
	color?: string | number;
};

/** `.claude/bullpen.json` merged over the defaults (`src/profile.ts`). */
export type Profile = {
	/** A `gh search issues` query string. */
	issueFilter: string;
	/** Teammate name or agent type to role and color. */
	roles: Record<string, ProfileRole>;
	animations: boolean;
	pollSeconds: number;
};

declare module "claude-code" {
	interface PluginState {
		bullpen: {
			events: BullpenEvent[];
			members: Record<string, Member>;
			/** `.claude/bullpen.json` merged over the defaults. */
			profile: Profile;
		};
	}
}
