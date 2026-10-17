export type BullpenEventKind =
	| "spawn"
	| "turn-start"
	| "turn-end"
	| "tool"
	| "message";

/** One normalized thing that happened on the team, as the journal keeps it. */
export type BullpenEvent = {
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

declare module "claude-code" {
	interface PluginState {
		bullpen: {
			events: BullpenEvent[];
			members: Record<string, Member>;
		};
	}
}
