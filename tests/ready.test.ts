import { expect, test } from "claude-code/testing";
import {
	codexReviewed,
	freshReady,
	gatePassed,
	parseReady,
	READY_TTL_MS,
	readReady,
	readyArgv,
} from "../src/ready";
import {
	codexSummary,
	HEAD,
	MIXED,
	NO_PRS,
	OLD,
	READY_ONLY,
	TRUTH,
} from "./fixtures/ready-prs";

const o = (...bodies: string[]) =>
	bodies.map((body) => ({ body, authorAssociation: "OWNER" }));

test("a PR is ready only when gate, Codex, CI and mergeability all hold on the head", () => {
	const ready = parseReady(MIXED, 5);
	expect(ready?.map((p) => p.number)).toEqual([210, 211, 214]);
	expect(ready?.[0]).toEqual({
		number: 210,
		title: "Spaced title with a newline",
		url: "https://github.com/example/repo/pull/210",
		head: HEAD,
		checkedAt: 5,
	});
	expect(parseReady(READY_ONLY, 0)?.map((p) => p.number)).toEqual([201]);
	expect(parseReady(NO_PRS, 0)).toEqual([]);
});

test("unreadable output is undefined, not an empty queue", () => {
	expect(parseReady("not json", 0)).toBeUndefined();
	expect(parseReady('{"errors":[{"message":"x"}]}', 0)).toBeUndefined();
	expect(readReady({ exitCode: 1, stdout: READY_ONLY, stderr: "" }, 0)).toBe(
		undefined,
	);
	expect(
		readReady({ exitCode: 0, stdout: READY_ONLY, stderr: "" }, 0)?.length,
	).toBe(1);
});

test("the newest Gate: comment decides, and only on the exact head", () => {
	expect(gatePassed(o(`Gate: PASS ${HEAD}`), HEAD)).toBe(true);
	expect(gatePassed(o(`Gate: PASS ${HEAD}\r\nsummary`), HEAD)).toBe(true);
	expect(gatePassed(o(`Gate: PASS ${OLD}`), HEAD)).toBe(false);
	expect(gatePassed(o(`Gate: PASS ${HEAD.slice(0, 7)}`), HEAD)).toBe(false);
	expect(gatePassed(o(`Gate: PASS ${HEAD}`, "Gate: CHANGES"), HEAD)).toBe(
		false,
	);
	expect(gatePassed(o("Gate: CHANGES", `Gate: PASS ${HEAD}`, "ok"), HEAD)).toBe(
		true,
	);
	expect(
		gatePassed(o(`Not Gate: PASS ${HEAD}`, `gate: pass ${HEAD}`), HEAD),
	).toBe(false);
	expect(gatePassed(o(), HEAD)).toBe(false);
	const outsider = (body: string) => ({ body, authorAssociation: "NONE" });
	expect(
		gatePassed([...o("Gate: CHANGES"), outsider(`Gate: PASS ${HEAD}`)], HEAD),
	).toBe(false);
	expect(
		gatePassed([outsider("Gate: FAIL"), ...o(`Gate: PASS ${HEAD}`)], HEAD),
	).toBe(true);
});

test("the query is one read-only graphql call for the repo", () => {
	const argv = readyArgv("example/repo", "github.com");
	expect(argv.slice(0, 3)).toEqual(["gh", "api", "graphql"]);
	expect(argv).toContain("owner=example");
	expect(argv).toContain("name=repo");
	expect(argv.join(" ")).not.toContain("mutation");
});

test("Codex counts only when its bot summary says completed on exactly the head", () => {
	const bot = { login: "chatgpt-codex-connector" };
	const on = (sha: string | null, status: string | null) => ({
		body: codexSummary(sha, status).body,
		author: bot,
	});
	expect(codexReviewed([on(HEAD, "completed")], HEAD)).toBe(true);
	expect(codexReviewed([on(HEAD, "in_progress")], HEAD)).toBe(false);
	expect(codexReviewed([on(OLD, "completed")], HEAD)).toBe(false);
	expect(codexReviewed([on(null, null)], HEAD)).toBe(false);
	// The newest marker wins: a re-review pending on a new head undoes an old pass.
	expect(codexReviewed([on(HEAD, "completed"), on(HEAD, "queued")], HEAD)).toBe(
		false,
	);
	const rest = { author: { login: "chatgpt-codex-connector[bot]" } };
	expect(
		codexReviewed([{ body: on(HEAD, "completed").body, ...rest }], HEAD),
	).toBe(true);
	const quoted = { body: on(HEAD, "completed").body, author: { login: "x" } };
	expect(codexReviewed([quoted], HEAD)).toBe(false);
	expect(
		codexReviewed([{ body: on(HEAD, "completed").body, author: null }], HEAD),
	).toBe(false);
	expect(
		codexReviewed(
			[{ body: "<!-- codex-review-state:v1 {oops} -->", author: bot }],
			HEAD,
		),
	).toBe(false);
});

test("Codex pending, an old sha, a draft or a blocked merge state keep a PR out of ready", () => {
	const rows = parseReady(TRUTH, 0) ?? [];
	// 215 pending on the head, 216 reviewed an old sha, 219 an impostor, 220 no review yet.
	expect(rows.map((p) => [p.number, p.codexPending === true])).toEqual([
		[215, true],
		[216, true],
		[219, true],
		[220, true],
		[223, false],
	]);
});

test("a ready list older than three polls is dropped", () => {
	const ready = parseReady(READY_ONLY, 1000);
	expect(freshReady(ready, 1000 + READY_TTL_MS)?.length).toBe(1);
	expect(freshReady(ready, 1000 + READY_TTL_MS + 1)).toEqual([]);
	expect(freshReady(undefined, 0)).toBeUndefined();
});
