// A scripted team for `/bullpen demo`: drives the same recording path a real
// team does, with no model calls. Used to develop the visuals, take
// screenshots, and show the mod off.

export const DEMO_PREFIX = "demo-";

export type DemoStep = {
	/** Delay before this step, in milliseconds. */
	wait: number;
	who: string;
	do:
		| { kind: "join"; issue?: number }
		| { kind: "work"; detail: string; issue?: number }
		| { kind: "rest" }
		| { kind: "say"; to: string; text: string }
		/** The lead puts a decision to the person (a `Decision:` line). */
		| { kind: "decide"; text: string; context: string }
		/** The person sends a prompt, answering what is open. */
		| { kind: "reply" }
		| { kind: "leave" }
		| { kind: "advance"; ms: number };
};

const LEAD = "lead";
export const DEMO_DURATION_MS = 80_000;
export const DEMO_EPOCH = Date.UTC(2026, 9, 17, 14, 0);

export const DEMO_SCRIPT: DemoStep[] = [
	{ wait: 0, who: "smith", do: { kind: "join", issue: 208 } },
	{ wait: 400, who: "ada", do: { kind: "join", issue: 208 } },
	{ wait: 400, who: "gate", do: { kind: "join", issue: 204 } },
	{ wait: 400, who: "iris", do: { kind: "join", issue: 199 } },
	{ wait: 400, who: "scout", do: { kind: "join" } },
	{
		wait: 900,
		who: "smith",
		do: { kind: "work", detail: "read src/auth/redirect.ts" },
	},
	{
		wait: 600,
		who: "smith",
		do: {
			kind: "say",
			to: "ada",
			text: "#208: can you write the repro test for the redirect loop?",
		},
	},
	{
		wait: 700,
		who: "ada",
		do: { kind: "work", detail: "write tests/test_login.py" },
	},
	{
		wait: 700,
		who: "gate",
		do: { kind: "work", detail: "npm test -- session" },
	},
	{
		wait: 600,
		who: "iris",
		do: { kind: "work", detail: "review #199 tooltip" },
	},
	{ wait: 900, who: "scout", do: { kind: "rest" } },
	{
		wait: 800,
		who: "gate",
		do: {
			kind: "say",
			to: "smith",
			text: "#204: 2 tests failing on session expiry, sending it back to you",
		},
	},
	{
		wait: 700,
		who: "smith",
		do: { kind: "work", detail: "edit src/session.ts", issue: 204 },
	},
	{
		wait: 900,
		who: "iris",
		do: {
			kind: "say",
			to: LEAD,
			text: "#199 looks good, filed a spacing nit as #217",
		},
	},
	{ wait: 500, who: "iris", do: { kind: "rest" } },
	{
		wait: 900,
		who: "ada",
		do: {
			kind: "say",
			to: "smith",
			text: "#208: repro test is in, fails as expected",
		},
	},
	{ wait: 800, who: "gate", do: { kind: "rest" } },
	{
		wait: 1200,
		who: "smith",
		do: { kind: "work", detail: "npm test", issue: 204 },
	},
	{
		wait: 900,
		who: "smith",
		do: { kind: "say", to: "gate", text: "#204: fixed, please re-run" },
	},
	{
		wait: 600,
		who: "gate",
		do: { kind: "work", detail: "npm test -- session" },
	},
];

// The first act preserves the original join/pair/kickback sequence. Later beats
// explicitly advance simulated time so quiet/stall transitions fit in 80 seconds.
const openingDuration = DEMO_SCRIPT.reduce((n, step) => n + step.wait, 0);
const finale: { at: number; who: string; do: DemoStep["do"] }[] = [
	{
		at: 16000,
		who: "gate",
		do: { kind: "say", to: LEAD, text: "#204 flaky test — skip or fix?" },
	},
	{
		at: 17000,
		who: LEAD,
		do: {
			kind: "decide",
			text: "skip or fix the flaky test on #204?",
			context:
				"gate has failed #204 twice on session expiry, and smith and ada are paused until it is settled.",
		},
	},
	{ at: 18000, who: "smith", do: { kind: "rest" } },
	{ at: 18000, who: "ada", do: { kind: "rest" } },
	{ at: 18000, who: "gate", do: { kind: "rest" } },
	{ at: 25000, who: LEAD, do: { kind: "advance", ms: 21 * 60000 } },
	{
		at: 35000,
		who: "gate",
		do: {
			kind: "say",
			to: LEAD,
			text: "#204 still blocked — need a decision?",
		},
	},
	{ at: 39000, who: LEAD, do: { kind: "reply" } },
	{
		at: 40000,
		who: LEAD,
		do: { kind: "say", to: "gate", text: "Fix #204; smith can pair with you." },
	},
	{
		at: 43000,
		who: "smith",
		do: { kind: "work", issue: 204, detail: "edit src/session.ts" },
	},
	{
		at: 48000,
		who: "gate",
		do: { kind: "work", issue: 204, detail: "npm test -- session" },
	},
	{
		at: 52000,
		who: "gate",
		do: { kind: "say", to: "smith", text: "#204 PASS, all green" },
	},
	{
		at: 55000,
		who: "smith",
		do: { kind: "say", to: LEAD, text: "closed #204" },
	},
	{
		at: 56000,
		who: LEAD,
		do: {
			kind: "decide",
			text: "merge #204 now, or wait and ship it with #208?",
			context:
				"#204 is green after the fix. #208 is one review from done, so the two could land together.",
		},
	},
	{
		at: 58000,
		who: "smith",
		do: { kind: "work", issue: 208, detail: "edit src/auth/redirect.ts" },
	},
	{
		at: 61000,
		who: "ada",
		do: { kind: "work", issue: 208, detail: "write tests/redirect.test.ts" },
	},
	{
		at: 67000,
		who: "ada",
		do: {
			kind: "say",
			to: "smith",
			text: "#208 PASS, redirect regression is covered",
		},
	},
	{
		at: 70000,
		who: "smith",
		do: { kind: "say", to: LEAD, text: "closed #208" },
	},
	{ at: 72000, who: "luna", do: { kind: "join", issue: 217 } },
	{
		at: 75000,
		who: "luna",
		do: { kind: "say", to: LEAD, text: "#217 spacing polish is underway" },
	},
	...["smith", "ada", "gate", "iris", "scout", "luna", LEAD].map((who) => ({
		at: 80000,
		who,
		do: { kind: "rest" as const },
	})),
];
let previous = openingDuration;
for (const step of finale) {
	DEMO_SCRIPT.push({ wait: step.at - previous, who: step.who, do: step.do });
	previous = step.at;
}

export function demoClock(elapsed: number): number {
	const time = Math.max(0, Math.min(DEMO_DURATION_MS, elapsed));
	let at = 0,
		offset = 0;
	for (const step of DEMO_SCRIPT) {
		at += step.wait;
		if (at > time) break;
		if (step.do.kind === "advance") offset += step.do.ms;
	}
	return DEMO_EPOCH + time + offset;
}
