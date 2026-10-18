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
		ci?: string | null;
		comments?: (string | { body: string; by: string })[];
		threads?: Thread[];
		moreThreads?: boolean;
		title?: string;
	} = {},
) {
	const head = over.head ?? HEAD;
	return {
		number,
		title: over.title ?? `Change number ${number}`,
		url: `${URL}/${number}`,
		headRefOid: head,
		mergeable: over.mergeable ?? "MERGEABLE",
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
			nodes: (over.comments ?? [`Gate: PASS ${head}\nChecked.`]).map((c) =>
				typeof c === "string"
					? { body: c, authorAssociation: "OWNER" }
					: { body: c.body, authorAssociation: c.by },
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

export const NO_PRS = wrap([]);
