// Merge-ready PRs for the needs-you queue: the one batched `gh api graphql`
// query that asks about every open PR, and the rule that decides which are
// ready for the human to merge. Pure; the hook layer runs the command.

import type { ReadyPr } from "../types";
import type { RunOutput } from "./github";
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
const COMMENTS = 20;

/** Longest title kept, in characters. */
const TITLE = 120;

const QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:${PRS},orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url headRefOid mergeable commits(last:1){nodes{commit{oid statusCheckRollup{state}}}} comments(last:${COMMENTS}){nodes{body}} reviewThreads(last:${THREADS}){pageInfo{hasPreviousPage} nodes{isResolved isOutdated comments(first:1){nodes{body}}}}}}}}`;

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

const PrSchema = looseObject({
	number: number(),
	title: string(),
	url: string(),
	headRefOid: string(),
	mergeable: string(),
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
	comments: Bodies,
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

const GATE = /^Gate:\s*(\S.*)$/;
const GATE_PASS = /^Gate: PASS ([0-9a-f]{40})\s*$/;
/** Codex's inline findings carry a severity badge: `![P1 Badge](...)`. */
const BADGE = /\bP[01] Badge\b/;

/**
 * True when the newest comment that speaks for the gate (first line `Gate: ...`)
 * is `Gate: PASS <sha>` with exactly the PR's current head. A later FAIL or a
 * PASS for another sha means the gate has not passed this head.
 */
export function gatePassed(bodies: readonly string[], head: string): boolean {
	// Each pass moves `i` toward 0, so the walk ends.
	for (let i = bodies.length - 1; i >= 0; i--) {
		const first = (bodies[i] ?? "").replace(/\r/g, "").split("\n", 1)[0] ?? "";
		if (!GATE.test(first)) continue;
		return GATE_PASS.exec(first)?.[1] === head;
	}
	return false;
}

/**
 * Codex's P0/P1 findings still open on the head: a review thread that is
 * neither resolved nor outdated (its lines unchanged since) and whose opening
 * comment carries the P0 or P1 badge. Inline threads are the reliable signal:
 * the summary comment's `codex-review-state` marker only says which commit was
 * reviewed, not what is still open.
 */
export function openCodexFindings(
	threads: readonly {
		isResolved: boolean;
		isOutdated: boolean;
		comments: { nodes: readonly { body: string }[] };
	}[],
): number {
	return threads.filter(
		(t) =>
			!t.isResolved &&
			!t.isOutdated &&
			BADGE.test(t.comments.nodes[0]?.body ?? ""),
	).length;
}

/**
 * The PRs ready to merge in `gh api graphql` output, or undefined if the output
 * isn't that. Anything unknown (no checks, a long thread list we could not read
 * whole, a mergeability GitHub has not computed) counts as not ready.
 */
export function parseReady(
	stdout: string,
	checkedAt: number,
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
		if (
			pr.mergeable !== "MERGEABLE" ||
			tip?.oid !== pr.headRefOid ||
			tip.statusCheckRollup?.state !== "SUCCESS" ||
			pr.reviewThreads.pageInfo.hasPreviousPage ||
			openCodexFindings(pr.reviewThreads.nodes) > 0 ||
			!gatePassed(
				pr.comments.nodes.map((c) => c.body),
				pr.headRefOid,
			)
		)
			continue;
		ready.push({
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
): ReadyPr[] | undefined {
	return run.exitCode === 0 ? parseReady(run.stdout, checkedAt) : undefined;
}
