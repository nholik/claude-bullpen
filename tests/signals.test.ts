import { expect, test } from "claude-code/testing";
import { toolOutcome } from "../src/collect";
import { applyEvent, buildModel, modelOf, reduceEvents } from "../src/model";
import { activeTime, backlogTrend, flowSummary } from "../src/model/signals";
import { DEFAULT_PROFILE } from "../src/profile";
import { width } from "../src/render/lines";
import { teamStudioView } from "../src/render/team-studio";
import { replayAt } from "../src/replay";
import type { BullpenEvent } from "../types";

const minute = 60_000;
const event = (
	kind: BullpenEvent["kind"],
	at: number,
	extra: Partial<BullpenEvent> = {},
): BullpenEvent => ({
	version: 1,
	who: "builder",
	agentId: "a",
	kind,
	at,
	issues: [12],
	detail: "work",
	...extra,
});

test("each stuck rule has a visible reason, and success clears repeated command failure", () => {
	const scenarios: [BullpenEvent[], number, string][] = [
		[[event("tool", 0)], 10 * minute, "no tool progress 10m"],
		[
			[event("tool", 0), event("turn-end", minute)],
			6 * minute,
			"idle with open work 5m",
		],
		[
			[0, 1, 2].map((at) =>
				event("tool", at, {
					target: "Bash",
					detail: "npm test",
					outcome: "error",
				}),
			),
			3,
			"same command failed 3 times",
		],
		[
			[
				event("tool", 0),
				event("message", 1, {
					who: "gate",
					target: "builder",
					detail: "sending it back",
				}),
				event("message", 2, {
					who: "gate",
					target: "builder",
					detail: "sending it back",
				}),
			],
			3,
			"sent back 2 times",
		],
	];
	for (const [events, now, reason] of scenarios) {
		const model = buildModel(events, now);
		expect(model.stuck?.builder).toBe(reason);
		expect(model.morale.factors.stalled).toContain(12);
		const text = teamStudioView(
			model,
			{ filter: "", burndown: [], checkedAt: 0 },
			DEFAULT_PROFILE,
			72,
			32,
			now,
		)
			.regions.flat()
			.map((s) => s.text)
			.join("");
		expect(text).toContain(reason);
	}
	const failures = [0, 1, 2].map((at) =>
		event("tool", at, { target: "Bash", detail: "npm test", outcome: "error" }),
	);
	expect(
		buildModel(
			[
				...failures,
				event("tool", 3, { target: "Bash", detail: "npm test", outcome: "ok" }),
			],
			4,
		).stuck,
	).toEqual({});
	expect(
		buildModel(
			[
				event("tool", 0),
				event("message", minute, {
					who: "lead",
					detail: "closed #12",
					target: "builder",
				}),
			],
			20 * minute,
		).stuck,
	).toEqual({});
});

test("asking a fresh question or finding one review problem does not darken the office", () => {
	const base = [event("tool", 0)];
	const healthy = buildModel(
		[
			...base,
			event("message", 1, {
				target: "lead",
				detail: "Which approach should I use?",
			}),
			event("message", 2, {
				who: "gate",
				target: "builder",
				detail: "sending it back",
			}),
		],
		3,
	);
	expect(healthy.morale.score).toBe(buildModel(base, 3).morale.score);
});

