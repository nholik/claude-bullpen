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
		| { kind: "leave" };
};

const LEAD = "lead";

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
