import { expect, test } from "claude-code/testing";
import { DEFAULT_PROFILE, roleLabel } from "../src/profile";
import { activityPhrase, shortAge } from "../src/render/activity";

const step = (target: string, detail: string) => ({
	at: 0,
	kind: "tool" as const,
	target,
	detail,
});

test("activityPhrase reads like a verb and an object", () => {
	expect(activityPhrase(step("Edit", "Edit detect.ts"))).toBe(
		"editing detect.ts",
	);
	expect(activityPhrase(step("Bash", "npm run check"))).toBe(
		"running npm run check",
	);
	expect(activityPhrase(step("Bash", "gh issue view 46"))).toBe("reading #46");
	expect(activityPhrase(step("Grep", "Grep foo"))).toBe("searching");
});

test("shortAge steps by the minute", () => {
	expect(shortAge(30_000, 0)).toBe("<1m");
	expect(shortAge(180_000, 0)).toBe("3m");
});

test("roleLabel defaults from the agent type", () => {
	const p = DEFAULT_PROFILE;
	expect(roleLabel("smith", "builder", p)).toBe("engineer");
	expect(roleLabel("gate", "gate", p)).toBe("reviewer");
	expect(roleLabel("iris", "ux-judge", p)).toBe("designer");
	expect(roleLabel("x", "Explore", p)).toBe("researcher");
	expect(roleLabel("x", "general-purpose", p)).toBe("general-purpose");
	expect(roleLabel("lead", undefined, p)).toBe("lead");
	expect(roleLabel("x", undefined, p)).toBe("teammate");
});