test("an unresolved review loop does not expire with morale's recent-event window", () => {
	const log = [
		event("tool", 0),
		...[1, 2].map((at) =>
			event("message", at * minute, {
				who: "gate",
				target: "builder",
				detail: "PR #22 (#12) CHANGES: sending it back",
			}),
		),
		event("tool", 70 * minute),
		// Keep the reviewer active too, isolating review-loop clearance from
		// the separate no-tool-progress rule on another member of this issue.
		event("tool", 70 * minute, { who: "gate" }),
	];
	const waiting = buildModel(log, 70 * minute);
	expect(waiting.stuck?.builder).toBe("sent back 2 times");
	expect(waiting.morale.factors.stalled).toContain(12);
	expect(waiting.morale.factors.kickbacks).toBe(0);
	const approved = buildModel(
		[
			...log,
			event("message", 70 * minute + 1, {
				who: "gate",
				target: "builder",
				detail: "PR #22 (#12) PASS",
			}),
		],
		70 * minute + 1,
	);
	expect(approved.stuck?.builder).toBeUndefined();
	expect(approved.morale.factors.stalled).not.toContain(12);
	for (const detail of ["PR #22 merged", "closed #12"])
		expect(
			buildModel(
				[
					...log,
					event("message", 70 * minute + 1, {
						who: "lead",
						target: "builder",
						detail,
					}),
				],
				70 * minute + 1,
			).stuck?.builder,
		).toBeUndefined();
	const reassigned = buildModel(
		[...log, event("tool", 70 * minute + 1, { issues: [13] })],
		70 * minute + 1,
	);
	expect(reassigned.teammates.builder?.issue).toBe(13);
	expect(reassigned.stuck?.builder).toBeUndefined();
});

test("stall timers honor their thresholds and messages do not count as tool progress", () => {
	const running = [
		event("tool", 0),
		event("message", 9 * minute, {
			target: "lead",
			detail: "still investigating",
		}),
	];
	expect(buildModel(running, 10 * minute - 1).stuck?.builder).toBeUndefined();
	expect(buildModel(running, 10 * minute).stuck?.builder).toBe(
		"no tool progress 10m",
	);
	const idle = [event("tool", 0), event("turn-end", minute)];
	expect(buildModel(idle, 6 * minute - 1).stuck?.builder).toBeUndefined();
	expect(buildModel(idle, 6 * minute).stuck?.builder).toBe(
		"idle with open work 5m",
	);
	const review = [
		event("message", 0, {
			target: "lead",
			detail: "#12 please review https://github.com/o/r/pull/22",
		}),
		event("tool", 14 * minute),
	];
	expect(buildModel(review, 15 * minute - 1).stuck?.builder).toBeUndefined();
	// A slow review is not the builder's stall.
	expect(buildModel(review, 20 * minute).stuck?.builder).toBeUndefined();
	expect(
		buildModel([event("turn-end", 0, { issues: [] })], 20 * minute).stuck,
	).toEqual({});
	expect(
		buildModel([event("tool", 0), event("leave", minute)], 20 * minute).stuck,
	).toEqual({});
});

test("turn counters survive display-history rollover, without counting idle time", () => {
	let state = reduceEvents([
		event("turn-start", 0),
		event("turn-end", 2 * minute),
	]);
	for (let i = 0; i < 2100; i++)
		state = applyEvent(
			state,
			event("message", 3 * minute + i, {
				who: "other",
				target: "lead",
				issues: [],
				detail: "progress",
			}),
		);
	const t = modelOf(state, 10 * minute).teammates.builder;
	expect(t?.turns).toBe(1);
	expect(t && activeTime(t, 10 * minute)).toBe(2 * minute);
});

test("backlog growth and spare review capacity are explicit, never invented created counts", () => {
	const series = [
		{ at: 0, open: 5, closed: 2 },
		{ at: 30 * minute, open: 9, closed: 3 },
	];
	expect(backlogTrend(series)).toEqual({ delta: 4, minutes: 30 });
	expect(backlogTrend([series[0] as (typeof series)[number]])).toBeUndefined();
	const model = buildModel(
		[
			event("message", 0, {
				target: "lead",
				detail: "#12 PR: https://github.com/o/r/pull/22",
			}),
			event("message", 1, {
				target: "lead",
				issues: [13],
				detail: "#13 PR: https://github.com/o/r/pull/23",
			}),
			event("turn-end", 2, { who: "reviewer", issues: [] }),
		],
		3,
	);
	const flow = flowSummary(model, series, 3);
	expect(flow.pressure).toBe(true);
	expect(flow.text).toContain("backlog +4 / 30m");
	expect(flow.text).toContain("consider review help");
});

