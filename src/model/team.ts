// The team reducer: folds journal events, oldest first, into what the views
// need. Pure and incremental: `applyEvent` per new event, `huddlesOf` and
// `moraleOf` when drawing.

import type { BullpenEvent, BullpenEventKind, MemberStatus } from "../../types";
import { nextIssue } from "../events";
import { closedIssues, isAsk, isKickback, isReviewer } from "./detect";
import type { Ask, HallwayMessage, Huddle, Kickback, Teammate } from "./types";

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
};

export const DEFAULT_LEADS: readonly string[] = ["lead", "team-lead", "main"];

/** How many steps a teammate's trail keeps. */
export const TRAIL_LENGTH = 3;
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
	kickbacks: Kickback[];
	/** Each close seen, in order; an issue appears once. */
	closes: { issue: number; at: number }[];
};

export const EMPTY_TEAM: TeamState = {
	teammates: {},
	issueStarted: {},
	issueActive: {},
	hallway: [],
	asks: [],
	kickbacks: [],
	closes: [],
};

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
		color: prev?.color ?? Object.keys(teammates).length,
		status: prev?.status ?? "running",
		issue: prev?.issue,
		lastActiveAt: Math.max(prev?.lastActiveAt ?? e.at, e.at),
		trail: prev?.trail ?? [],
		...patch,
	};
}

/** Folds one event into the state. Unknown kinds and extra fields are ignored. */
export function applyEvent(
	state: TeamState,
	e: BullpenEvent,
	options: ModelOptions = {},
): TeamState {
	const teammates = { ...state.teammates };
	const issueStarted = { ...state.issueStarted };
	const issueActive = { ...state.issueActive };
	const refs = e.issues ?? [];
	const take = (issue: number | undefined) => {
		if (issue !== undefined && issueStarted[issue] === undefined)
			issueStarted[issue] = e.at;
	};

	// A spawn brings in `target` (a teammate joining reports itself, with no
	// target). Its brief's first issue is the newcomer's, if it has none yet.
	const trailStep = { at: e.at, kind: e.kind, detail: e.detail };
	const spawned = e.kind === "spawn" ? (e.target ?? e.who) : undefined;
	if (spawned !== undefined && spawned !== e.who) {
		const prev = teammates[spawned];
		const issue = prev?.issue ?? refs[0];
		teammates[spawned] = step(teammates, spawned, e, {
			status: "running",
			issue,
			trail: keepLast(prev?.trail ?? [], trailStep, TRAIL_LENGTH),
		});
		take(issue);
	}

	// Kinds added to the journal later move no one until the model learns them.
	const actor = teammates[e.who];
	const known = isKnown(e.kind);
	let issue = actor?.issue;
	if (spawned === e.who) issue = actor?.issue ?? refs[0];
	else if (known) issue = nextIssue(e.kind, actor?.issue, refs);
	let status = actor?.status ?? "running";
	if (known) status = e.kind === "turn-end" ? "idle" : "running";
	teammates[e.who] = step(teammates, e.who, e, {
		agentId: e.agentId ?? actor?.agentId,
		status,
		issue,
		trail: keepLast(actor?.trail ?? [], trailStep, TRAIL_LENGTH),
	});
	take(issue);

	for (const ref of refs) issueActive[ref] = e.at;
	if (issue !== undefined) issueActive[issue] = e.at;

	let { hallway, asks, kickbacks, closes } = state;
	if (e.kind === "tool" || e.kind === "message") {
		for (const closed of closedIssues(e.detail))
			if (!closes.some((c) => c.issue === closed))
				closes = [...closes, { issue: closed, at: e.at }];
	}

	if (e.kind === "message" && e.target !== undefined && e.target !== e.who) {
		const message: HallwayMessage = {
			from: e.who,
			to: e.target,
			text: e.detail,
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
		if (fromLead)
			asks = asks.map((ask) =>
				ask.open && ask.from === e.target ? { ...ask, open: false } : ask,
			);
		else if (isLead(e.target, options) && isAsk(e.detail))
			asks = keepLast(asks, { ...message, open: true }, KEEP);
	}

	return {
		teammates,
		issueStarted,
		issueActive,
		hallway,
		asks,
		kickbacks,
		closes,
	};
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

/** The state with live presence laid over what the events implied. */
export function withPresence(
	state: TeamState,
	present: ModelOptions["present"],
): TeamState {
	if (!present) return state;
	const teammates = { ...state.teammates };
	for (const [name, status] of Object.entries(present)) {
		const t = teammates[name];
		if (t && t.status !== status) teammates[name] = { ...t, status };
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
