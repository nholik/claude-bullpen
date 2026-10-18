// The team reducer: folds journal events, oldest first, into what the views
// need. Pure and incremental: `applyEvent` per new event, `huddlesOf` and
// `moraleOf` when drawing.

import type {
	BullpenEvent,
	BullpenEventKind,
	GithubSource,
	MemberStatus,
	TeamSnapshot,
} from "../../types";
import { plain } from "../decisions";
import { nextIssue } from "../events";
import { claimOwner } from "../ownership";
import {
	attributableRefs,
	closedIssues,
	isAsk,
	isKickback,
	isReviewer,
	withdrawsAsk,
} from "./detect";
import { applyShip, EMPTY_SHIP, type ShipState } from "./ship";
import type {
	Ask,
	Decision,
	HallwayMessage,
	Huddle,
	Kickback,
	Teammate,
} from "./types";

export type ModelOptions = {
	/** Names that mean the lead, as senders and as recipients. */
	leads?: readonly string[];
	/** Team name → role (`gate`, `ux`, `builder`); unlisted names are their own role. */
	roles?: Readonly<Record<string, string>>;
	/**
	 * Live status by team name (from `$.agent.list()` via the members atom),
	 * which the journal can't know: it overrides what events implied, so
	 * departed teammates (`gone`) leave their huddles and stop counting as idle.
	 */
	present?: Readonly<Record<string, MemberStatus>>;
	/** Agent type by team name, from the members atom; outlives the event window. */
	agentTypes?: Readonly<Record<string, string>>;
	github?: GithubSource;
};

export const DEFAULT_LEADS: readonly string[] = ["lead", "team-lead", "main"];

/** How many steps a teammate's trail keeps. */
export const TRAIL_LENGTH = 3;
/**
 * An idle teammate silent this long is drawn as away. Cosmetic only: silence
 * never takes anyone off a huddle (a stuck huddle should show as stalled);
 * only a `leave` event or live presence does.
 */
export const AWAY_MS = 30 * 60_000;
/** How many hallway messages, asks and kickbacks the state keeps. */
export const KEEP = 50;

export type TeamState = {
	teammates: Record<string, Teammate>;
	/** Issue → when someone first took it on. */
	issueStarted: Record<number, number>;
	/** Issue → the last event that touched it. */
	issueActive: Record<number, number>;
	hallway: HallwayMessage[];
	asks: Ask[];
	/** Decisions the lead put to the person, open until the person's next prompt. */
	decisions: Decision[];
	kickbacks: Kickback[];
	/** Each close seen, in order; an issue appears once. */
	closes: { issue: number; at: number }[];
	/** Each issue's path from PR to merge, from `applyShip`. */
	ship: ShipState;
};

export const EMPTY_TEAM: TeamState = {
	teammates: {},
	issueStarted: {},
	issueActive: {},
	hallway: [],
	asks: [],
	decisions: [],
	kickbacks: [],
	closes: [],
	ship: EMPTY_SHIP,
};

// The plugin contract cannot import code. Fail compilation if its mirrored shape drifts.
const snapshotInSync: [TeamSnapshot] extends [TeamState]
	? [TeamState] extends [TeamSnapshot]
		? true
		: false
	: false = true;
void snapshotInSync;

function keepLast<T>(list: T[], item: T, max: number): T[] {
	return [...list, item].slice(-max);
}

const KINDS: readonly string[] = [
	"spawn",
	"turn-start",
	"turn-end",
	"tool",
	"message",
] satisfies BullpenEventKind[];

function isKnown(kind: string): kind is BullpenEventKind {
	return KINDS.includes(kind);
}

/** Drops a leading `Lead:` style label that only repeats the sender. */
export function stripSender(text: string, who: string, lead: boolean): string {
	const label = /^\s*([\w .-]{1,32}?)\s*:\s+(?=\S)/
		.exec(text)?.[1]
		?.toLowerCase();
	if (!label) return text;
	const names = [who.toLowerCase(), ...(lead ? ["lead", "team-lead"] : [])];
	return names.includes(label) ? text.replace(/^[^:]*:\s+/, "") : text;
}

function isLead(name: string, options: ModelOptions): boolean {
	return (options.leads ?? DEFAULT_LEADS).includes(name);
}

