import { expect, test } from "claude-code/testing";

import {
	addSnapshot,
	burndownKey,
	classifyFailure,
	countArgv,
	createPollLoop,
	exactCounts,
	fetchCounts,
	GH_MISSING,
	headerText,
	issueListArgv,
	parseBurndown,
	parseIssueList,
	parseRepo,
	parseRepoHost,
	pollDelay,
	readCount,
	readIssueList,
	runFailure,
	tally,
} from "../src/github";
import type { BurndownPoint } from "../types";

// As gh 2.4 prints it for `--json number,title,state,labels,closedAt,assignees`.
const LIST = JSON.stringify([
	{
		assignees: [{ id: "U_1", login: "smith", name: "" }],
		closedAt: null,
		labels: [{ id: "LA_1", name: "bug", description: "", color: "d73a4a" }],
		number: 208,
		state: "OPEN",
		title: "auth redirect loop",
	},
	{
		assignees: [],
		closedAt: "2026-10-17T14:02:11Z",
		labels: [],
		number: 199,
		state: "CLOSED",
		title: "flaky login test",
	},
	{
		assignees: [],
		closedAt: "0001-01-01T00:00:00Z",
		labels: [],
		number: 204,
		state: "OPEN",
		title: "skip or fix?",
	},
]);

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr: string, exitCode = 1) => ({
	exitCode,
	stdout: "",
	stderr,
});

test("issueListArgv asks for every state and adds the filter only when set", async () => {
	expect(issueListArgv("")).toEqual([
		"gh",
		"issue",
		"list",
		"--json",
		"number,title,state,labels,closedAt,assignees",
		"--state",
		"all",
		"--limit",
		"200",
	]);
	expect(issueListArgv(" label:bug ").slice(-2)).toEqual([
		"--search",
		"label:bug",
	]);
});

test("parseIssueList normalizes state, labels, assignees and closedAt", async () => {
	const issues = parseIssueList(LIST);
	expect(issues).toEqual([
		{
			number: 208,
			title: "auth redirect loop",
			state: "open",
			labels: ["bug"],
			assignees: ["smith"],
		},
		{
			number: 199,
			title: "flaky login test",
			state: "closed",
			labels: [],
			assignees: [],
			closedAt: Date.parse("2026-10-17T14:02:11Z"),
		},
		{
			number: 204,
			title: "skip or fix?",
			state: "open",
			labels: [],
			assignees: [],
		},
	]);
	expect(parseIssueList("[]")).toEqual([]);
});

test("parseIssueList rejects output that isn't an issue list", async () => {
	expect(parseIssueList("")).toBeUndefined();
	expect(parseIssueList("not json")).toBeUndefined();
	expect(parseIssueList('{"number":1}')).toBeUndefined();
	expect(parseIssueList('[{"number":"1","title":"x","state":"OPEN"}]')).toBe(
		undefined,
	);
});

test("parseRepo reads nameWithOwner", async () => {
	expect(parseRepo('{"nameWithOwner":"nholik/claude-bullpen"}')).toBe(
		"nholik/claude-bullpen",
	);
	expect(parseRepo("")).toBeUndefined();
	expect(parseRepo("{}")).toBeUndefined();
});

test("readIssueList passes a good run through", async () => {
	const result = readIssueList(ok(LIST));
	expect(result.status).toBe("ok");
	expect(headerText(result)).toBe("1/3 closed");
	expect(readIssueList(ok("garbage"))).toEqual({
		status: "error",
		message: "gh: unreadable issue list",
	});
});

test("readIssueList names each failure from gh's own words", async () => {
	// gh 2.4 with no stored credentials exits 4.
	expect(
		readIssueList(
			fail(
				"Welcome to GitHub CLI!\n\nTo authenticate, please run `gh auth login`.",
				4,
			),
		).status,
	).toBe("signed-out");
	expect(
		readIssueList(
			fail(
				"HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login",
			),
		).status,
	).toBe("signed-out");
	expect(
		readIssueList(
			fail(
				"fatal: not a git repository (or any of the parent directories): .git\n/usr/bin/git: exit status 128",
			),
		).status,
	).toBe("not-github");
	expect(
		readIssueList(
			fail(
				"none of the git remotes configured for this repository point to a known GitHub host.",
			),
		).status,
	).toBe("not-github");
	expect(
		readIssueList(
			fail(
				"GraphQL: API rate limit exceeded for user ID 1. (repository.issues)",
			),
		).status,
	).toBe("rate-limited");
	expect(
		readIssueList(fail("HTTP 403: You have exceeded a secondary rate limit"))
			.status,
	).toBe("rate-limited");
});

