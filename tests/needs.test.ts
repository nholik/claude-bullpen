import { expect, test } from "claude-code/testing";
import {
	capped,
	moveCursor,
	parseDecisions,
	quotedPrefix,
	repliedTo,
	waiting,
} from "../src/decisions";
import { buildModel } from "../src/model";
import { type Line, width } from "../src/render/lines";
import {
	needsSection,
	needsYou,
	PULSE_MS,
	pulseColor,
	pulsing,
} from "../src/render/needs";
import { keys, paneView } from "../src/render/pane";
import { STUDIO } from "../src/render/studio";
import type { BullpenEvent } from "../types";

const flat = (line: Line) => line.map((s) => s.text).join("");

test("only explicit Decision: lines are decisions, with the paragraph before them", () => {
	const answer = [
		"Gate failed #204 twice.",
		"The flake is in session expiry.",
		"",
		"Decision: skip or fix the flaky test on #204?",
		"",
		"```",
		"Decision: inside a code block does not count",
		"```",
		"- **Decision:** merge #208 first? **",
		"A question? with no marker is not one.",
	].join("\n");
	const found = parseDecisions(answer);
	expect(found.map((f) => f.text)).toEqual([
		"skip or fix the flaky test on #204?",
		"merge #208 first?",
	]);
	expect(found[0]?.context).toBe(
		"Gate failed #204 twice. The flake is in session expiry.",
	);
	expect(parseDecisions("no decisions here, really?")).toEqual([]);
	expect(parseDecisions("Decision:")).toEqual([]);
	const many = Array.from({ length: 20 }, (_, i) => `Decision: q${i}`).join(
		"\n",
	);
	expect(parseDecisions(many).length).toBeLessThan(20);
});

const T = Date.UTC(2026, 9, 18, 12, 0, 0);
const ev = (
	s: number,
	kind: BullpenEvent["kind"],
	detail: string,
	extra: Partial<BullpenEvent> = {},
): BullpenEvent => ({
	version: 1,
	at: T + s * 1000,
	kind,
	who: "lead",
	detail,
	issues: [],
	...extra,
});

test("a decision waits until the person's next prompt; a restated one is not new", () => {
	const events = [
		ev(0, "decision", "skip or fix #204?", { issues: [204], context: "why" }),
		ev(5, "decision", "skip or fix #204?", { issues: [204] }),
		ev(6, "decision", "merge first?"),
	];
	const model = buildModel(events, T + 10_000);
	expect(model.decisions.map((d) => d.text)).toEqual([
		"skip or fix #204?",
		"merge first?",
	]);
	expect(model.decisions[0]?.context).toBe("why");
	expect(new Set(model.decisions.map((d) => d.id)).size).toBe(2);
	const ids = model.decisions.map((d) => d.id);
	const answered = buildModel(
		[...events, ev(7, "reply", "replied", { answered: ids })],
		T + 10_000,
	);
	expect(answered.decisions).toEqual([]);
	// A decision raised after the reply is open again.
	const next = buildModel(
		[
			...events,
			ev(7, "reply", "replied", { answered: ids }),
			ev(9, "decision", "and this?"),
		],
		T + 10_000,
	);
	expect(next.decisions.map((d) => d.text)).toEqual(["and this?"]);
});

test("teammate messages to the lead never enter needs-you", () => {
	const model = buildModel(
		[
			ev(0, "message", "#204 PASS", { who: "gate", target: "lead" }),
			ev(1, "message", "skip or fix the flaky test?", {
				who: "gate",
				target: "lead",
			}),
		],
		T + 5000,
	);
	expect(model.decisions).toEqual([]);
	expect(needsYou(model.decisions, 72, T)).toEqual([]);
	expect(keys(undefined, 0)).not.toContain("n:");
});

test("dismissed and acted decisions leave the queue", () => {
	const model = buildModel(
		[ev(0, "decision", "a?"), ev(1, "decision", "b?")],
		T + 5000,
	);
	const [a, b] = model.decisions;
	expect(waiting(model.decisions, [a?.id ?? ""]).map((d) => d.id)).toEqual([
		b?.id,
	]);
});

test("the quote Enter fills names the issue when there is one", () => {
	expect(quotedPrefix({ id: "x", text: "skip or fix?", issues: [150] })).toBe(
		"> re #150: skip or fix?\n",
	);
	expect(quotedPrefix({ id: "x", text: "go?", issues: [] })).toBe(
		"> re: go?\n",
	);
});

test("the cursor stays inside the list", () => {
	expect(moveCursor(0, -1, 3)).toBe(0);
	expect(moveCursor(2, 1, 3)).toBe(2);
	expect(moveCursor(1, 1, 3)).toBe(2);
	expect(moveCursor(5, 0, 2)).toBe(1);
	expect(moveCursor(3, 0, 0)).toBe(0);
});

const many = (n: number) =>
	buildModel(
		Array.from({ length: n }, (_, i) =>
			ev(i, "decision", `question ${i + 1} ${"word ".repeat(30)}`, {
				context: "c ".repeat(300),
			}),
		),
		T + 20_000,
	);

