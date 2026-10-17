import type { BullpenEvent, Member } from "../types";
import { applyBatch, type CollectOp } from "./collect";
import { DEMO_PREFIX, DEMO_SCRIPT, type DemoStep } from "./demo";

/** Shared by live playback and deterministic previews. */
export function demoOps(step: DemoStep, at: number): CollectOp[] {
	const id = `${DEMO_PREFIX}${step.who}`;
	const act = step.do;
	const event = (
		kind: BullpenEvent["kind"],
		detail: string,
		extra: Partial<Extract<CollectOp, { op: "event" }>> = {},
	): CollectOp => ({
		op: "event",
		at,
		agentId: id,
		kind,
		detail,
		attribute: true,
		...extra,
	});
	switch (act.kind) {
		case "join":
			return [
				{
					op: "touch",
					at,
					id,
					patch: { name: step.who, status: "running", issue: act.issue },
				},
				event("spawn", `${step.who} joined`, {
					attribute: false,
					text: act.issue === undefined ? "" : `#${act.issue}`,
				}),
			];
		case "work":
			return [
				{ op: "touch", at, id, patch: { status: "running", issue: act.issue } },
				event("tool", act.detail, {
					text: act.issue === undefined ? "" : `#${act.issue}`,
				}),
			];
		case "rest":
			return [
				{ op: "touch", at, id, patch: { status: "idle" } },
				event("turn-end", "finished a turn"),
			];
		case "say":
			return [event("message", act.text, { target: act.to, text: act.text })];
		case "leave":
			return [
				{ op: "touch", at, id, patch: { status: "gone" } },
				event("leave", `${step.who} left`, { attribute: false }),
			];
	}
}

export function demoAt(now: number): {
	members: Record<string, Member>;
	events: BullpenEvent[];
} {
	const ops: CollectOp[] = [];
	let at = 0;
	for (const step of DEMO_SCRIPT) {
		at += step.wait;
		if (at > now) break;
		ops.push(...demoOps(step, at));
	}
	return applyBatch({}, ops);
}
