import { expect, test } from "claude-code/testing";

import { buildModel } from "../src/model";
import { applyEvent, EMPTY_TEAM } from "../src/model/team";
import { foldBatch } from "../src/model/version";
import { DEFAULT_PROFILE, memberRole, roleLabel } from "../src/profile";
import { storyFor, storyLines } from "../src/render/story";
import { issueStatus } from "../src/render/studio";
import type { BullpenEvent, Profile } from "../types";

const T = 1_000_000;
const profile: Profile = {
	...DEFAULT_PROFILE,
	roles: {
		inspector: { role: "gate" },
		ada: { role: "" },
		builder: { role: "engineer" },
	},
};

const ev = (
	at: number,
	kind: BullpenEvent["kind"],
	who: string,
	detail: string,
	extra: Partial<BullpenEvent> = {},
): BullpenEvent => ({
	version: 1,
	at: T + at,
	kind,
	who,
	detail,
	issues: [],
	...extra,
});

test("an empty role falls through to the agent type, and the label agrees", () => {
	const member = { name: "ada", agentType: "builder" };
	expect(memberRole(member, profile)).toBe("engineer");
	expect(roleLabel("ada", "builder", profile)).toBe("engineer");
	expect(memberRole({ name: "x" }, profile)).toBeUndefined();
});

const journal = [
	ev(0, "spawn", "lead", "teammate vale joined", {
		target: "vale",
		agentType: "inspector",
		issues: [7],
	}),
	ev(1, "turn-start", "vale", "review", { agentId: "a1", issues: [7] }),
	ev(2, "message", "vale", "#7 does not pass: tests fail", {
		target: "smith",
		issues: [7],
	}),
];

test("a reviewer known only by agent type shows IN REVIEW", () => {
	const model = buildModel(journal, T + 3000);
	const status = issueStatus(model, 7, profile, T + 3000);
	expect(status.label).toBe("IN REVIEW");
});

test("a story marks that reviewer's failure as a kickback", () => {
	const story = storyFor(7, journal, {
		filter: "",
		checkedAt: 0,
		burndown: [],
	});
	const text = (p: Profile) =>
		storyLines(story, p, 160, 20)
			.flat()
			.map((s) => s.text)
			.join(" ");
	expect(text(profile)).toContain("kickback");
	expect(text(DEFAULT_PROFILE)).not.toContain("kickback");
});

test("the persisted fold finds a profile-only reviewer's kickback", () => {
	const roles = { vale: "gate" };
	const message = journal[2] as BullpenEvent;
	const withRoles = foldBatch(null, 0, [], [message], false, { roles });
	expect(withRoles.state.kickbacks.length).toBe(1);
	const without = foldBatch(null, 0, [], [message]);
	expect(without.state.kickbacks.length).toBe(0);
	expect(applyEvent(EMPTY_TEAM, message, { roles }).kickbacks.length).toBe(1);
});
