import { expect, test } from "claude-code/testing";

import { PALETTE } from "../src/floor";
import {
	colorFor,
	DEFAULT_PROFILE,
	mergeProfiles,
	parsePartial,
	parseProfile,
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
			issueFilter: "is:open label:bug",
			animations: false,
			pollSeconds: 30,
			roles: { gate: { role: "reviewer", color: "#112233" } },
		}),
	);
	expect(warnings).toEqual([]);
	expect(profile.issueFilter).toBe("is:open label:bug");
	expect(profile.animations).toBe(false);
	expect(profile.pollSeconds).toBe(30);
	expect(profile.roles.gate).toEqual({ role: "reviewer", color: "#112233" });
});

test("invalid fields fall back with a warning each", async () => {
	const { profile, warnings } = parseProfile(
		JSON.stringify({
			issueFilter: 3,
			animations: "yes",
			pollSeconds: 5,
			roles: { a: { color: "teal" }, b: "x", c: { role: "ok" } },
		}),
	);
	expect(profile.issueFilter).toBe(DEFAULT_PROFILE.issueFilter);
	expect(profile.animations).toBe(true);
	expect(profile.pollSeconds).toBe(60);
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
			issueFilter: "user",
			pollSeconds: 20,
			roles: { a: { role: "u" }, b: { role: "u" } },
		}),
	).set;
	const project = parsePartial(
		JSON.stringify({ issueFilter: "project", roles: { a: { role: "p" } } }),
	).set;
	const merged = mergeProfiles(project, user);
	expect(merged.issueFilter).toBe("project");
	expect(merged.pollSeconds).toBe(20);
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
