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
	/** `#rrggbb`, or an index into the palette. */
	color?: string | number;
};

/** `.claude/bullpen.json` merged over the defaults (`src/profile.ts`). */
export type Profile = {
	issues: {
		/** A `gh search issues` query string. */
		filter: string;
		/** Seconds between GitHub polls; at least 15. */
		pollSeconds: number;
	};
	/** Teammate name or agent type to role and color. */
	roles: Record<string, ProfileRole>;
	animations: boolean;
	/** Member colors as 0xRRGGBB, in assignment order. */
	palette: number[];
};

export type GhIssue = {
	number: number;
	title: string;
	state: "open" | "closed";
	labels: string[];
	assignees: string[];
	/** Milliseconds since the epoch; absent while open. */
	closedAt?: number;
};

export type GhStatus =
	| "ok"
	| "missing"
	| "signed-out"
	| "not-github"
	| "rate-limited"
	| "error";

/** One `gh issue list` poll: the issues, or a short reason it failed. */
export type GhResult =
	| {
			status: "ok";
			issues: GhIssue[];
			counts?: { open: number; closed: number };
	  }
	| { status: Exclude<GhStatus, "ok">; message: string };

/** Open and closed counts at one poll. */
export type BurndownPoint = { at: number; open: number; closed: number };

export type GithubSource = {
	/** The last poll's result; absent before the first poll. */
	result?: GhResult;
	/** `owner/name`, once known. */
	repo?: string;
	/** Host resolved by gh repo view; part of stored burndown identity. */
	host?: string;
	filter: string;
	burndown: BurndownPoint[];
	checkedAt: number;
};

declare module "claude-code" {
	interface PluginState {
		bullpen: {
			events: BullpenEvent[];
			members: Record<string, Member>;
			/** `.claude/bullpen.json` merged over the defaults. */
			profile: Profile;
			github: GithubSource;
			hallwaySeenAt: number;
			focus: "" | "floor" | "huddles" | "talk";
			viewTime: number;
			storyIssue: number;
			demoStart: number;
		};
	}
}