test("the main view shows three decisions and a +N more line, first one pulsing amber", () => {
	const queue = many(5).decisions;
	expect(capped(queue).more).toBe(2);
	const lines = needsYou(queue, 72, T);
	expect(lines.length).toBe(4);
	expect(flat(lines[0] ?? [])).toContain("NEEDS YOU");
	expect(flat(lines[3] ?? [])).toContain("+2 more");
	for (const line of lines) expect(width(line)).toBeLessThanOrEqual(72);
	// Pulses for ten seconds, then holds steady amber.
	const at = queue[0]?.at ?? 0;
	expect(pulsing(queue, at + 1000)).toBe(true);
	expect(pulsing(queue, at + PULSE_MS)).toBe(false);
	expect(pulseColor(at, at + PULSE_MS)).toBe(STUDIO.amber);
	expect(pulseColor(at + 0, at + PULSE_MS - 1)).not.toBe(undefined);
	expect(pulseColor(at, at + 600)).not.toBe(STUDIO.amber);
});

test("the needs view keeps its cursor on screen at every width and room", () => {
	const queue = many(7).decisions;
	for (const columns of [20, 48, 60, 72, 110, 160])
		for (const room of [3, 8, 14, 30])
			for (const cursor of [0, 3, 6]) {
				const lines = needsSection(queue, columns, T + 30_000, cursor, room);
				for (const line of lines)
					expect(width(line)).toBeLessThanOrEqual(columns);
				if (room >= 10)
					expect(lines.some((l) => flat(l).includes("▌"))).toBe(true);
			}
	expect(flat(needsSection([], 40, T, 0)[1] ?? [])).toContain("Nothing");
});

test("the pane footer offers n only while something waits, and leads with list keys inside", () => {
	expect(keys(undefined, 0)).toBe("s: shipping · t: messages");
	expect(keys(undefined, 2)).toBe(
		"n: needs you (2) · s: shipping · t: messages",
	);
	expect(keys("needs", 2)).toContain("enter: reply");
	const model = many(2);
	const view = paneView(model, [], 110, 32, T + 20_000, {
		focus: "needs",
		cursor: 1,
	});
	expect(view.regions.map(flat).join("\n")).toContain("▌ 2");
	const calm = paneView(buildModel([], T), [], 110, 32, T, {});
	expect(calm.footer.map(flat).join("\n")).not.toContain("needs you");
	expect(calm.regions.map(flat).join("\n")).not.toContain("NEEDS YOU");
});

test("Enter leaves the decision queued; the submit's reply closes it, an abandoned draft does not", () => {
	const asked = [ev(0, "decision", "skip or fix #204?", { issues: [204] })];
	// Enter fills the prompt but marks nothing handled, so it still waits.
	const queued = buildModel(asked, T + 5000);
	expect(waiting(queued.decisions, []).length).toBe(1);
	// Abandoning the draft records nothing: still queued.
	expect(buildModel(asked, T + 60_000).decisions.length).toBe(1);
	// Submitting records a reply naming it, which closes it even if dismissed.
	const submitted = buildModel(
		[
			...asked,
			ev(10, "reply", "replied", {
				answered: queued.decisions.map((d) => d.id),
			}),
		],
		T + 20_000,
	);
	expect(submitted.decisions).toEqual([]);
	const [d] = queued.decisions;
	expect(waiting(queued.decisions, [d?.id ?? ""])).toEqual([]);
	expect(queued.decisions.length).toBe(1);
});

const open = [
	{ id: "d1-0", text: "skip or fix #204?", issues: [204] },
	{ id: "d2-0", text: "merge #58 now?", issues: [58] },
];

test("repliedTo finds the decisions a prompt quotes", () => {
	// One quote, as Enter fills it.
	expect(repliedTo("> re #204: skip or fix #204?\nfix it", open)).toEqual([
		"d1-0",
	]);
	// Two quotes.
	expect(
		repliedTo(
			"> re #58: merge #58 now?\nyes\n> re #204: skip or fix #204?\nskip",
			open,
		),
	).toEqual(["d2-0", "d1-0"]);
	// An edited quote body still names its issue, when only one decision has it.
	expect(repliedTo("> re #58: merge it now, maybe\nyes", open)).toEqual([
		"d2-0",
	]);
	// No quote: a question about something else closes nothing.
	expect(repliedTo("what's #60 doing?", open)).toEqual([]);
	// A quote of a decision no longer open (not in the list) closes nothing.
	expect(repliedTo("> re #99: gone already?\nok", open)).toEqual([]);
	expect(repliedTo("> re #204: skip or fix #204?", [])).toEqual([]);
});

test("a reply closes only the decisions it names; an old one with no ids closes none", () => {
	const events = [
		ev(0, "decision", "skip or fix #204?"),
		ev(1, "decision", "merge #58 now?"),
	];
	const [a] = buildModel(events, T + 5000).decisions;
	const model = buildModel(
		[...events, ev(10, "reply", "replied", { answered: [a?.id ?? ""] })],
		T + 20_000,
	);
	expect(model.decisions.map((d) => d.text)).toEqual(["merge #58 now?"]);
	expect(
		buildModel([...events, ev(10, "reply", "replied")], T + 20_000).decisions
			.length,
	).toBe(2);
});
