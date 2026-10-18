// The collector's pure half: hooks turn engine events into `CollectOp`s, a
// `Batcher` holds them for ~100 ms, and `applyBatch` folds a whole batch into
// the members map and new journal events in one pass, so a flush is one state
// write per atom instead of several per event.

import type { BullpenEventKind, Member, MemberStatus } from "../types";
import { DEMO_PREFIX } from "./demo";
import { issueRefs, nextIssue } from "./events";
import { type BullpenEvent, JOURNAL_VERSION } from "./journal";
import { claimOwner, type Own, type OwnSource } from "./ownership";

export const LEAD = "lead";

/** How long events wait before they are written to `$.state`. */
export const FLUSH_MS = 250;

/** Denials and background starts are not completed command results. */
export function toolOutcome(value: unknown): "ok" | "error" | undefined {
	if (
		!value ||
		typeof value !== "object" ||
		("deny" in value && value.deny !== undefined)
	)
		return undefined;
	if ("isError" in value && value.isError === true) return "error";
	if (!("result" in value) || !value.result || typeof value.result !== "object")
		return undefined;
	const result = value.result as Record<string, unknown>;
	if (
		result.interrupted ||
		result.backgroundTaskId ||
		result.backgroundedByUser ||
		result.backgroundedByTurnAbort ||
		result.backgroundedToDeliverMessage ||
		result.timedOutAfterMs
	)
		return undefined;
	return result.interrupted === false ? "ok" : undefined;
}

export type MemberPatch = {
	name?: string;
	agentType?: string;
	status?: MemberStatus;
	issue?: number;
	owned?: OwnSource;
};

/** An agent as `$.agent.list()` reports it, reduced to what reconcile reads. */
export type ListedAgent = {
	id: string;
	name?: string;
	description: string;
	status: string;
	teammateId?: string;
};

export type CollectOp =
	/** Marks a member active now, creating it if new. */
	| { op: "touch"; at: number; id: string; patch: MemberPatch }
	/** Records an event and moves its member by the issues it references. */
	| {
			op: "event";
			at: number;
			kind: BullpenEventKind;
			/** The loop it happened in; absent for the lead. */
			agentId?: string;
			detail: string;
			target?: string;
			/** Extra text scanned for issue refs alongside `detail`. */
			text?: string;
			confirmedCloses?: number[];
			/** The owner this call shows (worktree, branch or PR). */
			owns?: Own;
			outcome?: "ok" | "error";
			replyTo?: number;
			/** On `spawn`: the agent type the target was spawned as. */
			agentType?: string;
			/** False to leave the member's issue as it is. */
			attribute: boolean;
	  }
	/**
	 * Syncs status with `$.agent.list()`. Members no longer listed are gone,
	 * with a `leave` event the first time.
	 */
	| { op: "reconcile"; at: number; listed: ListedAgent[] }
	/** Removes every demo member. */
	| { op: "clear-demo" }
	/** Rebuilds the reduced team state from the event window; no member change. */
	| { op: "rebuild" };

/** An `Own` as the journal stores it: only worktree and PR sources are observed. */
function ownedBy(own: Own): "worktree" | "pr" {
	return own.by === "pr" ? "pr" : "worktree";
}

function touched(
	all: Record<string, Member>,
	id: string,
	patch: MemberPatch,
	at: number,
): Member {
	const prev = all[id];
	return {
		id,
		name: patch.name ?? prev?.name ?? (id === LEAD ? LEAD : id.slice(0, 8)),
		status: patch.status ?? prev?.status ?? "running",
		issue: patch.issue ?? prev?.issue,
		owned:
			(patch.status ?? prev?.status) === "gone"
				? undefined
				: patch.issue === undefined
					? prev?.owned
					: patch.owned,
		agentType: patch.agentType ?? prev?.agentType,
		color: prev?.color ?? Object.keys(all).length,
		lastActiveAt: at,
		goneAt:
			(patch.status ?? prev?.status) === "gone"
				? (prev?.goneAt ?? at)
				: undefined,
	};
}

function reconciled(
	all: Record<string, Member>,
	listed: ListedAgent[],
	at: number,
): { members: Record<string, Member>; left: Member[] } {
	const next = { ...all };
	const left: Member[] = [];
	for (const agent of listed) {
		const prev = next[agent.id];
		if (!prev && !agent.teammateId) continue;
		next[agent.id] = {
			id: agent.id,
			name: agent.name ?? prev?.name ?? agent.description,
			status: agent.status === "running" ? "running" : "idle",
			issue: prev?.issue,
			owned: prev?.owned,
			agentType: prev?.agentType,
			color: prev?.color ?? Object.keys(next).length,
			lastActiveAt: prev?.lastActiveAt ?? at,
		};
	}
	for (const [id, member] of Object.entries(next)) {
		const isDemo = id.startsWith(DEMO_PREFIX);
		if (id === LEAD || isDemo || listed.some((a) => a.id === id)) continue;
		if (member.status !== "gone") left.push(member);
		next[id] = { ...member, status: "gone", goneAt: member.goneAt ?? at };
	}
	return { members: next, left };
}

