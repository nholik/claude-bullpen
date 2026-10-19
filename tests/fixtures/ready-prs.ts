// `gh api graphql` output for the merge-ready query (src/ready.ts), shaped like
// the real response with names, URLs and review text redacted.

const sha = (c: string) => c.repeat(40);
export const HEAD = sha("a");
export const OLD = sha("b");

const URL = "https://github.com/example/repo/pull";
const BADGE = (level: string) =>
	`**<sub><sub>![${level} Badge](https://img.shields.io/badge/${level}-orange?style=flat)</sub></sub>  Finding title**\n\nFinding text.`;

type Thread = { isResolved: boolean; isOutdated: boolean; body: string };

function pr(
	number: number,
	over: {
		head?: string;
		tip?: string;
		mergeable?: string;
		merge?: string;
		draft?: boolean;
		/** GitHub's reviewDecision: null when the repo requires no reviews. */
		decision?: string | null;
		/** `latestOpinionatedReviews` states, newest per reviewer. */
		reviews?: string[];
		/** Codex's summary comment; null for none. Defaults to completed on the head. */
		codex?: ReturnType<typeof codexSummary> | null;
		ci?: string | null;
		comments?: (string | { body: string; by: string; login?: string })[];
		threads?: Thread[];
		moreThreads?: boolean;
		/** Older comments exist beyond the window read. */
		moreComments?: boolean;
		title?: string;
	} = {},
) {
	const head = over.head ?? HEAD;
	return {
		number,
		title: over.title ?? `Change number ${number}`,
		url: `${URL}/${number}`,
		headRefOid: head,
		isDraft: over.draft ?? false,
		reviewDecision: over.decision ?? null,
		latestOpinionatedReviews: {
			nodes: (over.reviews ?? []).map((state) => ({ state })),
		},
		mergeable: over.mergeable ?? "MERGEABLE",
		mergeStateStatus: over.merge ?? "CLEAN",
		commits: {
			nodes: [
				{
					commit: {
						oid: over.tip ?? head,
						statusCheckRollup:
							over.ci === null ? null : { state: over.ci ?? "SUCCESS" },
					},
				},
			],
		},
		comments: {
			pageInfo: { hasPreviousPage: over.moreComments ?? false },
			nodes: [
				...(over.comments ?? [`Gate: PASS ${head}\nChecked.`]),
				...(over.codex === null
					? []
					: [over.codex ?? codexSummary(head, "completed")]),
			].map((c) =>
				typeof c === "string"
					? { body: c, authorAssociation: "OWNER", author: { login: "owner" } }
					: {
							body: c.body,
							authorAssociation: c.by,
							author:
								c.login === undefined
									? { login: "someone" }
									: { login: c.login },
						},
			),
		},
		reviewThreads: {
			pageInfo: { hasPreviousPage: over.moreThreads ?? false },
			nodes: (over.threads ?? []).map((t) => ({
				isResolved: t.isResolved,
				isOutdated: t.isOutdated,
				comments: { nodes: [{ body: t.body }] },
			})),
		},
	};
}

/** Codex's summary comment, as the connector bot posts it (`sha` null: no review yet). */
export const codexSummary = (sha: string | null, status: string | null) => ({
	body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: sha, has_any_findings: false, has_unresolved_findings: false, status }, security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null } })} -->\n\n## Codex Review Summary\n`,
	by: "NONE",
	login: "chatgpt-codex-connector",
});

const wrap = (nodes: unknown[]) =>
	JSON.stringify({ data: { repository: { pullRequests: { nodes } } } });

export const READY_ONLY = wrap([pr(201)]);

