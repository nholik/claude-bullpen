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
	expect(activityPhrase(step("Grep", "Grep"))).toBe("searching code");
});

const COMMANDS: [string, string | undefined][] = [
	["S=/tmp/x", undefined],
	["A=1 B=2", undefined],
	["A=1 B=2 npm test", "running checks"],
	["cd /work/repo && gh…", undefined],
	["cd /work/repo && gi…", undefined],
	[
		"cd /work/x/.worktrees/72 && npm run check 2>&1 | tail -12",
		"running checks",
	],
	["npm install 2>&1 | tail -2; npm run check", "running checks"],
	["npm ci --silent", "installing deps"],
	["cd /work/repo/.work…", undefined],
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
	["git worktree add -q .worktrees/66b -b 66 o…", "setting up a worktree"],
	['rg -n "update" hooks', "searching code"],
];

const TOOLS: [string, string, string | undefined][] = [
	["Edit", "edit team-studio.ts", "editing team-studio.ts"],
	["Write", "write serial.mjs", "writing serial.mjs"],
	["Read", "read 72.png", "reading 72.png"],
	["Glob", "Glob", "searching files"],
	["Monitor", "Monitor", "watching a task"],
	["SendMessage", "message → team-lead", "messaging team-lead"],
	["Agent", "spawn smith", "spawning smith"],
	["ToolSearch", "ToolSearch", "looking up tools"],
	["SubagentHandback", "SubagentHandback", "handing back results"],
	["TaskUpdate", "task #3 completed", "updating tasks"],
	["mcp__x__y", "mcp__x__y", undefined],
	["Bash", "for p in 1 2; do echo $p; done", undefined],
];

test("every tool in real journals gets a verb phrase or none", () => {
	for (const [tool, detail, phrase] of TOOLS)
		expect(activityPhrase(step(tool, detail))).toBe(phrase);
});

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
