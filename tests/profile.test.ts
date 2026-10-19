import { expect, test } from "claude-code/testing";

import { PALETTE } from "../src/floor";
import {
	colorFor,
	DEFAULT_PROFILE,
	mergeProfiles,
	parsePartial,
	parseProfile,
	withMemberColors,
} from "../src/profile";

test("missing or empty text gives the defaults and no warnings", async () => {
	expect(parseProfile(undefined)).toEqual({
		profile: DEFAULT_PROFILE,
		set: {},
		warnings: [],
	});
	expect(parseProfile("  ").warnings).toEqual([]);
});

test("a valid file overrides the defaults", async () => {
	const { profile, warnings } = parseProfile(
		JSON.stringify({
			issues: { filter: "is:open label:bug", pollSeconds: 30 },
			animations: false,
			palette: ["#111111", "#222222"],
			roles: { gate: { role: "reviewer", color: "#112233" } },
		}),
	);
	expect(warnings).toEqual([]);
	expect(profile.issues).toEqual({
		filter: "is:open label:bug",
		pollSeconds: 30,
	});
	expect(profile.animations).toBe(false);
	expect(profile.palette).toEqual([0x111111, 0x222222]);
	expect(profile.roles.gate).toEqual({ role: "reviewer", color: "#112233" });
});

test("invalid fields fall back with a warning each", async () => {
	const { profile, warnings } = parseProfile(
		JSON.stringify({
			issues: { filter: 3, pollSeconds: 5 },
			animations: "yes",
			roles: { a: { color: "teal" }, b: "x", c: { role: "ok" } },
		}),
	);
	expect(profile.issues).toEqual(DEFAULT_PROFILE.issues);
	expect(profile.animations).toBe(true);
	expect(profile.roles.a).toEqual({});
	expect(profile.roles.b).toBeUndefined();
	expect(profile.roles.c).toEqual({ role: "ok" });
	expect(warnings.length).toBe(5);
});

test("bad JSON and non-objects never throw", async () => {
	expect(parseProfile("{nope").warnings.length).toBe(1);
	expect(parseProfile("[1]").warnings.length).toBe(1);
	expect(parseProfile("{nope").profile).toEqual(DEFAULT_PROFILE);
});

test("project wins over user, which wins over defaults", async () => {
	const user = parsePartial(
		JSON.stringify({
			issues: { filter: "user", pollSeconds: 20 },
			roles: { a: { role: "u" }, b: { role: "u" } },
		}),
	).set;
	const project = parsePartial(
		JSON.stringify({
			issues: { filter: "project" },
			roles: { a: { role: "p" } },
		}),
	).set;
	const merged = mergeProfiles(project, user);
	expect(merged.issues).toEqual({ filter: "project", pollSeconds: 20 });
	expect(merged.animations).toBe(true);
	expect(merged.roles).toEqual({ a: { role: "p" }, b: { role: "u" } });
});

test("colorFor: hex, palette index, case-insensitive name, fallback", async () => {
	const { profile } = parseProfile(
		JSON.stringify({
			roles: { Gate: { color: "#ff0000" }, builder: { color: 1 } },
		}),
	);
	expect(colorFor("gate", profile, 0)).toBe(0xff0000);
	expect(colorFor("builder", profile, 0)).toBe(PALETTE[1]);
	expect(colorFor("other", profile, 2)).toBe(PALETTE[2]);
	expect(colorFor("other", profile, PALETTE.length + 3)).toBe(PALETTE[3]);
});

test("palette: bad entries dropped, empty falls back, colorFor uses it", async () => {
	const a = parseProfile(
		JSON.stringify({ palette: ["#aabbcc", "red", "#12"] }),
	);
	expect(a.profile.palette).toEqual([0xaabbcc]);
	expect(a.warnings.length).toBe(2);
	const b = parseProfile(JSON.stringify({ palette: [] }));
	expect(b.profile.palette).toEqual(PALETTE);
	expect(b.warnings.length).toBe(1);
	const c = parseProfile(
		JSON.stringify({
			palette: ["#010101", "#020202"],
			roles: { x: { color: 3 } },
		}),
	).profile;
	expect(colorFor("y", c, 3)).toBe(0x020202);
	expect(colorFor("x", c, 0)).toBe(0x020202);
});