/**
 * Applies `ops` in order to `members`. Each event's `who` is the member's name
 * at that point in the batch, so a join and its first event can share one.
 */
export function applyBatch(
	members: Record<string, Member>,
	ops: readonly CollectOp[],
): { members: Record<string, Member>; events: BullpenEvent[] } {
	let all = members;
	const events: BullpenEvent[] = [];
	for (const op of ops) {
		switch (op.op) {
			case "touch":
				all = { ...all, [op.id]: touched(all, op.id, op.patch, op.at) };
				break;
			case "reconcile": {
				const out = reconciled(all, op.listed, op.at);
				all = out.members;
				for (const member of out.left)
					events.push({
						version: JOURNAL_VERSION,
						at: op.at,
						kind: "leave",
						agentId: member.id,
						who: member.name,
						detail: `${member.name} left`,
						issues: [],
					});
				break;
			}
			case "rebuild":
				break;
			case "clear-demo":
				all = Object.fromEntries(
					Object.entries(all).filter(([id]) => !id.startsWith(DEMO_PREFIX)),
				);
				break;
			case "event": {
				// A claim-only event is journaled when it changes the owner, so
				// repeated writes in one worktree add nothing.
				if (op.owns) {
					const id = op.agentId ?? LEAD;
					const claim =
						id !== LEAD ? claimOwner(all[id]?.owned, op.owns) : undefined;
					const current = all[id];
					if (
						!claim ||
						(claim.issue === current?.issue && claim.by === current.owned)
					)
						break;
				}
				const id = op.agentId ?? LEAD;
				const issues = issueRefs(
					op.owns || (op.kind === "tool" && op.target === "Bash")
						? (op.text ?? "")
						: `${op.detail} ${op.text ?? ""}`,
				);
				events.push({
					version: JOURNAL_VERSION,
					at: op.at,
					kind: op.kind,
					agentId: op.agentId,
					who: all[id]?.name ?? (op.agentId ? op.agentId.slice(0, 8) : LEAD),
					target: op.target,
					detail: op.detail,
					issues,
					outcome: op.outcome,
					replyTo: op.replyTo,
					...(op.owns
						? { owns: op.owns.issue, ownedBy: ownedBy(op.owns) }
						: {}),
					...(op.agentType ? { agentType: op.agentType } : {}),
					...(op.confirmedCloses
						? { confirmedCloses: op.confirmedCloses }
						: {}),
				});
				// An explicit owner wins; prose can't move a member off it. The lead
				// reads and reviews worktrees, so it never takes one.
				const claim =
					id !== LEAD && op.owns
						? claimOwner(all[id]?.owned, op.owns)
						: undefined;
				const issue = claim
					? claim.issue
					: op.attribute &&
							!all[id]?.owned &&
							op.kind !== "leave" &&
							op.kind !== "answer"
						? nextIssue(op.kind, all[id]?.issue, issues)
						: undefined;
				const patch =
					issue === undefined
						? {}
						: { issue, owned: claim?.by ?? all[id]?.owned };
				all = { ...all, [id]: touched(all, id, patch, op.at) };
				break;
			}
		}
	}
	return { members: all, events };
}

/** Schedules `fn` once after `ms`, like `$.clock.after`. */
export type Schedule = (ms: number, fn: () => void) => void;

/**
 * Collects items and hands them to `flush` together, at most once per `ms`.
 * Flushes run one at a time in order; a failed flush drops its items rather
 * than throwing into a hook.
 */
export class Batcher<T> {
	#pending: T[] = [];
	#isScheduled = false;
	#chain: Promise<void> = Promise.resolve();
	readonly #ms: number;
	readonly #schedule: Schedule;
	readonly #flush: (items: T[]) => Promise<void>;

	constructor(
		ms: number,
		schedule: Schedule,
		flush: (items: T[]) => Promise<void>,
	) {
		this.#ms = ms;
		this.#schedule = schedule;
		this.#flush = flush;
	}

	push(item: T): void {
		this.#pending.push(item);
		if (this.#isScheduled) return;
		this.#isScheduled = true;
		this.#schedule(this.#ms, () => void this.drain());
	}

	/** Flushes whatever is pending now; resolves once it is written. */
	drain(): Promise<void> {
		this.#isScheduled = false;
		const items = this.#pending.splice(0);
		if (items.length > 0)
			this.#chain = this.#chain.then(() => this.#flush(items)).catch(() => {});
		return this.#chain;
	}
}

/** Tracks whole producer chains before shutdown drains their destination batchers. */
export class InFlight {
	readonly #pending = new Set<Promise<unknown>>();

	track<T>(work: Promise<T>): Promise<T> {
		this.#pending.add(work);
		const settled = () => this.#pending.delete(work);
		// Handle both outcomes without creating an unhandled rejecting cleanup chain.
		void work.then(settled, settled);
		return work;
	}

	/** Includes work registered while an earlier producer is settling. */
	async drain(): Promise<void> {
		while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
	}
}