/** The teammate as it stands after `e`, created on first sight. */
function step(
	teammates: Record<string, Teammate>,
	name: string,
	e: BullpenEvent,
	patch: Partial<Teammate>,
): Teammate {
	const prev = teammates[name];
	return {
		name,
		agentId: prev?.agentId,
		agentType: prev?.agentType,
		color: prev?.color ?? Object.keys(teammates).length,
		status: prev?.status ?? "running",
		issue: prev?.issue,
		owned: prev?.owned,
		lastActiveAt: Math.max(prev?.lastActiveAt ?? e.at, e.at),
		trail: prev?.trail ?? [],
		goneAt: prev?.goneAt,
		turns: prev?.turns ?? 0,
		activeMs: prev?.activeMs ?? 0,
		turnStartedAt: prev?.turnStartedAt,
		lastProgressAt: prev?.lastProgressAt,
		failedCommand: prev?.failedCommand,
		failureCount: prev?.failureCount ?? 0,
		...patch,
	};
}

/** Folds one event into the state. Unknown kinds and extra fields are ignored. */
export function applyEvent(
	state: TeamState,
	e: BullpenEvent,
	options: ModelOptions = {},
): TeamState {
	// The person's side of the conversation moves no teammate.
	if (e.kind === "decision" || e.kind === "reply")
		return applyDecision(state, e);
	const teammates = { ...state.teammates };
	const issueStarted = { ...state.issueStarted };
	const issueActive = { ...state.issueActive };
	const refs = e.issues ?? [];
	const take = (issue: number | undefined) => {
		if (issue !== undefined && issueStarted[issue] === undefined)
			issueStarted[issue] = e.at;
	};

	// A claim-only event sets the owner and nothing else: it is no step, no
	// activity and no progress, so it never replaces the real edit or command
	// in the card.
	if (e.owns !== undefined && e.ownedBy) {
		const prev = teammates[e.who];
		const claim = isLead(e.who, options)
			? undefined
			: claimOwner(prev?.owned, { issue: e.owns, by: e.ownedBy });
		if (!claim) return state;
		teammates[e.who] = step(teammates, e.who, e, {
			issue: claim.issue,
			owned: claim.by,
			lastActiveAt: prev?.lastActiveAt ?? e.at,
		});
		take(claim.issue);
		issueActive[claim.issue] = e.at;
		return { ...state, teammates, issueStarted, issueActive };
	}

	// A spawn brings in `target` (a teammate joining reports itself, with no
	// target). Its brief's first issue is the newcomer's, if it has none yet.
	const trailStep = {
		at: e.at,
		kind: e.kind,
		detail: e.detail,
		...(e.kind === "tool" && e.target ? { target: e.target } : {}),
	};
	const spawned = e.kind === "spawn" ? (e.target ?? e.who) : undefined;
	if (spawned !== undefined && spawned !== e.who) {
		const prev = teammates[spawned];
		const issue = prev?.issue ?? refs[0];
		teammates[spawned] = step(teammates, spawned, e, {
			status: "running",
			issue,
			agentType: e.agentType ?? prev?.agentType,
			trail: keepLast(prev?.trail ?? [], trailStep, TRAIL_LENGTH),
		});
		take(issue);
	}

	// Kinds added to the journal later move no one until the model learns them.
	const actor = teammates[e.who];
	const known = isKnown(e.kind);
	let issue = actor?.issue;
	let owned = actor?.owned;
	const claim =
		e.owns !== undefined && e.ownedBy && !isLead(e.who, options)
			? claimOwner(actor?.owned, { issue: e.owns, by: e.ownedBy })
			: undefined;
	if (claim) {
		issue = claim.issue;
		owned = claim.by;
	} else if (spawned === e.who) {
		issue = actor?.issue ?? refs[0];
	} else if (
		known &&
		!actor?.owned &&
		e.kind !== "leave" &&
		e.kind !== "answer"
	)
		issue = nextIssue(e.kind, actor?.issue, attributableRefs(e, refs));
	// A respawn under the same name starts without its predecessor's owner.
	if (e.kind === "leave") owned = undefined;
	let status = actor?.status ?? "running";
	if (known) status = e.kind === "turn-end" ? "idle" : "running";
	// A typed leave event is the journal evidence that a member departed.
	if (e.kind === "leave") status = "gone";
	const ended =
		(e.kind === "turn-end" || e.kind === "leave") &&
		actor?.turnStartedAt !== undefined;
	const command =
		e.kind === "tool" && e.target === "Bash" && e.outcome
			? e.detail
			: undefined;
	teammates[e.who] = step(teammates, e.who, e, {
		agentId: e.agentId ?? actor?.agentId,
		status,
		issue,
		owned,
		trail: keepLast(actor?.trail ?? [], trailStep, TRAIL_LENGTH),
		goneAt: status === "gone" ? (actor?.goneAt ?? e.at) : undefined,
		turns: (actor?.turns ?? 0) + (e.kind === "turn-start" ? 1 : 0),
		activeMs:
			(actor?.activeMs ?? 0) +
			(ended ? Math.max(0, e.at - (actor?.turnStartedAt ?? e.at)) : 0),
		turnStartedAt:
			e.kind === "turn-start"
				? (actor?.turnStartedAt ?? e.at)
				: ended
					? undefined
					: actor?.turnStartedAt,
		lastProgressAt:
			e.kind === "tool" ||
			(e.kind === "turn-start" && actor?.status !== "running")
				? e.at
				: (actor?.lastProgressAt ?? e.at),
		failedCommand:
			command && e.outcome === "error"
				? command
				: command
					? undefined
					: actor?.failedCommand,
		failureCount: command
			? e.outcome === "error"
				? actor?.failedCommand === command
					? (actor.failureCount ?? 0) + 1
					: 1
				: 0
			: actor?.failureCount,
	});
	take(issue);

	for (const ref of refs) issueActive[ref] = e.at;
	if (issue !== undefined) issueActive[issue] = e.at;

	let { hallway, asks, kickbacks, closes } = state;
	if (e.kind === "tool" || e.kind === "message") {
		for (const closed of e.kind === "message"
			? closedIssues(e.detail)
			: (e.confirmedCloses ?? []))
			if (!closes.some((c) => c.issue === closed))
				closes = [...closes, { issue: closed, at: e.at }];
	}

	if (
		(e.kind === "message" || e.kind === "answer") &&
		e.target !== undefined &&
		e.target !== e.who
	) {
		const message: HallwayMessage = {
			from: e.who,
			to: e.target,
			text: stripSender(e.detail, e.who, isLead(e.who, options)),
			at: e.at,
			issues: refs,
		};
		hallway = keepLast(hallway, message, KEEP);

		const reviewer = isReviewer(e.who, options.roles?.[e.who]);
		if (isKickback(e.detail, reviewer)) {
			const kickback: Kickback = {
				from: e.who,
				to: e.target,
				issue: refs[0] ?? issue,
				at: e.at,
				text: e.detail,
			};
			kickbacks = keepLast(kickbacks, kickback, KEEP);
		}

		const fromLead = isLead(e.who, options);
		if (e.kind === "answer")
			asks = asks.map((ask) =>
				ask.open && ask.from === e.target && ask.at === e.replyTo
					? { ...ask, open: false }
					: ask,
			);
		else if (fromLead)
			asks = asks.map((ask) =>
				ask.open &&
				ask.from === e.target &&
				(!refs.length ||
					!ask.issues.length ||
					refs.some((ref) => ask.issues.includes(ref)))
					? { ...ask, open: false }
					: ask,
			);
		else if (isLead(e.target, options)) {
			// Only an explicit withdrawal closes it; a lead reply or answer does too.
			if (isAsk(e.detail))
				asks = keepLast(
					asks,
					{ ...message, agentId: e.agentId, open: true },
					KEEP,
				);
			else if (withdrawsAsk(e.detail)) asks = closeAsksFrom(asks, e.who);
		}
	}
	// Asks outlive the sender's turns (a new turn may come from anyone), not the sender.
	if (e.kind === "leave") asks = closeAsksFrom(asks, e.who);

	return {
		teammates,
		issueStarted,
		issueActive,
		hallway,
		asks,
		decisions: state.decisions,
		kickbacks,
		closes,
		ship: applyShip(state.ship, e),
	};
}

