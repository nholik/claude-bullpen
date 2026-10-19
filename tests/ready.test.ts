import { expect, test } from "claude-code/testing";
import { codexReviewed } from "../src/codex";
import {
	freshReady,
	gatePassed,
	parseReady,
	READY_TTL_MS,
	readReady,
	readyArgv,
} from "../src/ready";
import {
	codexSummary,
	GITHUB,
	HEAD,
	MIXED,
	NO_PRS,
	OLD,
	READY_ONLY,
	TRUTH,
} from "./fixtures/ready-prs";

/** Our own setup: a gate comment and Codex both required. */
const FULL = { requireComment: "Gate: PASS", bots: ["codex"] };
const MARKER = "Gate: PASS";

const o = (...bodies: string[]) =>
	bodies.map((body) => ({ body, authorAssociation: "OWNER" }));

test("a PR is ready only when CI, mergeability and the configured gate and Codex all hold on the head", () => {
	const ready = parseReady(MIXED, 5, FULL);
	expect(ready?.map((p) => p.number)).toEqual([207, 210, 211, 214]);
	expect(ready?.[1]).toEqual({
		gate: true,
		codex: true,
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
	expect(gatePassed(o(`Gate: PASS ${HEAD}`), HEAD, MARKER)).toBe(true);
	expect(gatePassed(o(`Gate: PASS ${HEAD}\r\nsummary`), HEAD, MARKER)).toBe(
		true,
	);
	expect(gatePassed(o(`Gate: PASS ${OLD}`), HEAD, MARKER)).toBe(false);
	expect(gatePassed(o(`Gate: PASS ${HEAD.slice(0, 7)}`), HEAD, MARKER)).toBe(
		false,
	);
	expect(
		gatePassed(o(`Gate: PASS ${HEAD}`, "Gate: CHANGES"), HEAD, MARKER),
	).toBe(false);
	expect(
		gatePassed(o("Gate: CHANGES", `Gate: PASS ${HEAD}`, "ok"), HEAD, MARKER),
	).toBe(true);
	expect(
		gatePassed(o(`Not Gate: PASS ${HEAD}`, `gate: pass ${HEAD}`), HEAD, MARKER),
	).toBe(false);
	expect(gatePassed(o(), HEAD, MARKER)).toBe(false);
	const outsider = (body: string) => ({ body, authorAssociation: "NONE" });
	expect(
		gatePassed(
			[...o("Gate: CHANGES"), outsider(`Gate: PASS ${HEAD}`)],
			HEAD,
			MARKER,
		),
	).toBe(false);
	expect(
		gatePassed(
			[outsider("Gate: FAIL"), ...o(`Gate: PASS ${HEAD}`)],
			HEAD,
			MARKER,
		),
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
	const rows = parseReady(TRUTH, 0, FULL) ?? [];
	// 215 pending on the head, 216 reviewed an old sha, 219 an impostor quoting
	// the marker, 220 no review yet: all queued as waiting. 222 has an open P1.
	expect(rows.map((p) => [p.number, p.reviewPending === true])).toEqual([
		[215, true],
		[216, true],
		[219, true],
		[220, true],
		[223, false],
	]);
});

test("with no review config, Codex and the gate comment are ignored", () => {
	const plain = parseReady(TRUTH, 0) ?? [];
	// 222's open P1 and every Codex state are invisible; 217, 218 and 221 are
	// out on GitHub's own signals.
	expect(plain.map((p) => [p.number, p.reviewPending === true])).toEqual([
		[215, false],
		[216, false],
		[219, false],
		[220, false],
		[222, false],
		[223, false],
	]);
	expect(plain.some((p) => p.gate || p.codex)).toBe(false);
	const gateOnly = parseReady(TRUTH, 0, {
		requireComment: "Gate: PASS",
		bots: [],
	});
	expect(gateOnly?.map((p) => p.number)).toEqual([
		215, 216, 219, 220, 222, 223,
	]);
	expect(gateOnly?.every((p) => p.gate && !p.codex)).toBe(true);
});

test("without a gate or Codex configured, GitHub's review decision, checks and merge state decide", () => {
	const rows = parseReady(GITHUB, 0) ?? [];
	// 233 and 238 changes requested (238 only through a review), 241 and 242
	// have pending or erroring CI, 240 has no CI at all and is ready.
	// 234 blocked otherwise and 235 unstable: out. 236, 237 and 244 carry
	// comments we ignore; 244 has more than the window and is ready anyway.
	expect(
		rows.map((p) => [p.number, p.reviewPending === true, p.approved === true]),
	).toEqual([
		[230, false, false],
		[231, false, true],
		[232, true, false],
		[236, false, false],
		[239, false, false],
		[240, false, false],
		[243, false, false],
		[244, false, false],
		[237, false, false],
	]);
});

test("a truncated comment history leaves a PR out only when comment rules are configured", () => {
	const codex = parseReady(GITHUB, 0, { bots: ["codex"] }) ?? [];
	expect(codex.some((p) => p.number === 244)).toBe(false);
	// Everything else waits on a Codex summary that never came.
	expect(codex.find((p) => p.number === 230)?.reviewPending).toBe(true);
	const gate = parseReady(GITHUB, 0, {
		requireComment: "Gate: PASS",
		bots: [],
	});
	expect(gate?.some((p) => p.number === 244)).toBe(false);
});

test("a custom marker works like Gate: PASS", () => {
	const lgtm = (body: string) => ({ body, authorAssociation: "MEMBER" });
	expect(gatePassed([lgtm(`LGTM ${HEAD}`)], HEAD, "LGTM")).toBe(true);
	expect(gatePassed([lgtm(`LGTM ${OLD}`)], HEAD, "LGTM")).toBe(false);
	expect(
		gatePassed([lgtm(`LGTM ${HEAD}`), lgtm(`LGTM ${OLD}`)], HEAD, "LGTM"),
	).toBe(false);
	expect(gatePassed([lgtm(`Gate: PASS ${HEAD}`)], HEAD, "LGTM")).toBe(false);
	expect(gatePassed([lgtm(`LGTM ${HEAD}`)], HEAD, "  ")).toBe(false);
});

test("a ready list older than three polls is dropped", () => {
	const ready = parseReady(READY_ONLY, 1000);
	expect(freshReady(ready, 1000 + READY_TTL_MS)?.length).toBe(1);
	expect(freshReady(ready, 1000 + READY_TTL_MS + 1)).toEqual([]);
	expect(freshReady(undefined, 0)).toBeUndefined();
});
