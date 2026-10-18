import { expect, test } from "claude-code/testing";

import { applyBatch } from "../src/collect";
import { buildModel } from "../src/model";
import { claimOwner, ownershipOf } from "../src/ownership";
import type { BullpenEvent } from "../types";

const bash = (command: string) => ownershipOf("Bash", { command });

test("a write inside .worktrees/<n> shows the owner; a read does not", () => {
	const path = "/home/u/src/repo/.worktrees/147/src/model/team.ts";
	expect(ownershipOf("Edit", { file_path: path })).toEqual({
		issue: 147,
		by: "worktree",
	});
	expect(ownershipOf("Write", { file_path: path })?.issue).toBe(147);
	expect(ownershipOf("Read", { file_path: path })).toBeUndefined();
	expect(ownershipOf("Edit", { file_path: "/repo/src/a.ts" })).toBeUndefined();
	expect(
		ownershipOf("Edit", { file_path: "/repo/.worktrees/1470x/a.ts" }),
	).toBeUndefined();
});

test("new worktrees and branches named <n>-slug show the owner", () => {
	const cases = [
		"git worktree add .worktrees/156 -b 156-ownership origin/main",
		"git checkout -b 156-ownership",
		"git switch -c 156-ownership",
		"cd .worktrees/156 && npm test",
		"git -C .worktrees/156 status",
	];
	for (const c of cases)
		expect(bash(c)).toEqual({ issue: 156, by: "worktree" });
	expect(bash("git checkout -b fix-thing")).toBeUndefined();
	expect(bash("git worktree remove .worktrees/110-old")).toBeUndefined();
	expect(bash("ls .worktrees")).toBeUndefined();
});

test("gh pr create with Closes #n shows a PR owner", () => {
	expect(bash('gh pr create --fill --body "Closes #156 and more"')).toEqual({
		issue: 156,
		by: "pr",
	});
	expect(bash("gh pr create --fill")).toBeUndefined();
	expect(bash('gh pr comment 5 --body "Closes #9"')).toBeUndefined();
});

test("a claim from the same or a stronger source wins, a weaker one is ignored", () => {
	expect(claimOwner(undefined, { issue: 1, by: "pr" })?.issue).toBe(1);
	expect(claimOwner("pr", { issue: 2, by: "worktree" })?.issue).toBe(2);
	expect(claimOwner("worktree", { issue: 3, by: "worktree" })?.issue).toBe(3);
	expect(claimOwner("worktree", { issue: 4, by: "pr" })).toBeUndefined();
	expect(claimOwner("pr", { issue: 5, by: "brief" })).toBeUndefined();
});

const T = Date.UTC(2026, 9, 18, 9, 0, 0);
const ev = (
	s: number,
	kind: BullpenEvent["kind"],
	detail: string,
	extra: Partial<BullpenEvent> = {},
): BullpenEvent => ({
	version: 1,
	at: T + s * 1000,
	kind,
	who: "ada",
	detail,
	issues: [],
	...extra,
});

// Modelled on a real builder session: ada works in .worktrees/147 while her
// messages mention neighbouring issues.
test("a builder in .worktrees/147 stays on #147 whatever its messages mention", () => {
	const model = buildModel(
		[
			ev(0, "spawn", "teammate ada joined", { who: "lead", target: "ada" }),
			ev(1, "turn-start", "build"),
			ev(2, "tool", "edit team.ts", {
				target: "Edit",
				owns: 147,
				ownedBy: "worktree",
				issues: [],
			}),
			ev(3, "message", "Unblocked by #126 and #143, ignoring #137", {
				target: "lead",
				issues: [126, 143, 137],
			}),
			ev(4, "tool", "npm test", { target: "Bash", issues: [143] }),
			ev(5, "tool", "gh pr view 126", { target: "Bash", issues: [126] }),
		],
		T + 10_000,
	);
	expect(model.teammates.ada?.issue).toBe(147);
	expect(model.teammates.ada?.owned).toBe("worktree");
});

test("a PR owner does not displace a worktree owner, and the lead takes none", () => {
	const model = buildModel(
		[
			ev(1, "tool", "edit", { target: "Edit", owns: 147, ownedBy: "worktree" }),
			ev(2, "tool", "gh pr create", { target: "Bash", owns: 9, ownedBy: "pr" }),
			ev(3, "tool", "edit", {
				who: "lead",
				target: "Edit",
				owns: 50,
				ownedBy: "worktree",
			}),
		],
		T + 10_000,
	);
	expect(model.teammates.ada?.issue).toBe(147);
	expect(model.teammates.lead?.issue).toBeUndefined();
});

test("the collector journals owns and locks the member against prose", () => {
	const base = {
		op: "event" as const,
		at: T,
		kind: "tool" as const,
		agentId: "a1",
		attribute: true,
	};
	const out = applyBatch({}, [
		{ op: "touch", at: T, id: "a1", patch: { name: "ada" } },
		{
			...base,
			detail: "edit",
			target: "Edit",
			owns: { issue: 147, by: "worktree" },
		},
		{ ...base, detail: "npm test", target: "Bash", text: "#143" },
	]);
	expect(out.members.a1?.issue).toBe(147);
	const owned = out.events.find((e) => e.owns !== undefined);
	expect(owned?.owns).toBe(147);
	expect(owned?.ownedBy).toBe("worktree");
});
