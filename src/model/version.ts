// Versioning for the reduced team state. `$.state` outlives a hot reload, so a
// state reduced by older rules (ask detection, close rules, ship parsing) would
// keep its stale output until the session restarts. The state is stamped with
// the version that reduced it; a mismatch rebuilds it from the event window.

import type { BullpenEvent, TeamSnapshot } from "../../types";
import { readJournal, STATE_EVENTS } from "../journal";
import pinJournal from "./pin";
import { applyEvent, reduceEvents, type TeamState } from "./team";

/**
 * Fingerprint of the reducer: FNV-1a over the JSON of the state it reduces the
 * frozen `pin` journal to. Any change to the reducer (`team.ts`, `ship.ts`,
 * `detect.ts`) that moves that output changes the version, so nobody bumps it by
 * hand. A parser that runs only when recording (`toolText`, `briefIssue`) does
 * not count: it shapes new events, and stored ones keep their refs. Rules the
 * pin journal doesn't exercise aren't noticed; extend the journal when adding one.
 */
export function fingerprintOf(state: TeamState): string {
	const text = JSON.stringify(state);
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return `r${h.toString(16)}`;
}

/**
 * The version stamped on stored state, computed once per module load. Older
 * builds stamped a number, which never equals this string and so rebuilds.
 */
export const MODEL_VERSION: string = fingerprintOf(
	reduceEvents(readJournal(pinJournal).events),
);

/** A stored stamp: the fingerprint, or a number from builds that bumped by hand. */
export type Stamp = string | number;

/** The state from scratch: the last `STATE_EVENTS` events, oldest first. */
export function rebuildState(events: readonly BullpenEvent[]): TeamState {
	return reduceEvents(events.slice(-STATE_EVENTS));
}

/**
 * The state to use now. Kept as is when it was reduced by this version;
 * otherwise (older version, never stamped, or `force`) rebuilt from `events`.
 */
export function ensureState(
	state: TeamSnapshot | null,
	stamped: Stamp,
	events: readonly BullpenEvent[],
	force = false,
): { state: TeamSnapshot; version: string; rebuilt: boolean } {
	if (state && stamped === MODEL_VERSION && !force)
		return { state, version: MODEL_VERSION, rebuilt: false };
	return {
		state: rebuildState(events),
		version: MODEL_VERSION,
		rebuilt: true,
	};
}

/**
 * The state after a batch: `ensureState` first, then `added` folded onto the
 * result, so a batch arriving in the same pass as a rebuild isn't lost.
 * `events` is the window before `added`.
 */
export function foldBatch(
	state: TeamSnapshot | null,
	stamped: Stamp,
	events: readonly BullpenEvent[],
	added: readonly BullpenEvent[],
	force = false,
): { state: TeamSnapshot; version: string; rebuilt: boolean } {
	const out = ensureState(state, stamped, events, force);
	return {
		...out,
		state: added.reduce((acc, event) => applyEvent(acc, event), out.state),
	};
}

/**
 * The state for drawing: the stored one when current, else an in-memory
 * rebuild. Pure, so `derive` can cache it by its sources' versions and a
 * second read at the same versions doesn't rebuild.
 */
export function stateFor(
	state: TeamSnapshot | null,
	stamped: Stamp,
	events: readonly BullpenEvent[],
): TeamSnapshot {
	return state && stamped === MODEL_VERSION ? state : rebuildState(events);
}
