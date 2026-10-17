// Pure pieces of the GitHub source: the `gh` argv to run, parsing what it
// prints, naming its failures, and keeping a burndown series. The hook layer
// runs the commands and stores the results.

import type { BurndownPoint, GhIssue, GhResult } from "../types";
import {
	array,
	integer,
	looseObject,
	nullable,
	number,
	optional,
	picklist,
	pipe,
	safeParse,
	string,
} from "./vendor/valibot.js";

/** How often the hook layer asks `gh` for the issue list. */
export const POLL_MS = 60_000;

/** Fields `gh issue list --json` returns; all exist in gh 2.4 and later. */
export const ISSUE_FIELDS = "number,title,state,labels,closedAt,assignees";

/** At most this many burndown points are kept per repo and filter. */
export const BURNDOWN_CAP = 500;

export const ISSUE_LIMIT = 200;

export function issueListArgv(filter: string, limit = ISSUE_LIMIT): string[] {
	const argv = ["gh", "issue", "list", "--json", ISSUE_FIELDS];
	argv.push("--state", "all", "--limit", String(limit));
	if (filter.trim()) argv.push("--search", filter.trim());
	return argv;
}

export const REPO_ARGV = ["gh", "repo", "view", "--json", "nameWithOwner,url"];

/** What `$.process.run` resolves with, as far as this module reads it. */
export type RunOutput = { exitCode: number; stdout: string; stderr: string };

const IssueSchema = looseObject({
	number: pipe(number(), integer()),
	title: string(),
	state: picklist(["OPEN", "CLOSED", "open", "closed"]),
	labels: optional(array(looseObject({ name: string() })), []),
	assignees: optional(array(looseObject({ login: string() })), []),
	closedAt: optional(nullable(string())),
});

const IssueListSchema = array(IssueSchema);

/** Parses an ISO time; gh prints Go's zero time (`0001-...`) for "never". */
function time(iso: string | null | undefined): number | undefined {
	if (!iso || iso.startsWith("0001-")) return undefined;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? undefined : ms;
}