test("replay follows recorded time, caps at its end and never exposes live ids", () => {
	const log = [event("turn-start", 100), event("turn-end", 1000)];
	expect(replayAt(log, 0).events).toHaveLength(1);
	const end = replayAt(log, 5000);
	expect(end.now).toBe(1000);
	expect(end.members.builder?.status).toBe("idle");
	expect(end.members.builder?.id).toStartWith("demo-");
});

test("away teammates fold, departed teammates linger, and every layout stays bounded", () => {
	const log = [
		event("turn-end", 0, { who: "away", issues: [] }),
		event("leave", 31 * minute, { who: "gone", issues: [] }),
		event("tool", 31 * minute),
	];
	for (const columns of [72, 110, 160]) {
		const model = buildModel(log, 31 * minute);
		const view = teamStudioView(
			model,
			{ filter: "", burndown: [], checkedAt: 0 },
			DEFAULT_PROFILE,
			columns,
			40,
			31 * minute,
		);
		const text = view.regions
			.flat()
			.map((s) => s.text)
			.join("");
		expect(text).toContain("out: away");
		expect(text).toContain("clocked out");
		for (const line of [...view.header, ...view.regions])
			expect(width(line)).toBeLessThanOrEqual(columns);
		const later = teamStudioView(
			buildModel(log, 34 * minute),
			{ filter: "", burndown: [], checkedAt: 0 },
			DEFAULT_PROFILE,
			columns,
			40,
			34 * minute,
		);
		expect(later.regions.flat().some((s) => s.text === "gone")).toBe(false);
	}
});

test("denied, interrupted, and background commands never report a successful completion", () => {
	for (const result of [
		{ deny: "policy" },
		{ result: { interrupted: true } },
		{ result: { interrupted: false, backgroundTaskId: "t" } },
	])
		expect(toolOutcome(result)).toBeUndefined();
	expect(toolOutcome({ isError: true, result: "failure" })).toBe("error");
	expect(toolOutcome({ result: { interrupted: false } })).toBe("ok");
});

test("idle reviewers and builders with an open PR are waiting, not stuck", () => {
	const view = (events: BullpenEvent[], now: number) => {
		const model = buildModel(events, now);
		const text = teamStudioView(
			model,
			{ filter: "", burndown: [], checkedAt: 0 },
			DEFAULT_PROFILE,
			110,
			32,
			now,
		)
			.regions.flat()
			.map((s) => s.text)
			.join("");
		return { model, text };
	};
	const idle = 20 * minute;
	const announce = event("message", 1, {
		target: "lead",
		detail: "#12 PR is up: https://github.com/o/r/pull/30. Check is green.",
	});
	const ask = event("message", 2, {
		target: "gate",
		detail: "#12: please review PR https://github.com/o/r/pull/30",
	});
	const done = event("turn-end", 3);

	// Builder with no PR is still stuck.
	expect(buildModel([event("tool", 0), done], idle).stuck?.builder).toBe(
		"idle with open work 19m",
	);

	// PR announced, then in review: waiting on review.
	const reviewing = view([announce, ask, done], idle);
	expect(reviewing.model.stuck?.builder).toBeUndefined();
	expect(reviewing.text).toContain("waiting on review");
	expect(reviewing.text).not.toContain("stuck");
	expect(flowSummary(reviewing.model, [], idle).text).not.toContain("stall");

	// Approved: waiting on a human merge.
	const approved = view(
		[
			announce,
			ask,
			event("message", 3, {
				who: "gate",
				target: "lead",
				detail: "PR #30 (#12) PASS",
			}),
			event("turn-end", 4),
		],
		idle,
	);
	expect(approved.model.stuck?.builder).toBeUndefined();
	expect(approved.text).toContain("waiting on merge");

	// A reviewer or designer that finished is done, however the role is named.
	for (const [who, role] of [
		["gate", undefined],
		["ux121", undefined],
		["checker", "reviewer"],
		["mock", "designer"],
	] as const) {
		const model = buildModel(
			[event("tool", 0, { who }), event("turn-end", 1, { who })],
			idle,
			role ? { roles: { [who]: role } } : {},
		);
		expect(model.stuck?.[who]).toBeUndefined();
	}
});
