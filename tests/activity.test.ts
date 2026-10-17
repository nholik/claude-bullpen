import { expect, test } from "claude-code/testing";
import { commandPhrase } from "../src/command";
import { DEFAULT_PROFILE, roleLabel } from "../src/profile";
import { activityPhrase } from "../src/render/activity";

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
	expect(activityPhrase(step("Bash", "npm run check"))).toBe("running checks");
	expect(activityPhrase(step("Bash", "gh issue view 46"))).toBe("reading #46");
	expect(activityPhrase(step("Grep", "Grep foo"))).toBe("searching");
});

const COMMANDS: [string, string][] = [
	["S=/tmp/x", "working in the shell"],
	["A=1 B=2", "working in the shell"],
	["A=1 B=2 npm test", "running checks"],
	["cd /work/repo && gh…", "working in the shell"],
	["cd /work/repo && gi…", "working in the shell"],
	[
		"cd /work/x/.worktrees/72 && npm run check 2>&1 | tail -12",
		"running checks",
	],
	["npm install 2>&1 | tail -2; npm run check", "installing deps"],
	["cd /work/repo/.work…", "working in the shell"],
	["cd /w && npm run typecheck 2>&1 | tail -5", "typechecking"],
	['git add -A && git commit -qm "Show activity"', "committing"],
	["git push -qu origin 72-roles-activity 2>&1|tail -1", "pushing"],
	["git fetch -q && git rebase origin/main 2>&1 | tail -5", "rebasing"],
	['gh pr create --title "x" --body "y"', "opening a PR"],
	["gh pr view 76 --json title,body,headRefName,files", "reviewing PR #76"],
	["gh pr diff 69", "reviewing PR #69"],
	["gh issue view 72 --json body -q .body; gh issue view 63", "reading #72"],
	[
		'gh pr comment 80 --body "@codex review" >/dev/null',
		"commenting on PR #80",
	],
	[
		"node --experimental-strip-types scripts/preview.ts --cols 72",
		"previewing the UI",
	],
	["FOO=1 scripts/snap.sh", "previewing the UI"],
	["git worktree add -q .worktrees/66b -b 66 o…", "git worktree"],
	['rg -n "update" hooks', "rg update"],
];

test("commandPhrase summarizes real commands", () => {
	for (const [command, phrase] of COMMANDS)
		expect(commandPhrase(command)).toBe(phrase);
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
