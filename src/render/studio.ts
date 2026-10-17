import type { Profile } from "../../types";
import type { BullpenModel } from "../model";
import { isReviewer } from "../model/detect";
import { STALL_MS } from "../model/morale";
import { roleFor } from "../profile";

/** Shared by the floor and cards: color always accompanies a written state. */
export const STUDIO = {
	background: 0x101923,
	panel: 0x17232e,
	edge: 0x3a5263,
	text: 0xdce7ed,
	muted: 0x93a8b8,
	mint: 0x7cdbb5,
	amber: 0xefc078,
	lavender: 0xb9a2ed,
	coral: 0xef9290,
};

export function issueStatus(
	model: BullpenModel,
	issue: number,
	profile: Profile,
	now: number,
): { label: string; color: number; step: number } {
	if (model.closed.includes(issue))
		return { label: "DONE", color: STUDIO.mint, step: 3 };
	if (model.asks.some((a) => a.open && a.issues.includes(issue)))
		return { label: "NEEDS YOU", color: STUDIO.amber, step: 1 };
	const huddle = model.huddles.find((h) => h.issue === issue);
	if (huddle && now - huddle.lastActiveAt > STALL_MS)
		return { label: "STALLED", color: STUDIO.coral, step: 1 };
	const members = huddle?.members.map((name) => model.teammates[name]) ?? [];
	if (
		members.some(
			(m) =>
				m?.status === "running" &&
				isReviewer(m.name, roleFor(m.name, profile)?.role),
		)
	)
		return { label: "IN REVIEW", color: STUDIO.lavender, step: 2 };
	if (members.some((m) => m?.status === "running"))
		return { label: "WORKING", color: STUDIO.amber, step: 1 };
	return { label: "IDLE", color: STUDIO.muted, step: 0 };
}
