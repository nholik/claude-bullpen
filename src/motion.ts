import type { BullpenEvent, Member, Profile } from "../types";
import { createTweens, easeInOutCubic, lerpPoint, type Point } from "./anim";
import { drawFloor, type FloorEffects, layout } from "./floor";
import { applyEvent, EMPTY_TEAM, type TeamState } from "./model";
import { colorFor, roleNames } from "./profile";

export type MotionSpec = {
	id: string;
	kind: "walk" | "message" | "kickback" | "close";
	member?: string;
	issue?: number;
	from: Point;
	to: Point;
	color: number;
	startAt: number;
	durationMs: number;
};
const point = (seat: { col: number; pixel: number }): Point => ({
	x: seat.col,
	y: seat.pixel,
});
function membersAt(state: TeamState, members: Member[]): Member[] {
	return members.flatMap((m) => {
		const t = state.teammates[m.name];
		return t
			? [
					{
						...m,
						status: t.status,
						issue: state.closes.some((c) => c.issue === t.issue)
							? undefined
							: t.issue,
					},
				]
			: [];
	});
}

/** Replay only derives geometry near now; the caller caches specs between events. */
export function motionFor(
	events: readonly BullpenEvent[],
	members: Member[],
	columns: number,
	rows: number,
	now: number,
	profile: Profile,
): { specs: MotionSpec[]; closed: number[] } {
	let state = EMPTY_TEAM;
	const roles = roleNames(profile, members);
	const specs: MotionSpec[] = [];
	for (const [index, event] of events.entries()) {
		if (event.at > now) break;
		const before = state;
		state = applyEvent(state, event, { roles });
		if (
			!profile.animations ||
			now - event.at > 2500 ||
			columns < 48 ||
			rows < 7
		)
			continue;
		const oldMembers = membersAt(before, members);
		const newMembers = membersAt(state, members);
		const oldFloor = drawFloor(oldMembers, columns, rows, 0, {}, profile, {
			closed: before.closes.map((c) => c.issue),
			walkers: [],
			dots: [],
			tables: [],
		});
		const newFloor = drawFloor(newMembers, columns, rows, 0, {}, profile, {
			closed: state.closes.map((c) => c.issue),
			walkers: [],
			dots: [],
			tables: [],
		});
		const actor = members.find((m) => m.name === event.who);
		if (actor) {
			const from = oldFloor.seats.get(actor.id);
			const to = newFloor.seats.get(actor.id);
			if (
				from &&
				to &&
				before.teammates[event.who]?.issue !== state.teammates[event.who]?.issue
			)
				specs.push({
					id: `walk:${index}`,
					kind: "walk",
					member: actor.id,
					from: point(from),
					to: point(to),
					color: colorFor(actor.name, profile, actor.color),
					startAt: event.at,
					durationMs: 1200,
				});
			if (event.kind === "message") {
				const target = members.find(
					(m) => m.name === event.target || m.id === event.target,
				);
				const end = target ? newFloor.seats.get(target.id) : undefined;
				if (to && end)
					specs.push({
						id: `message:${index}`,
						kind:
							state.kickbacks.length > before.kickbacks.length
								? "kickback"
								: "message",
						from: point(to),
						to: point(end),
						color:
							state.kickbacks.length > before.kickbacks.length
								? 0xff5555
								: colorFor(actor.name, profile, actor.color),
						startAt: event.at,
						durationMs: 900,
					});
			}
		}
		for (const close of state.closes.slice(before.closes.length)) {
			const table = layout(columns, rows, [
				...oldMembers.flatMap((m) => m.issue ?? []),
				...before.closes.map((c) => c.issue),
			]).tables.get(close.issue);
			if (table)
				specs.push({
					id: `close:${index}:${close.issue}`,
					kind: "close",
					issue: close.issue,
					from: { x: table.col, y: table.row * 2 },
					to: { x: Math.max(0, columns - 14), y: Math.max(2, rows * 2 - 6) },
					color: 0x81c784,
					startAt: event.at,
					durationMs: 2400,
				});
		}
	}
	return { specs, closed: state.closes.map((c) => c.issue) };
}

export function createMotion(plan: ReturnType<typeof motionFor>) {
	const tweens = createTweens();
	for (const spec of plan.specs)
		tweens.add({
			id: spec.id,
			from: 0,
			to: 1,
			startAt: spec.startAt,
			durationMs: spec.durationMs,
			ease: spec.kind === "walk" ? easeInOutCubic : undefined,
		});
	return {
		active: (now: number) => tweens.active(now),
		sample(now: number): FloorEffects {
			const values = tweens.sample(now);
			const effects: FloorEffects = {
				closed: plan.closed,
				walkers: [],
				dots: [],
				tables: [],
			};
			for (const spec of plan.specs) {
				if (now < spec.startAt || now >= spec.startAt + spec.durationMs)
					continue;
				const t = values.get(spec.id) ?? 0;
				const position = lerpPoint(
					spec.from,
					spec.to,
					spec.kind === "close" ? Math.max(0, (t - 0.3) / 0.7) : t,
				);
				if (spec.kind === "walk" && spec.member)
					effects.walkers.push({ id: spec.member, ...position });
				else if (spec.kind === "close" && spec.issue !== undefined) {
					effects.tables.push({
						issue: spec.issue,
						...position,
						color: spec.color,
					});
					for (let i = 0; i < 7; i++)
						effects.dots.push({
							x: spec.from.x + 3 + (i - 3) * t * 9,
							y: spec.from.y - 1 - Math.sin(t * Math.PI) * 5 + (i % 3),
							color: i % 2 ? spec.color : 0xfff176,
						});
				} else
					effects.dots.push({
						...position,
						color: spec.color,
						spark: spec.kind === "kickback",
					});
			}
			return effects;
		},
	};
}
