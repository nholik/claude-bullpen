// A worst-case team for the render budget (tests/render-perf.test.ts): 8
// teammates, 20 issues each on the way to shipping, and a full hallway of
// 2000-character messages (the reducer keeps 50), 50 open decisions (its
// retained maximum) and open asks from idle, stalled and gone teammates. Shaped on real journal lines,
// with names, paths and prompt text replaced by neutral placeholders. Built in
// code rather than written out: the hallway text alone would be 100 KB.

import type { BullpenEvent } from "../../types";

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
export const WORST_NOW = T0 + 60 * 60_000;

export const WORST_NAMES = [
	"ada",
	"smith",
	"iris",
	"vale",
	"gate",
	"ux-judge",
	"kit",
	"rhea",
];

/** Live presence: some of the team is idle or gone, the rest silent but running (stalled). */
export const WORST_PRESENT: Record<string, "running" | "idle" | "gone"> = {
	smith: "idle",
	iris: "idle",
	vale: "gone",
	rhea: "gone",
};

const ISSUES = 20;
const DECISIONS = 50;
const HALLWAY = 50;
const WORDS = [
	"the",
	"cache",
	"renders",
	"per",
	"session",
	"then",
	"falls",
	"back",
	"to",
	"a",
	"wide-界-character",
	"\u{1F469}\u200D\u{1F4BB}",
	"row",
	"before",
	"#7",
	"settles",
];

/** 2000 characters of placeholder prose, different for each message. */
const prose = (seed: number): string => {
	let out = "";
	for (let i = 0; out.length < 2000; i++)
		out += `${WORDS[(seed * 7 + i * 3) % WORDS.length]} `;
	return out.slice(0, 2000);
};

const events: BullpenEvent[] = [];
const push = (
	offsetSec: number,
	kind: BullpenEvent["kind"],
	who: string,
	detail: string,
	extra: Partial<BullpenEvent> = {},
) =>
	events.push({
		version: 1,
		at: T0 + offsetSec * 1000,
		kind,
		who,
		detail,
		issues: [],
		...extra,
	});

WORST_NAMES.forEach((name, i) => {
	push(i, "spawn", "lead", `teammate ${name} joined`, {
		target: name,
		issues: [i + 1],
	});
});

for (let issue = 1; issue <= ISSUES; issue++) {
	const name = WORST_NAMES[issue % WORST_NAMES.length] ?? "ada";
	const pr = 100 + issue;
	const base = 30 + issue * 20;
	push(base, "turn-start", name, "started a turn", {
		agentId: `a-${name}`,
		issues: [issue],
	});
	push(base + 5, "tool", name, "edit file.ts", {
		agentId: `a-${name}`,
		target: "Edit",
		issues: [issue],
	});
	push(
		base + 10,
		"message",
		name,
		`#${issue}: PR is up https://example.invalid/pull/${pr}`,
		{
			agentId: `a-${name}`,
			target: "team-lead",
			issues: [issue, pr],
		},
	);
	// A spread of stages: reviewed, bounced, merged, or still open.
	if (issue % 4 !== 0)
		push(
			base + 12,
			"message",
			"gate",
			`PR #${pr} (#${issue}): ${issue % 3 === 0 ? "FAIL, tests fail" : "PASS"}`,
			{
				agentId: "a-gate",
				target: "team-lead",
				issues: [issue, pr],
			},
		);
	if (issue % 5 === 0)
		push(base + 15, "message", "lead", `merged #${issue}`, { issues: [issue] });
}

// Open asks to the lead from idle, stalled and gone teammates: a question
// mark is what makes a message an ask, and nothing answers them.
for (const [i, name] of [
	"smith",
	"iris",
	"vale",
	"rhea",
	"gate",
	"kit",
].entries())
	push(
		30 + ISSUES * 20 + 20 + i,
		"message",
		name,
		`Blocked on #${i + 1}, can you confirm the approach?`,
		{
			agentId: `a-${name}`,
			target: "team-lead",
			issues: [i + 1],
		},
	);

// Open decisions for the needs view: the lead put them to the person, who has
// not answered. They come before the hallway, which keeps the last 50 messages.
for (let i = 0; i < DECISIONS; i++)
	push(
		30 + ISSUES * 20 + 40 + i * 5,
		"decision",
		"lead",
		`Skip or fix the failing test on #${(i % ISSUES) + 1} (round ${i})?`,
		{
			context: "The review bounced twice and the fix touches the shared cache.",
			issues: [(i % ISSUES) + 1],
		},
	);

const hallwayStart = 30 + ISSUES * 20 + 40 + DECISIONS * 5 + 60;
for (let i = 0; i < HALLWAY + 10; i++) {
	const name = WORST_NAMES[i % WORST_NAMES.length] ?? "ada";
	push(hallwayStart + i * 10, "message", name, prose(i), {
		agentId: `a-${name}`,
		target:
			i % 3 === 0
				? "team-lead"
				: (WORST_NAMES[(i + 1) % WORST_NAMES.length] ?? "ada"),
		issues: [(i % ISSUES) + 1],
	});
}

export default events;
