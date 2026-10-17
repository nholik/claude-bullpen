// The team model: `buildModel(events, now)` is everything the views draw.

import type { BullpenEvent } from "../../types";
import { moraleOf } from "./morale";
import {
	DEFAULT_LEADS,
	huddlesOf,
	type ModelOptions,
	reduceEvents,
	type TeamState,
	withPresence,
} from "./team";
import type { BullpenModel, HallwayMessage } from "./types";

export { moraleGlyph } from "./morale";
export {
	applyEvent,
	EMPTY_TEAM,
	huddlesOf,
	type ModelOptions,
	reduceEvents,
	type TeamState,
	withPresence,
} from "./team";
export type * from "./types";

/** The hallway stays awake this long after the last message. */
export const HALLWAY_LIVE_MS = 3 * 60_000;

/** Whether anyone has said anything in the last three minutes. */
export function isHallwayLive(
	hallway: readonly HallwayMessage[],
	now: number,
): boolean {
	return hallway.some((m) => now - m.at <= HALLWAY_LIVE_MS && m.at <= now);
}

/** The model at `now` from a reduced state, for callers folding incrementally. */
export function modelOf(
	state: TeamState,
	now: number,
	options: ModelOptions = {},
): BullpenModel {
	const live = withPresence(state, options.present);
	const huddles = huddlesOf(live);
	return {
		teammates: live.teammates,
		huddles,
		hallway: state.hallway,
		asks: state.asks,
		kickbacks: state.kickbacks,
		closed: state.closes.map((c) => c.issue),
		morale: moraleOf(live, huddles, now, options.leads ?? DEFAULT_LEADS),
	};
}

/** The model at `now` from a journal, oldest event first. */
export function buildModel(
	events: readonly BullpenEvent[],
	now: number,
	options: ModelOptions = {},
): BullpenModel {
	return modelOf(reduceEvents(events, options), now, options);
}
