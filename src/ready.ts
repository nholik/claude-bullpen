// Merge-ready PRs for the needs-you queue: the one batched `gh api graphql`
// query that asks about every open PR, and the rule that decides which are
// ready for the human to merge. Pure; the hook layer runs the command.

import type { ReadyPr, ReviewConfig } from "../types";
import { codexReviewed, openCodexFindings } from "./codex";
import { POLL_MS, type RunOutput } from "./github";
import {
	array,
	boolean,
	looseObject,
	nullable,
	number,
	optional,
	safeParse,
	string,
} from "./vendor/valibot.js";

/** Open PRs asked about in one call; a busier repo shows its newest. */
const PRS = 30;
/** Review threads and comments read per PR. */
const THREADS = 100;
const COMMENTS = 50;

/** Longest title kept, in characters. */
const TITLE = 120;

const QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:${PRS},orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url headRefOid isDraft reviewDecision mergeable mergeStateStatus latestOpinionatedReviews(first:20){nodes{state}} commits(last:1){nodes{commit{oid statusCheckRollup{state}}}} comments(last:${COMMENTS}){pageInfo{hasPreviousPage} nodes{body authorAssociation author{login}}} reviewThreads(last:${THREADS}){pageInfo{hasPreviousPage} nodes{isResolved isOutdated comments(first:1){nodes{body}}}}}}}}`;

/** One read-only call for every open PR's gate comment, threads, checks and mergeability. */
export function readyArgv(repo: string, host: string): string[] {
	const [owner = "", name = ""] = repo.split("/");
	return [
		"gh",
		"api",
		"graphql",
		"--hostname",
		host,
		"-f",
		`query=${QUERY}`,
		"-F",
		`owner=${owner}`,
		"-F",
		`name=${name}`,
	];
}

const Body = looseObject({ body: string() });
const Bodies = looseObject({ nodes: array(Body) });
const Comments = looseObject({
	pageInfo: looseObject({ hasPreviousPage: boolean() }),
	nodes: array(
		looseObject({
			body: string(),
			authorAssociation: string(),
			author: optional(nullable(looseObject({ login: string() }))),
		}),
	),
});

const PrSchema = looseObject({
	number: number(),
	title: string(),
	url: string(),
	headRefOid: string(),
	isDraft: boolean(),
	reviewDecision: optional(nullable(string())),
	latestOpinionatedReviews: optional(
		looseObject({ nodes: array(looseObject({ state: string() })) }),
	),
	mergeable: string(),
	mergeStateStatus: string(),
	commits: looseObject({
		nodes: array(
			looseObject({
				commit: looseObject({
					oid: string(),
					statusCheckRollup: optional(
						nullable(looseObject({ state: string() })),
					),
				}),
			}),
		),
	}),
	comments: Comments,
	reviewThreads: looseObject({
		pageInfo: looseObject({ hasPreviousPage: boolean() }),
		nodes: array(
			looseObject({
				isResolved: boolean(),
				isOutdated: boolean(),
				comments: Bodies,
			}),
		),
	}),
});

const ResponseSchema = looseObject({
	data: looseObject({
		repository: looseObject({
			pullRequests: looseObject({ nodes: array(PrSchema) }),
		}),
	}),
});

/** Only the repo's own people can speak for the gate; our gate posts as the owner. */
const TRUSTED = ["OWNER", "MEMBER", "COLLABORATOR"];
/**
 * True when the newest trusted comment that speaks for the gate is
 * `<marker> <head>`: its first line is exactly that, with the PR's current
 * head. A comment speaks for the gate when its first line starts with the
 * marker's first word (`Gate:` of `Gate: PASS`), so a later `Gate: FAIL` or a
 * PASS for another sha means the gate has not passed this head.
 */
export function gatePassed(
	comments: readonly { body: string; authorAssociation: string }[],
	head: string,
	marker: string,
): boolean {
	const word = marker.trim().split(/\s+/, 1)[0] ?? "";
	if (word === "") return false;
	// Each pass moves `i` toward 0, so the walk ends.
	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i];
		if (!comment || !TRUSTED.includes(comment.authorAssociation)) continue;
		const first = comment.body.replace(/\r/g, "").split("\n", 1)[0] ?? "";
		if (!first.startsWith(word)) continue;
		return first.trimEnd() === `${marker.trim()} ${head}`;
	}
	return false;
}

/**
 * The PRs ready to merge in `gh api graphql` output, or undefined if the output
 * isn't that. Readiness comes from GitHub's own signals: not a draft, mergeable,
 * the head's checks SUCCESS (or none exist), no changes requested, and `mergeStateStatus`
 * CLEAN or HAS_HOOKS (required reviews and checks satisfied). That excludes
 * BEHIND, DIRTY, UNSTABLE and DRAFT. Anything unknown (a long thread
 * list we could not read whole, a mergeability GitHub has not computed) counts
 * as not ready.
 *
 * A PR still BLOCKED only because a required review is missing
 * (`reviewDecision` REVIEW_REQUIRED) is kept, flagged `reviewPending`, so the
 * queue can show it waiting; it is not merge-ready.
 *
 * `review` adds what a team asks for beyond GitHub: with `requireComment` set
 * the newest trusted marker comment must pass the head; with `codex` among the
 * `bots` Codex's P0/P1 findings must be closed and a Codex review still running
 * on the head is `reviewPending`. Those rules read comments and threads, so a
 * history truncated by the query window leaves the PR out only when one is
 * configured; a plain GitHub repo ignores the window.
 */
export function parseReady(
	stdout: string,
	checkedAt: number,
	review: ReviewConfig = { bots: [] },
): ReadyPr[] | undefined {
	let json: unknown;
	try {
		json = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	const parsed = safeParse(ResponseSchema, json);
	if (!parsed.success) return undefined;
	const ready: ReadyPr[] = [];
	for (const pr of parsed.output.data.repository.pullRequests.nodes) {
		const tip = pr.commits.nodes[0]?.commit;
		const needsReview = pr.reviewDecision === "REVIEW_REQUIRED";
		const marker = review.requireComment?.trim() || undefined;
		const codex = review.bots.includes("codex");
		const readsComments = marker !== undefined || codex;
		if (
			pr.isDraft ||
			!(
				pr.mergeStateStatus === "CLEAN" ||
				// Mergeable with passing checks; GitHub Enterprise pre-receive hooks.
				pr.mergeStateStatus === "HAS_HOOKS" ||
				(needsReview && pr.mergeStateStatus === "BLOCKED")
			) ||
			pr.reviewDecision === "CHANGES_REQUESTED" ||
			// reviewDecision is null where reviews are not required, so read the reviews.
			pr.latestOpinionatedReviews?.nodes.some(
				(r) => r.state === "CHANGES_REQUESTED",
			) ||
			pr.mergeable !== "MERGEABLE" ||
			tip?.oid !== pr.headRefOid ||
			// No checks at all (a null rollup) passes; FAILURE, ERROR and PENDING block.
			(tip.statusCheckRollup && tip.statusCheckRollup.state !== "SUCCESS") ||
			// The configured evidence may sit in comments or threads we did not read.
			(readsComments &&
				(pr.comments.pageInfo.hasPreviousPage ||
					pr.reviewThreads.pageInfo.hasPreviousPage)) ||
			(codex && openCodexFindings(pr.reviewThreads.nodes) > 0) ||
			(marker !== undefined &&
				!gatePassed(pr.comments.nodes, pr.headRefOid, marker))
		)
			continue;
		const codexPending =
			codex && !codexReviewed(pr.comments.nodes, pr.headRefOid);
		const reviewPending = needsReview || codexPending;
		ready.push({
			...(reviewPending ? { reviewPending } : {}),
			...(pr.reviewDecision === "APPROVED" ? { approved: true } : {}),
			...(marker !== undefined ? { gate: true } : {}),
			...(codex ? { codex: true } : {}),
			number: pr.number,
			title: pr.title.replace(/\s+/g, " ").trim().slice(0, TITLE),
			url: pr.url,
			head: pr.headRefOid,
			checkedAt,
		});
	}
	return ready;
}

/** Reads one graphql run; a failed run keeps the previous list (undefined). */
export function readReady(
	run: RunOutput,
	checkedAt: number,
	review?: ReviewConfig,
): ReadyPr[] | undefined {
	return run.exitCode === 0
		? parseReady(run.stdout, checkedAt, review)
		: undefined;
}

/** The ready list is good for this many polls; older means polling has failed. */
export const READY_TTL_MS = 3 * POLL_MS;

/** The ready list when its newest check is recent enough to trust, else none. */
export function freshReady(
	ready: readonly ReadyPr[] | undefined,
	now: number,
): ReadyPr[] | undefined {
	return ready?.filter((pr) => now - pr.checkedAt <= READY_TTL_MS);
}