test("arrays and scalars are rejected where objects belong", async () => {
	const roles = parseProfile(
		JSON.stringify({ roles: { gate: [], b: null, c: 1, d: { role: "ok" } } }),
	);
	expect(roles.profile.roles).toEqual({ d: { role: "ok" } });
	expect(roles.warnings.length).toBe(3);
	expect(parseProfile(JSON.stringify({ roles: [] })).warnings.length).toBe(1);
	const issues = parseProfile(JSON.stringify({ issues: [] }));
	expect(issues.profile.issues).toEqual(DEFAULT_PROFILE.issues);
	expect(issues.warnings.length).toBe(1);
});

test("colorFor falls back to the agent type's profile color", async () => {
	const { profile } = parseProfile('{"roles":{"builder":{"color":"#ff0000"}}}');
	expect(colorFor("smith", profile, 0, "builder")).toBe(0xff0000);
	expect(colorFor("smith", profile, 0)).not.toBe(0xff0000);
});

test("withMemberColors gives members distinct join-order colors unless the profile chose", async () => {
	const { profile } = parseProfile('{"roles":{"gate":{"color":"#ff0000"}}}');
	const members = [
		{ name: "lead", color: 0 },
		{ name: "vale", color: 1 },
		{ name: "gate", color: 2 },
		{ name: "kit", color: 3, agentType: "gate" },
	];
	const out = withMemberColors(profile, members);
	const color = (n: string, i: number, t?: string) => colorFor(n, out, i, t);
	expect(new Set([color("lead", 0), color("vale", 1)]).size).toBe(2);
	expect(color("lead", 0)).toBe(PALETTE[0]);
	expect(color("gate", 2)).toBe(0xff0000);
	expect(color("kit", 3, "gate")).toBe(0xff0000);
	// Name-only lookups (hallway, huddles, header) agree with the card.
	expect(colorFor("kit", out, 3)).toBe(0xff0000);
});

test("review defaults to GitHub's own signals and reads its two fields", () => {
	expect(DEFAULT_PROFILE.review).toEqual({ bots: [] });
	const ok = parseProfile(
		JSON.stringify({
			review: { requireComment: " Gate: PASS ", bots: ["Codex", "codex"] },
		}),
	);
	expect(ok.warnings).toEqual([]);
	expect(ok.profile.review).toEqual({
		requireComment: "Gate: PASS",
		bots: ["codex"],
	});
	expect(parseProfile("{}").profile.review).toEqual({ bots: [] });
});

test("an unknown bot, a bad marker or a wrong shape warns and is ignored", () => {
	const bots = parseProfile(
		JSON.stringify({ review: { bots: ["codex", "copilot", 3] } }),
	);
	expect(bots.profile.review.bots).toEqual(["codex"]);
	expect(bots.warnings.length).toBe(2);
	expect(bots.warnings[0]).toContain('unknown reviewer "copilot"');
	const bad = parseProfile(
		JSON.stringify({ review: { requireComment: "", bots: "codex" } }),
	);
	expect(bad.profile.review).toEqual({ bots: [] });
	expect(bad.warnings.length).toBe(2);
	expect(parseProfile('{"review":[]}').warnings.length).toBe(1);
});

test("a project's review settings layer over the user's", () => {
	const user = parsePartial(
		'{"review":{"requireComment":"LGTM","bots":["codex"]}}',
	);
	const project = parsePartial('{"review":{"bots":[]}}');
	expect(mergeProfiles(project.set, user.set).review).toEqual({
		requireComment: "LGTM",
		bots: [],
	});
});
