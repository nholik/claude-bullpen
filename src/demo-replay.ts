import type { BullpenEvent, GithubSource, Member, Profile } from "../types";
import { applyBatch, type CollectOp } from "./collect";
import { DEMO_PREFIX, DEMO_SCRIPT, type DemoStep, demoClock } from "./demo";
import { addSnapshot, exactCounts, readIssueList } from "./github";

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
		case "advance":
			return [];
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
			return [
				{ op: "touch", at, id, patch: { name: step.who, status: "running" } },
				event("message", act.text, { target: act.to, text: act.text }),
			];
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
		ops.push(...demoOps(step, demoClock(at)));
	}
	return applyBatch({}, ops);
}

/** Fake process output uses exactly the real parser and snapshot reducer. */
export function demoGithubAt(elapsed: number): GithubSource {
	const source: GithubSource = {
		repo: "demo/bullpen",
		filter: "demo",
		burndown: [],
		checkedAt: demoClock(elapsed),
	};
	for (const at of [0, 55000, 70000]) {
		if (at > elapsed) break;
		const issues = [
			{ number: 199, title: "Tooltip alignment" },
			{ number: 204, title: "Session expiry" },
			{ number: 208, title: "Auth redirect" },
			{ number: 217, title: "Spacing polish" },
		].map((i) => ({
			...i,
			state:
				(i.number === 204 && at >= 55000) || (i.number === 208 && at >= 70000)
					? "CLOSED"
					: "OPEN",
			labels: [],
			assignees: [],
		}));
		const result = readIssueList({
			exitCode: 0,
			stdout: JSON.stringify(issues),
			stderr: "",
		});
		source.result = result;
		if (result.status === "ok") {
			const counts = exactCounts(result);
			if (counts)
				source.burndown = addSnapshot(source.burndown, {
					at: demoClock(at),
					...counts,
				});
		}
	}
	return source;
}

/** Demo identities exercise the normal profile-color path; user overrides win. */
export function demoProfile(profile: Profile): Profile {
	const roles = Object.fromEntries(
		["smith", "ada", "gate", "iris", "scout", "lead", "luna"].map(
			(name, color) => [
				name,
				{
					color,
					role:
						name === "gate"
							? "reviewer"
							: name === "lead"
								? "lead"
								: name === "scout"
									? "researcher"
									: name === "iris"
										? "designer"
										: "engineer",
				},
			],
		),
	);
	return { ...profile, roles: { ...roles, ...profile.roles } };
}