test("an unknown failure keeps gh's first line, short", async () => {
	const result = classifyFailure(`something odd ${"x".repeat(100)}\nmore`);
	expect(result.status).toBe("error");
	expect(headerText(result)).toBe(`gh: something odd ${"x".repeat(46)}`);
	expect(headerText(classifyFailure(""))).toBe("gh: gh failed");
});

test("headerText says when gh is missing, and nothing before a poll", async () => {
	expect(headerText(GH_MISSING)).toBe("gh not installed");
	expect(headerText(undefined)).toBe("");
});

test("runFailure tells a missing gh from a slow one", async () => {
	expect(runFailure(new Error("spawn gh ENOENT"))).toEqual(GH_MISSING);
	expect(runFailure("cannot start")).toEqual({
		status: "error",
		message: "gh: cannot start",
	});
	expect(
		headerText(runFailure(new Error("process timed out after 30000 ms"))),
	).toBe("gh timed out");
});

test("tally counts open and closed", async () => {
	expect(tally(parseIssueList(LIST) ?? [])).toEqual({ open: 2, closed: 1 });
	expect(tally([])).toEqual({ open: 0, closed: 0 });
});

const at = (t: number, open: number, closed: number): BurndownPoint => ({
	at: t,
	open,
	closed,
});

test("addSnapshot keeps the ends of a flat run and every change", async () => {
	let series: BurndownPoint[] = [];
	series = addSnapshot(series, at(0, 12, 0));
	series = addSnapshot(series, at(1, 12, 0));
	series = addSnapshot(series, at(2, 12, 0));
	series = addSnapshot(series, at(3, 12, 0));
	expect(series).toEqual([at(0, 12, 0), at(3, 12, 0)]);
	series = addSnapshot(series, at(4, 11, 1));
	series = addSnapshot(series, at(5, 11, 1));
	expect(series).toEqual([
		at(0, 12, 0),
		at(3, 12, 0),
		at(4, 11, 1),
		at(5, 11, 1),
	]);
});

test("addSnapshot caps the series, dropping the oldest", async () => {
	let series: BurndownPoint[] = [];
	for (let i = 0; i < 10; i++) series = addSnapshot(series, at(i, i, 0), 4);
	expect(series.map((p) => p.at)).toEqual([6, 7, 8, 9]);
});

test("parseBurndown keeps a stored series and drops anything else", async () => {
	expect(parseBurndown([{ at: 1, open: 2, closed: 3, extra: true }])).toEqual([
		at(1, 2, 3),
	]);
	expect(parseBurndown(undefined)).toEqual([]);
	expect(parseBurndown([{ at: "1" }])).toEqual([]);
});

test("burndownKey is per repo and trimmed filter", async () => {
	expect(burndownKey("o/r", " label:bug ")).toBe("burndown:o/r:label:bug");
	expect(burndownKey("o/r", "")).toBe("burndown:o/r:");
});

const capped = Array.from({ length: 200 }, (_, i) => ({
	number: i + 1,
	title: "issue",
	state: "open" as const,
	labels: [],
	assignees: [],
}));

test("search counts scope the repository, filter and state without shell interpolation", async () => {
	expect(countArgv("o/r", ' label:"good first issue" ', "closed")).toEqual([
		"gh",
		"api",
		"search/issues",
		"--hostname",
		"github.com",
		"-X",
		"GET",
		"-f",
		'q=repo:o/r is:issue label:"good first issue" state:closed',
		"--jq",
		"if .incomplete_results then empty else .total_count end",
	]);
});

test("counts beyond 200 drive the header and snapshot data", async () => {
	const counts = await fetchCounts(
		async (argv) =>
			ok(argv.includes("q=repo:o/r is:issue  state:open") ? "251" : "49"),
		"o/r",
		"",
	);
	const result = { status: "ok" as const, issues: capped, counts };
	expect(exactCounts(result)).toEqual({ open: 251, closed: 49 });
	expect(headerText(result)).toBe("49/300 closed");
});

test("failed searches leave capped counts unknown and do not produce snapshot counts", async () => {
	const counts = await fetchCounts(
		async (argv) => {
			if (argv.some((arg) => arg.endsWith("state:closed")))
				throw new Error("offline");
			return ok("251");
		},
		"o/r",
		"",
	);
	expect(counts).toBeUndefined();
	const result = { status: "ok" as const, issues: capped, counts };
	expect(exactCounts(result)).toBeUndefined();
	expect(headerText(result)).toBe("200+ issues (counts unavailable)");
	expect(exactCounts({ status: "ok", issues: [] })).toEqual({
		open: 0,
		closed: 0,
	});
});