/** One PR per way of not being ready, then the ready ones (#210, #211 and #214). */
export const MIXED = wrap([
	pr(202, { comments: [`Gate: PASS ${OLD}\nChecked.`] }),
	pr(203, { comments: ["Looks fine to me."] }),
	pr(204, { comments: [`Gate: PASS ${HEAD}\nok`, "Gate: FAIL\nnope"] }),
	pr(205, {
		threads: [{ isResolved: false, isOutdated: false, body: BADGE("P1") }],
	}),
	pr(206, { ci: "FAILURE" }),
	pr(207, { ci: null }),
	pr(208, { mergeable: "CONFLICTING" }),
	pr(209, { tip: OLD }),
	pr(210, {
		threads: [
			{ isResolved: true, isOutdated: false, body: BADGE("P1") },
			{ isResolved: false, isOutdated: true, body: BADGE("P0") },
			{ isResolved: false, isOutdated: false, body: BADGE("P2") },
			{ isResolved: false, isOutdated: false, body: "A human nit." },
		],
		title: "  Spaced   title\nwith a newline ",
	}),
	pr(211, {
		comments: ["Gate: FAIL\nfirst", `Gate: PASS ${HEAD}\nsecond`, "Thanks!"],
	}),
	pr(212, { moreThreads: true }),
	// An outsider's PASS after our CHANGES is not ready; our PASS after their FAIL is.
	pr(213, {
		comments: [
			"Gate: CHANGES\nfix it",
			{ body: `Gate: PASS ${HEAD}`, by: "NONE" },
		],
	}),
	pr(214, {
		comments: [
			{ body: "Gate: FAIL", by: "FIRST_TIME_CONTRIBUTOR" },
			`Gate: PASS ${HEAD}\nok`,
		],
	}),
]);

/** One PR per Codex, draft and merge-state case; see tests/ready.test.ts. */
export const TRUTH = wrap([
	pr(215, { codex: codexSummary(HEAD, "in_progress") }),
	pr(216, { codex: codexSummary(OLD, "completed") }),
	pr(217, { draft: true }),
	pr(218, { merge: "BLOCKED" }),
	// A human quoting the marker is not Codex.
	pr(219, { codex: { ...codexSummary(HEAD, "completed"), login: "someone" } }),
	pr(220, { codex: null }),
	pr(221, { merge: "BEHIND" }),
	pr(222, {
		codex: codexSummary(HEAD, "completed"),
		threads: [{ isResolved: false, isOutdated: false, body: BADGE("P1") }],
	}),
	pr(223, { codex: codexSummary(HEAD, "completed") }),
]);

/** A repo with no gate comment and no Codex: GitHub's own signals decide. */
export const GITHUB = wrap([
	pr(230, { comments: [], codex: null }),
	pr(231, { comments: [], codex: null, decision: "APPROVED" }),
	pr(232, {
		comments: [],
		codex: null,
		decision: "REVIEW_REQUIRED",
		merge: "BLOCKED",
	}),
	pr(233, {
		comments: [],
		codex: null,
		decision: "CHANGES_REQUESTED",
		merge: "BLOCKED",
	}),
	// Blocked for another reason (a failing required check or rule), not a missing review.
	pr(234, { comments: [], codex: null, merge: "BLOCKED" }),
	pr(235, { comments: [], codex: null, merge: "UNSTABLE" }),
	// A human asking for Codex puts it in play; with no answer yet the PR waits.
	pr(236, { comments: ["@codex review"], codex: null }),
	// Starts with `Gate:` but is not `Gate: PASS <sha>`: the gate is in play and unmet.
	// No reviews are required (reviewDecision null) but a human requested changes.
	pr(238, {
		comments: [],
		codex: null,
		reviews: ["APPROVED", "CHANGES_REQUESTED"],
	}),
	pr(239, { comments: [], codex: null, reviews: ["APPROVED", "COMMENTED"] }),
	// A repo with no CI: the rollup is null.
	pr(240, { comments: [], codex: null, ci: null }),
	pr(241, { comments: [], codex: null, ci: "PENDING" }),
	pr(242, { comments: [], codex: null, ci: "ERROR" }),
	// GitHub Enterprise with pre-receive hooks: mergeable, checks passing.
	pr(243, { comments: [], codex: null, merge: "HAS_HOOKS" }),
	// More comments than the window: a Gate: FAIL could be hidden, so not ready.
	pr(244, { comments: [], codex: null, moreComments: true }),
	pr(237, { comments: ["Gate: PASS is how we sign off"], codex: null }),
]);

/** Review threads beyond the window, with the gate comment passing. */
export const TRUTH_THREADS = wrap([pr(250, { moreThreads: true })]);

export const NO_PRS = wrap([]);
