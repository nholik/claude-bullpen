export type BullpenEventKind =
	| "spawn"
	| "turn-start"
	| "turn-end"
	| "tool"
	| "message"
	| "answer"
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
	/** On `spawn`: the agent type the target was spawned as. */
	agentType?: string;
	/** Verified successful foreground gh issue close results. */
	confirmedCloses?: number[];
	/** A completed tool result, never inferred from its command text. */
	outcome?: "ok" | "error";
	/** Original ask timestamp, for an explicitly submitted human answer. */
	replyTo?: number;
	/** The issue this call shows its agent owns (worktree path, new branch, PR). */
	owns?: number;
	/** What `owns` came from. */
	ownedBy?: "worktree" | "pr";
};

export type MemberStatus = "running" | "idle" | "gone";

export type Member = {
	/** Loop id, or `lead` for the main loop. */
	id: string;
	name: string;
	status: MemberStatus;
	/** Last issue this member referenced. */
	issue?: number;
	/** What set `issue` when an explicit source did; prose then can't move it. */
	owned?: "worktree" | "pr" | "brief";
	/** Index into the palette; stable for the session. */
	color: number;
	/** The agent type it was spawned as (`builder`, `Explore`, ...). */
	agentType?: string;
	lastActiveAt: number;
	goneAt?: number;
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
	glyphs: "unicode" | "ascii";
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
	| "sso-required"
	| "network"
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
	/** Directory name of the session's cwd: the header label when no repo resolves. */
	workspace?: string;
	/** Host resolved by gh repo view; part of stored burndown identity. */
	host?: string;
	filter: string;
	burndown: BurndownPoint[];
	checkedAt: number;
	/** Authoritative states of PRs referenced by the observed team. */
	prs?: {
		number: number;
		state: "OPEN" | "CLOSED" | "MERGED";
		checkedAt: number;
		mergedAt?: number;
	}[];
};

export type Decision = {
	from: string;
	at: number;
	text: string;
	agentId?: string;
	issues: number[];
};

export type Replay = {
	events: BullpenEvent[];
	startedAt: number;
	path: string;
};

/** The retained model, independent of the short display journal. Kept in sync by src/model/team.ts. */
export type TeamSnapshot = {
	teammates: Record<
		string,
		{
			name: string;
			agentType?: string;
			agentId?: string;
			color: number;
			status: MemberStatus;
			away?: boolean;
			issue?: number;
			owned?: "worktree" | "pr" | "brief";
			lastActiveAt: number;
			goneAt?: number;
			turns?: number;
			activeMs?: number;
			turnStartedAt?: number;
			lastProgressAt?: number;
			failedCommand?: string;
			failureCount?: number;
			trail: {
				at: number;
				kind: BullpenEventKind;
				detail: string;
				target?: string;
			}[];
		}
	>;
	issueStarted: Record<number, number>;
	issueActive: Record<number, number>;
	hallway: RecordedMessage[];
	asks: (RecordedMessage & { open: boolean; agentId?: string })[];
	kickbacks: {
		from: string;
		to?: string;
		issue?: number;
		at: number;
		text: string;
	}[];
	closes: { issue: number; at: number }[];
	ship: {
		paths: Record<
			number,
			{
				issue: number;
				stage:
					| "working"
					| "pr-open"
					| "in-review"
					| "changes"
					| "approved"
					| "merged"
					| "shipped";
				pr?: number;
				verdict?: "pass" | "changes";
				bounced: boolean;
				codex: boolean;
				at: number;
			}
		>;
		prIssue: Record<number, number>;
	};
};

export type RecordedMessage = {
	from: string;
	to: string;
	text: string;
	at: number;
	issues: number[];
};

declare module "claude-code" {
	interface PluginState {
		bullpen: {
			events: BullpenEvent[];
			teamModel: TeamSnapshot | null;
			/** `MODEL_VERSION` that reduced `teamModel`; 0 when never stamped. */
			modelVersion: number;
			members: Record<string, Member>;
			/** `.claude/bullpen.json` merged over the defaults. */
			profile: Profile;
			github: GithubSource;
			hallwaySeenAt: number;
			focus: "" | "shipping" | "talk";
			viewTime: number;
			storyIssue: number;
			demoStart: number;
			replay: Replay | null;
			decision: Decision | null;
			decisionDraft: string;
			decisionStatus: string;
		};
	}
}