test("count parsing rejects incomplete, failed and malformed responses", async () => {
	for (const value of ["", "null", "-1", "1.5", "NaN", "9007199254740992"])
		expect(readCount(ok(value))).toBeUndefined();
	expect(readCount(fail("rate limited"))).toBeUndefined();
	expect(readCount(ok("0\n"))).toBe(0);
	expect(await fetchCounts(async () => ok(""), "o/r", "")).toBeUndefined();
});

test("Enterprise counts carry the resolved host and isolate stored history", async () => {
	const host = parseRepoHost(
		'{"url":"https://github.example.test/owner/repo"}',
	);
	expect(host).toBe("github.example.test");
	expect(parseRepoHost("{}")).toBeUndefined();
	expect(parseRepoHost('{"url":"not a URL"}')).toBeUndefined();
	expect(parseRepoHost('{"url":"file:///repo"}')).toBeUndefined();
	const calls: string[][] = [];
	const counts = await fetchCounts(
		async (argv) => {
			calls.push(argv);
			return ok("12");
		},
		"owner/repo",
		"",
		host,
	);
	expect(counts).toEqual({ open: 12, closed: 12 });
	expect(calls.length).toBe(2);
	for (const argv of calls)
		expect(argv[argv.indexOf("--hostname") + 1]).toBe(host);
	expect(burndownKey("owner/repo", "", host)).toBe(
		"burndown:github.example.test/owner/repo:",
	);
	expect(burndownKey("owner/repo", "", host)).not.toBe(
		burndownKey("owner/repo", ""),
	);
});

test("SSO and network failures have actionable distinct header states", () => {
	for (const error of [
		"SAML enforcement: authentication failed",
		"Resource protected by organization SAML",
		"SSO authorization required",
	])
		expect(classifyFailure(error).status).toBe("sso-required");
	for (const error of [
		"error connecting to api.github.com",
		"dial tcp: no such host",
		"TLS handshake timeout",
	])
		expect(classifyFailure(error).status).toBe("network");
	expect(runFailure(new Error("permission denied")).status).toBe("error");
});

test("poll backoff is bounded and a success restores the base interval", () => {
	expect([0, 1, 2, 3, 4, 1000].map((n) => pollDelay(60000, n))).toEqual([
		60000, 120000, 240000, 480000, 600000, 600000,
	]);
	expect(pollDelay(60000, 0)).toBe(60000);
	expect(pollDelay(900000, 4)).toBe(900000);
});

test("a repository with 1205 open issues uses search totals and a bounded list", async () => {
	const fixture = Array.from({ length: 1205 }, (_, i) => ({
		number: i + 1,
		title: `Issue ${i + 1}`,
		state: "OPEN",
		labels: [],
		assignees: [],
	}));
	const list = readIssueList(ok(JSON.stringify(fixture.slice(0, 200))));
	expect(headerText(list)).toBe("200+ issues (counts unavailable)");
	if (list.status !== "ok") throw new Error("fixture did not parse");
	const counts = await fetchCounts(
		async (argv) =>
			ok(argv.some((s) => s.endsWith("state:open")) ? "1205" : "95"),
		"o/r",
		"",
	);
	expect(list.issues.length).toBe(200);
	expect(headerText({ ...list, counts })).toBe("95/1300 closed");
});

test("a manual success resets the backed-off poll loop to the base cadence", async () => {
	const timers: { ms: number; fn: () => void; cancelled: boolean }[] = [];
	const results = [false, false, false];
	const loop = createPollLoop({
		baseMs: 60000,
		poll: async () => results.shift(),
		current: () => true,
		after: (ms, fn) => {
			const t = { ms, fn, cancelled: false };
			timers.push(t);
			return {
				cancel: () => {
					t.cancelled = true;
				},
			};
		},
	});
	const settle = async () => {
		for (let i = 0; i < 10; i++) await Promise.resolve();
	};
	loop.start();
	await settle();
	timers.at(-1)?.fn();
	await settle();
	expect(timers.map((t) => t.ms)).toEqual([120000, 240000]);
	loop.recover();
	expect(timers[1]?.cancelled).toBe(true);
	expect(timers.at(-1)?.ms).toBe(60000);
	// The next automatic failure starts from one failure, not three.
	timers.at(-1)?.fn();
	await settle();
	expect(timers.at(-1)?.ms).toBe(120000);
});
