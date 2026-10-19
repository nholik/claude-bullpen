// The team model: `buildModel(events, now)` is everything the views draw.

import type { BullpenEvent } from "../../types";
import { moraleOf } from "./morale";
import { shippedIssues } from "./ship";
import { isVerdictRole, stuckReasons, waitingOn } from "./signals";
import {
	DEFAULT_LEADS,
	huddlesOf,
	type ModelOptions,
	reduceEvents,
	type TeamState,
	withAway,
	withPresence,
	withTypes,
} from "./team";
import type { BullpenModel, HallwayMessage } from "./types";

export { moraleGlyph } from "./morale";
export type { ShipPath, ShipStage, ShipVerdict } from "./ship";
export {
	AWAY_MS,
	applyEvent,
	EMPTY_TEAM,
	huddlesOf,
	type ModelOptions,
	reduceEvents,
	type TeamState,
	withAway,
	withPresence,
} from "./team";
export type * from "./types";
export {
	ensureState,
	fingerprintOf,
	fingerprintPin,
	foldBatch,
	MODEL_VERSION,
	PIN_REVIEW,
	rebuildState,
	type Stamp,
	stateFor,
} from "./version";

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
	if (options.github) {
		const paths = { ...state.ship.paths };
		for (const pr of options.github.prs ?? []) {
			for (const [issue, path] of Object.entries(paths)) {
				// A merged PR cannot reopen. Later chat or review recaps for that
				// same PR must not hide a merge confirmed by an earlier poll.
				if (
					path.pr !== pr.number ||
					(pr.state !== "MERGED" && pr.checkedAt < path.at)
				)
					continue;
				paths[Number(issue)] =
					pr.state === "MERGED"
						? { ...path, stage: "merged", at: pr.mergedAt ?? pr.checkedAt }
						: {
								...path,
								stage:
									pr.state === "CLOSED"
										? "working"
										: path.stage === "merged"
											? "pr-open"
											: path.stage,
								pr: pr.state === "CLOSED" ? undefined : path.pr,
							};
			}
		}
		const source = options.github;
		const closes = [...state.closes];
		if (source.result?.status === "ok") {
			for (const issue of source.result.issues) {
				if (
					issue.state === "closed" &&
					(state.issueStarted[issue.number] !== undefined ||
						paths[issue.number]) &&
					!closes.some((c) => c.issue === issue.number)
				)
					closes.push({
						issue: issue.number,
						at: issue.closedAt ?? source.checkedAt,
					});
			}
		}
		state = { ...state, closes, ship: { ...state.ship, paths } };
	}
	if (state.closes.length) {
		const paths = { ...state.ship.paths };
		for (const closed of state.closes) {
			const previous = paths[closed.issue];
			paths[closed.issue] = {
				issue: closed.issue,
				bounced: false,
				codex: false,
				...previous,
				stage: "shipped",
				at: closed.at,
			};
		}
		state = { ...state, ship: { ...state.ship, paths } };
	}
	const live = withAway(
		withTypes(withPresence(state, options.present, now), options.agentTypes),
		now,
	);
	const huddles = huddlesOf(live).filter(
		(h) =>
			!Object.values(state.ship.paths).some(
				(p) =>
					p.issue === h.issue &&
					(p.stage === "merged" || p.stage === "shipped"),
			),
	);
	const model: BullpenModel = {
		teammates: live.teammates,
		huddles,
		hallway: state.hallway,
		asks: state.asks,
		decisions: state.decisions.filter((d) => d.open),
		kickbacks: state.kickbacks,
		closed: state.closes.map((c) => c.issue),
		ship: Object.values(state.ship.paths),
		shipped: shippedIssues(
			state.ship.paths,
			state.closes.map((c) => c.issue),
		).length,
		morale: moraleOf(live, huddles, now, options.leads ?? DEFAULT_LEADS),
	};
	model.stuck = stuckReasons(model, now, options.roles);
	model.morale = moraleOf(
		live,
		huddles,
		now,
		options.leads ?? DEFAULT_LEADS,
		model.stuck,
		new Set(
			Object.values(live.teammates)
				.filter(
					(t) =>
						isVerdictRole(t, options.roles?.[t.name]) ||
						waitingOn(model, t, options.roles?.[t.name]),
				)
				.map((t) => t.name),
		),
	);
	return model;
}

/** The model at `now` from a journal, oldest event first. */
export function buildModel(
	events: readonly BullpenEvent[],
	now: number,
	options: ModelOptions = {},
): BullpenModel {
	return modelOf(reduceEvents(events, options), now, options);
}
