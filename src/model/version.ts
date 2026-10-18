// Versioning for the reduced team state. `$.state` outlives a hot reload, so a
// state reduced by older rules (ask detection, close rules, ship parsing) would
// keep its stale output until the session restarts. The state is stamped with
// the version that reduced it; a mismatch rebuilds it from the event window.

import type { BullpenEvent, TeamSnapshot } from "../../types";
import { STATE_EVENTS } from "../journal";
import { reduceEvents, type TeamState } from "./team";

/**
 * Bump whenever a change to the reducer (`team.ts`, `detect.ts`, `ship.ts`)
 * changes what it produces for the same events. `tests/model-version.test.ts`
 * pins the reducer's output for the fixtures to this number and fails when the
 * output moves without a bump.
 */
export const MODEL_VERSION = 1;

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
	stamped: number,
	events: readonly BullpenEvent[],
	force = false,
): { state: TeamSnapshot; version: number; rebuilt: boolean } {
	if (state && stamped === MODEL_VERSION && !force)
		return { state, version: MODEL_VERSION, rebuilt: false };
	return {
		state: rebuildState(events),
		version: MODEL_VERSION,
		rebuilt: true,
	};
}