/**
 * A `decision` queues one; a `reply` (the person's prompt) closes only the
 * decisions it quoted (`answered`). A reply with no ids, as older journals
 * wrote, closes nothing.
 */
const decisionKey = (text: string, issues: readonly number[]) =>
	`${[...issues].sort((a, b) => a - b).join(",")}|${plain(text)}`;

function applyDecision(state: TeamState, e: BullpenEvent): TeamState {
	if (e.kind === "reply") {
		const ids = e.answered ?? [];
		return ids.length && state.decisions.some((d) => d.open)
			? {
					...state,
					decisions: state.decisions.map((d) =>
						d.open && d.at <= e.at && ids.includes(d.id)
							? { ...d, open: false }
							: d,
					),
				}
			: state;
	}
	// A lead restating a decision it already put is not a second one, even with
	// different case or spacing on the same issues: a quote could not tell the
	// two apart. The first stays and the later one is dropped whole, its context
	// included. The same words on other issues are a different decision.
	const key = decisionKey(e.detail, e.issues ?? []);
	if (
		state.decisions.some((d) => d.open && decisionKey(d.text, d.issues) === key)
	)
		return state;
	const same = state.decisions.filter((d) => d.at === e.at).length;
	const decision: Decision = {
		id: `d${e.at}-${same}`,
		at: e.at,
		text: e.detail,
		context: e.context ?? "",
		issues: e.issues ?? [],
		open: true,
	};
	return { ...state, decisions: keepLast(state.decisions, decision, KEEP) };
}

