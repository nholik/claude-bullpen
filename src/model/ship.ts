// Each issue's path to shipping: working, PR open, in review, changes asked,
// approved, merged, shipped. Read from what teams already do: builders
// announcing PRs, gate saying PASS or CHANGES, `gh pr` commands, @codex
// comments. Heuristics over short journal details, so each errs toward not
// firing; an event that cannot be tied to an issue moves nothing.

import type { BullpenEvent } from "../../types";

export type ShipStage =
	| "working"
	| "pr-open"
	| "in-review"
	| "changes"
	| "approved"
	| "merged"
	| "shipped";

export type ShipVerdict = "pass" | "changes";

export type ShipPath = {
	issue: number;
	stage: ShipStage;
	/** The PR number, once an event has tied one to this issue. */
	pr?: number;
	/** The latest review verdict; kept after a resubmission for context. */
	verdict?: ShipVerdict;
	/** An @codex review was requested on the PR. */
	codex: boolean;
	/** When the stage last changed. */
	at: number;
};

export type ShipState = {
	paths: Record<number, ShipPath>;
	/** PR number to issue, from announcements and "Closes #N". */
	prIssue: Record<number, number>;
};

export const EMPTY_SHIP: ShipState = { paths: {}, prIssue: {} };

// "#44 PR: https://github.com/o/r/pull/61", "#59 PR open: .../pull/70"
const PR_ANNOUNCE = /#(\d{1,7})\s+PR(?:\s+open)?:\s*\S*?\/pull\/(\d{1,7})/gi;
// "#46 please review https://.../pull/62", "#44 please review PR https://.../pull/61"
const REVIEW_ASK =
	/#(\d{1,7})\s+(?:please\s+)?(?:re-?)?review\s+(?:PR\s+)?\S*?\/pull\/(\d{1,7})/gi;
// "PR #61 (#44) CHANGES", "PR #62 (#46): PASS", "#61 (#44) PASS now"
const VERDICT =
	/(?:\bPR\s+)?#(\d{1,7})\s+\(#(\d{1,7})\)\s*:?\s*(PASS|CHANGES)\b/g;
const GH_PR = /\bgh\s+pr\s+(create|review|merge|comment)\b/;

/** Numbers in `gh pr <verb> 61` or a `for p in 61 62; do gh pr ...` loop. */
function prNumbers(command: string): number[] {
	const loop = /\bfor\s+\w+\s+in\s+((?:\d+\s*)+);/.exec(command);
	if (loop?.[1]) return loop[1].trim().split(/\s+/).map(Number);
	const direct = /\bgh\s+pr\s+\w+\s+#?(\d{1,7})\b/.exec(command);
	return direct?.[1] ? [Number(direct[1])] : [];
}

/** A review verdict a `gh pr review` command carries, if it says. */
export function commandVerdict(command: string): ShipVerdict | undefined {
	if (!/\bgh\s+pr\s+review\b/.test(command)) return undefined;
	if (/--request-changes\b/.test(command)) return "changes";
	if (/--approve\b/.test(command)) return "pass";
	const body = /--body\s+\\?"?\s*Gate(?:\s+re-review)?:\s*(PASS|CHANGES)\b/i.exec(
		command,
	);
	if (!body?.[1]) return undefined;
	return body[1].toUpperCase() === "PASS" ? "pass" : "changes";
}

function move(
	state: ShipState,
	issue: number,
	at: number,
	patch: Partial<ShipPath>,
): ShipState {
	const prev = state.paths[issue] ?? {
		issue,
		stage: "working" as const,
		codex: false,
		at,
	};
	const next = { ...prev, ...patch };
	if (patch.stage !== undefined && patch.stage !== prev.stage) next.at = at;
	const prIssue =
		patch.pr === undefined
			? state.prIssue
			: { ...state.prIssue, [patch.pr]: issue };
	return { paths: { ...state.paths, [issue]: next }, prIssue };
}

/** Folds one journal event into the ship paths. */
export function applyShip(state: ShipState, e: BullpenEvent): ShipState {
	let next = state;
	if (e.kind === "message") {
		for (const m of e.detail.matchAll(PR_ANNOUNCE))
			next = move(next, Number(m[1]), e.at, {
				pr: Number(m[2]),
				stage: "pr-open",
			});
		for (const m of e.detail.matchAll(REVIEW_ASK))
			next = move(next, Number(m[1]), e.at, {
				pr: Number(m[2]),
				stage: "in-review",
			});
		for (const m of e.detail.matchAll(VERDICT)) {
			const pass = m[3] === "PASS";
			next = move(next, Number(m[2]), e.at, {
				pr: Number(m[1]),
				stage: pass ? "approved" : "changes",
				verdict: pass ? "pass" : "changes",
			});
		}
	}
	if (e.kind === "tool" && e.target === "Bash" && GH_PR.test(e.detail)) {
		const create = /\bgh\s+pr\s+create\b/.test(e.detail);
		const closes = /Closes\s+#(\d{1,7})/i.exec(e.detail);
		if (create && closes?.[1])
			next = move(next, Number(closes[1]), e.at, { stage: "pr-open" });
		for (const pr of prNumbers(e.detail)) {
			const issue = next.prIssue[pr];
			if (issue === undefined) continue;
			const verdict = commandVerdict(e.detail);
			if (verdict)
				next = move(next, issue, e.at, {
					stage: verdict === "pass" ? "approved" : "changes",
					verdict,
				});
			else if (/@codex\s+review/i.test(e.detail))
				next = move(next, issue, e.at, { codex: true, stage: "in-review" });
			else if (/\bgh\s+pr\s+merge\b/.test(e.detail))
				next = move(next, issue, e.at, { stage: "merged" });
		}
	}
	for (const closed of e.confirmedCloses ?? [])
		next = move(next, closed, e.at, { stage: "shipped" });
	return next;
}

/** Each issue's ship path after `events`, in order. */
export function shipPaths(
	events: readonly BullpenEvent[],
	closed: readonly number[] = [],
): Record<number, ShipPath> {
	let state = events.reduce(applyShip, EMPTY_SHIP);
	for (const issue of closed)
		state = move(state, issue, state.paths[issue]?.at ?? 0, {
			stage: "shipped",
		});
	return state.paths;
}
