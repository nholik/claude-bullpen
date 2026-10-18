// Pure pieces of the GitHub source: the `gh` argv to run, parsing what it
// prints, naming its failures, and keeping a burndown series. The hook layer
// runs the commands and stores the results.

import type { BurndownPoint, GhIssue, GhResult, GithubSource } from "../types";
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

/** Counts and snapshots always cover both states; preserve quoted search text. */
export function allStatesFilter(filter: string): string {
	const tokens = filter.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	return tokens
		.filter((token) => !/^-?(?:is|state):(?:open|closed|all)$/i.test(token))
		.join(" ");
}

export function issueListArgv(filter: string, limit = ISSUE_LIMIT): string[] {
	const argv = ["gh", "issue", "list", "--json", ISSUE_FIELDS];
	argv.push("--state", "all", "--limit", String(limit));
	const search = allStatesFilter(filter);
	if (search) argv.push("--search", search);
	return argv;
}

export const REPO_ARGV = ["gh", "repo", "view", "--json", "nameWithOwner,url"];

export function prArgv(repo: string, host: string, pr: number): string[] {
	return ["gh", "api", `repos/${repo}/pulls/${pr}`, "--hostname", host];
}

export function readPr(
	run: RunOutput,
	checkedAt: number,
): NonNullable<GithubSource["prs"]>[number] | undefined {
	if (run.exitCode !== 0) return undefined;
	try {
		const raw = JSON.parse(run.stdout);
		if (
			!Number.isSafeInteger(raw.number) ||
			raw.number < 1 ||
			!["open", "closed"].includes(raw.state)
		)
			return undefined;
		const mergedAt =
			typeof raw.merged_at === "string" ? time(raw.merged_at) : undefined;
		return {
			number: raw.number,
			state:
				mergedAt === undefined
					? raw.state === "open"
						? "OPEN"
						: "CLOSED"
					: "MERGED",
			checkedAt,
			mergedAt,
		};
	} catch {
		return undefined;
	}
}

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
		return { status: "network", message: "gh timed out" };
	return classifyFailure(text);
}

/** Authorization phrases only: a bare "sso"/"saml" also appears in hostnames and repo names. */
const SSO_PATTERN =
	/saml enforcement|saml sso|sso enforcement|resource protected by (?:organization )?saml|authorize(?:d)? (?:the |this )?(?:token|pat|oauth app|ssh key)|single.sign.on (?:required|enforcement)|requires? (?:saml|sso|single.sign.on)|sso (?:authorization|required)/i;

/** Names a failed `gh` run from its standard error. */
export function classifyFailure(stderr: string): GhResult {
	const text = stderr.toLowerCase();
	if (SSO_PATTERN.test(text))
		return {
			status: "sso-required",
			message: "GitHub SSO authorization required",
		};
	if (
		/network|could not resolve|no such host|connect(?:ion|ing)|dial tcp|tls handshake|certificate|timed? ?out|econn|enotfound/.test(
			text,
		)
	)
		return { status: "network", message: "GitHub network unavailable" };
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
	// SSO can require organization authorization even for a signed-in account.
	if (run.exitCode !== 0 && SSO_PATTERN.test(run.stderr || run.stdout))
		return classifyFailure(run.stderr || run.stdout);
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
		`q=repo:${repo} is:issue ${allStatesFilter(filter)} state:${state}`,
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

/** Repeated failures slow polling; one success restores the configured cadence. */
export function pollDelay(baseMs: number, failures: number): number {
	return Math.max(
		baseMs,
		Math.min(600_000, baseMs * 2 ** Math.min(10, Math.max(0, failures))),
	);
}

/** The automatic poll loop: backs off on failure and can be reset by a manual success. */
export type PollLoop = {
	start(): void;
	/** A manual poll succeeded: clear the failure count and re-time a backed-off timer. */
	recover(): void;
	cancel(): void;
	/** True when no poll is running and the next one is long overdue: its timer died. */
	stalled(nowMs: number): boolean;
};

/** How long past its due time a poll may be before the loop counts as dead. */
export const POLL_GRACE_MS = 30_000;

/** Why the footer has no burndown, in a few words. */
export function noDataReason(
	github: Pick<GithubSource, "result" | "checkedAt">,
	mode: "live" | "demo" | "replay" = "live",
): string {
	if (mode === "demo") return "paused in demo";
	if (mode === "replay") return "paused in replay";
	if (github.result)
		return github.result.status === "ok" ? "no counts" : github.result.message;
	return github.checkedAt > 0 ? "no result yet" : "waiting for first poll";
}

export function createPollLoop(options: {
	baseMs: number;
	/** True for success, false for failure, undefined when the poll was skipped. */
	poll: () => Promise<boolean | undefined>;
	/** False once a newer loop replaces this one. */
	current: () => boolean;
	/** Milliseconds since the epoch, as last known; used to spot a dead timer. */
	now?: () => number;
	after: (ms: number, fn: () => void) => { cancel(): void };
}): PollLoop {
	let failures = 0;
	let running = false;
	let timer: { cancel(): void } | undefined;
	let dueAt = Number.POSITIVE_INFINITY;
	let cancelled = false;
	const schedule = () => {
		if (cancelled || !options.current()) return;
		const delay = pollDelay(options.baseMs, failures);
		dueAt = (options.now?.() ?? 0) + delay;
		timer = options.after(delay, () => void run());
	};
	const run = async () => {
		timer = undefined;
		running = true;
		const success = await options.poll().catch(() => false);
		running = false;
		if (success !== undefined) failures = success ? 0 : failures + 1;
		schedule();
	};
	return {
		start: () => void run(),
		stalled: (nowMs) => !cancelled && !running && nowMs > dueAt + POLL_GRACE_MS,
		cancel() {
			cancelled = true;
			timer?.cancel();
			timer = undefined;
		},
		recover() {
			if (failures === 0) return;
			failures = 0;
			if (running || !timer) return;
			timer.cancel();
			schedule();
		},
	};
}
