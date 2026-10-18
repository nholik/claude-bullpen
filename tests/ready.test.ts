import { expect, test } from "claude-code/testing";
import { gatePassed, parseReady, readReady, readyArgv } from "../src/ready";
import { HEAD, MIXED, NO_PRS, OLD, READY_ONLY } from "./fixtures/ready-prs";

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
