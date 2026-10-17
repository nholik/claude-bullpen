import type { BullpenEvent, Member } from "../types";
import { buildModel } from "./model";

/** A frozen historical projection; never resolves a recorded id to a live agent. */
export function replayAt(
	log: readonly BullpenEvent[],
	elapsed: number,
): { events: BullpenEvent[]; members: Record<string, Member>; now: number } {
	const ordered = [...log].sort((a, b) => a.at - b.at);
	const first = ordered[0]?.at ?? 0;
	const last = ordered.at(-1)?.at ?? first;
	const now = Math.min(last, first + Math.max(0, elapsed));
	const events = ordered.filter((e) => e.at <= now);
	const model = buildModel(events, now);
	const members = Object.fromEntries(
		Object.values(model.teammates).map((t) => [
			t.name,
			{
				id: `demo-replay-${t.name}`,
				name: t.name,
				status: t.status,
				issue: t.issue,
				agentType: t.agentType,
				color: t.color,
				lastActiveAt: t.lastActiveAt,
				goneAt: t.goneAt,
			},
		]),
	);
	return { events, members, now };
}