/** The issues in `gh issue list --json` output, or undefined if it isn't that. */
export function parseIssueList(stdout: string): GhIssue[] | undefined {
	let json: unknown;
	try {
		json = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	const parsed = safeParse(IssueListSchema, json);
	if (!parsed.success) return undefined;
	return parsed.output.map((raw) => {
		const issue: GhIssue = {
			number: raw.number,
			title: raw.title,
			state: raw.state.toLowerCase() === "closed" ? "closed" : "open",
			labels: raw.labels.map((l) => l.name),
			assignees: raw.assignees.map((a) => a.login),
		};
		const closedAt = time(raw.closedAt);
		if (closedAt !== undefined) issue.closedAt = closedAt;
		return issue;
	});
}

/** `owner/name` from `gh repo view --json nameWithOwner` output. */
export function parseRepo(stdout: string): string | undefined {
	try {
		const parsed = safeParse(
			looseObject({ nameWithOwner: string() }),
			JSON.parse(stdout),
		);
		return parsed.success ? parsed.output.nameWithOwner : undefined;
	} catch {
		return undefined;
	}
}

/** Resolve the same host as issue list; never guess github.com on parse failure. */
export function parseRepoHost(stdout: string): string | undefined {
	try {
		const parsed = safeParse(
			looseObject({ url: string() }),
			JSON.parse(stdout),
		);
		if (!parsed.success) return undefined;
		const url = new URL(parsed.output.url);
		return url.protocol === "https:" && url.hostname ? url.host : undefined;
	} catch {
		return undefined;
	}
}

/** The result when `gh` could not be started at all. */
export const GH_MISSING: GhResult = {
	status: "missing",
	message: "gh not installed",
};

/** Names why `$.process.run` rejected: gh missing, or still running at the timeout. */
export function runFailure(error: unknown): GhResult {
	const text = error instanceof Error ? error.message : String(error);
	if (/time[sd]? ?out/i.test(text))
		return { status: "error", message: "gh timed out" };
	return GH_MISSING;
}

/** Names a failed `gh` run from its standard error. */
export function classifyFailure(stderr: string): GhResult {
	const text = stderr.toLowerCase();
	if (/rate limit|abuse detection/.test(text))
		return { status: "rate-limited", message: "GitHub rate limited" };
	if (/gh auth login|bad credentials|not logged in|authentication/.test(text))
		return { status: "signed-out", message: "gh not signed in" };
	if (
		/not a git repository|no git remotes|none of the git remotes|known github host|could not determine base repo/.test(
			text,
		)
	)
		return { status: "not-github", message: "not a GitHub repo" };
	if (/executable file not found|command not found|enoent/.test(text))
		return GH_MISSING;
	const first = stderr.trim().split("\n")[0]?.trim() || "gh failed";
	return { status: "error", message: `gh: ${first.slice(0, 60)}` };
}

/** Reads one `gh issue list` run into issues or a named failure. */
export function readIssueList(run: RunOutput): GhResult {
	// gh exits 4 when it needs a sign-in, and may say so on either stream.
	if (run.exitCode === 4)
		return { status: "signed-out", message: "gh not signed in" };
	if (run.exitCode !== 0) return classifyFailure(run.stderr || run.stdout);
	const issues = parseIssueList(run.stdout);
	if (!issues) return { status: "error", message: "gh: unreadable issue list" };
	return { status: "ok", issues };
}

export function tally(issues: readonly GhIssue[]): {
	open: number;
	closed: number;
} {
	const closed = issues.filter((i) => i.state === "closed").length;
	return { open: issues.length - closed, closed };
}

/**
 * Adds `point` to `series`. A run of unchanged counts keeps only its first
 * and latest points, so a quiet hour costs two points, not sixty.
 */
export function addSnapshot(
	series: readonly BurndownPoint[],
	point: BurndownPoint,
	cap = BURNDOWN_CAP,
): BurndownPoint[] {
	const same = (p: BurndownPoint | undefined) =>
		p !== undefined && p.open === point.open && p.closed === point.closed;
	const last = series[series.length - 1];
	const before = series[series.length - 2];
	const next =
		same(last) && same(before)
			? [...series.slice(0, -1), point]
			: [...series, point];
	return next.slice(-cap);
}

const SeriesSchema = array(
	looseObject({ at: number(), open: number(), closed: number() }),
);

/** A stored burndown series, or empty if the stored value isn't one. */
export function parseBurndown(value: unknown): BurndownPoint[] {
	const parsed = safeParse(SeriesSchema, value);
	if (!parsed.success) return [];
	return parsed.output.map(({ at, open, closed }) => ({ at, open, closed }));
}

/** The `$.store` key for one repo and filter's burndown. */
export function burndownKey(
	repo: string,
	filter: string,
	host = "github.com",
): string {
	return `burndown:${host === "github.com" ? repo : `${host}/${repo}`}:${filter.trim()}`;
}

/** A short header string: `5/12 closed`, or what is wrong with gh. */
export function headerText(result: GhResult | undefined): string {
	if (!result) return "";
	if (result.status !== "ok") return result.message;
	const counts = exactCounts(result);
	if (!counts) return `${result.issues.length}+ issues (counts unavailable)`;
	const { open, closed } = counts;
	return `${closed}/${open + closed} closed`;
}

/** Search counts are not restricted by the issue-list page size. */
export function countArgv(
	repo: string,
	filter: string,
	state: "open" | "closed",
	host = "github.com",
): string[] {
	return [
		"gh",
		"api",
		"search/issues",
		"--hostname",
		host,
		"-X",
		"GET",
		"-f",
		`q=repo:${repo} is:issue ${filter.trim()} state:${state}`,
		"--jq",
		"if .incomplete_results then empty else .total_count end",
	];
}

/** A failed or incomplete search must never masquerade as a zero count. */
export function readCount(run: RunOutput): number | undefined {
	const text = run.stdout.trim();
	if (run.exitCode !== 0 || !/^\d+$/.test(text)) return undefined;
	const count = Number(text);
	return Number.isSafeInteger(count) ? count : undefined;
}

/** Exact counts only: a full page may have silently truncated matching issues. */
export function exactCounts(
	result: Extract<GhResult, { status: "ok" }>,
): { open: number; closed: number } | undefined {
	return (
		result.counts ??
		(result.issues.length < ISSUE_LIMIT ? tally(result.issues) : undefined)
	);
}

/** Both state searches must succeed before their totals can be used together. */
export async function fetchCounts(
	run: (argv: string[]) => Promise<RunOutput>,
	repo: string,
	filter: string,
	host = "github.com",
): Promise<{ open: number; closed: number } | undefined> {
	const results = await Promise.allSettled([
		run(countArgv(repo, filter, "open", host)),
		run(countArgv(repo, filter, "closed", host)),
	]);
	const openResult = results[0];
	const closedResult = results[1];
	const open =
		openResult?.status === "fulfilled"
			? readCount(openResult.value)
			: undefined;
	const closed =
		closedResult?.status === "fulfilled"
			? readCount(closedResult.value)
			: undefined;
	return open === undefined || closed === undefined
		? undefined
		: { open, closed };
}
