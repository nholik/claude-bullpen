// A worst-case team for the render budget (tests/render-perf.test.ts): 8
// teammates, 20 issues each on the way to shipping, and a full hallway of
// 2000-character messages (the reducer keeps 50). Shaped on real journal lines,
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

const ISSUES = 20;
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
	push(base, "turn-start", name, "work", {
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

// Open decisions for the needs view: the lead put them to the person, who has
// not answered. They come before the hallway, which keeps the last 50 messages.
for (let i = 0; i < 6; i++)
	push(
		30 + ISSUES * 20 + 20 + i * 5,
		"decision",
		"lead",
		`Skip or fix the failing test on #${i + 1}?`,
		{
			context: "The review bounced twice and the fix touches the shared cache.",
			issues: [i + 1],
		},
	);

const hallwayStart = 30 + ISSUES * 20 + 60;
for (let i = 0; i < HALLWAY + 10; i++) {
	const name = WORST_NAMES[i % WORST_NAMES.length] ?? "ada";
	push(hallwayStart + i * 10, "message", name, prose(i), {
		agentId: `a-${name}`,
		target: i % 3 === 0 ? "team-lead" : "all",
		issues: [(i % ISSUES) + 1],
	});
}

export default events;