/** Closes every open ask raised by `who`. */
function closeAsksFrom(asks: Ask[], who: string): Ask[] {
	return asks.some((a) => a.open && a.from === who)
		? asks.map((a) => (a.open && a.from === who ? { ...a, open: false } : a))
		: asks;
}

/** Folds a whole journal. */
export function reduceEvents(
	events: readonly BullpenEvent[],
	options: ModelOptions = {},
): TeamState {
	let state = EMPTY_TEAM;
	for (const e of events) state = applyEvent(state, e, options);
	return state;
}

/** The state at `now` with idle teammates silent past `AWAY_MS` marked away. */
export function withAway(state: TeamState, now: number): TeamState {
	const teammates = { ...state.teammates };
	for (const t of Object.values(teammates)) {
		const away = t.status === "idle" && now - t.lastActiveAt > AWAY_MS;
		if (away || t.away) teammates[t.name] = { ...t, away };
	}
	return { ...state, teammates };
}

/** The state with live presence laid over what the events implied. */
export function withPresence(
	state: TeamState,
	present: ModelOptions["present"],
	now?: number,
): TeamState {
	if (!present) return state;
	const teammates = { ...state.teammates };
	for (const [name, status] of Object.entries(present)) {
		const t = teammates[name];
		if (t && t.status !== status)
			teammates[name] = {
				...t,
				status,
				goneAt:
					status === "gone" ? (t.goneAt ?? now ?? t.lastActiveAt) : undefined,
			};
	}
	return { ...state, teammates };
}

/** Open issues with someone (not gone) on them: biggest, then liveliest, first. */
export function huddlesOf(state: TeamState): Huddle[] {
	const closed = new Set(state.closes.map((c) => c.issue));
	const byIssue = new Map<number, Huddle>();
	const members = Object.values(state.teammates).sort(
		(a, b) => a.color - b.color,
	);
	for (const t of members) {
		if (t.issue === undefined || t.status === "gone" || closed.has(t.issue))
			continue;
		const huddle = byIssue.get(t.issue) ?? {
			issue: t.issue,
			members: [],
			startedAt: state.issueStarted[t.issue] ?? t.lastActiveAt,
			kickbacks: state.kickbacks.filter((k) => k.issue === t.issue).length,
			lastActiveAt: state.issueActive[t.issue] ?? t.lastActiveAt,
		};
		huddle.members.push(t.name);
		byIssue.set(t.issue, huddle);
	}
	return [...byIssue.values()].sort(
		(a, b) =>
			b.members.length - a.members.length || b.lastActiveAt - a.lastActiveAt,
	);
}

/** The state with agent types from the members atom, which the events may have lost. */
export function withTypes(
	state: TeamState,
	types: ModelOptions["agentTypes"],
): TeamState {
	if (!types) return state;
	const teammates = { ...state.teammates };
	for (const [name, agentType] of Object.entries(types)) {
		const t = teammates[name];
		if (t && t.agentType !== agentType) teammates[name] = { ...t, agentType };
	}
	return { ...state, teammates };
}
