import { expect, test } from "claude-code/testing";
import { moraleLight } from "../src/color";
import { buildModel } from "../src/model";
import { moraleHint } from "../src/render/morale";

test("lighting clamps endpoints and increases warmth and brightness", () => {
	expect(moraleLight(-1)).toEqual(moraleLight(0));
	expect(moraleLight(2)).toEqual(moraleLight(1));
	expect(moraleLight(0).floor).not.toBe(moraleLight(1).floor);
	const low = moraleLight(0).floor,
		high = moraleLight(1).floor;
	expect((high >> 16) & 255).toBeGreaterThan((low >> 16) & 255);
	expect(low & 255).toBeGreaterThan((low >> 16) & 255);
});
test("hint prioritizes stalls then asks then repeated kickbacks then idle", () => {
	const model = buildModel([], 0);
	model.morale.score = 0.3;
	model.morale.factors.idle = ["ada"];
	expect(moraleHint(model, 1200000)).toContain("ada idle");
	model.kickbacks = [0, 1].map((at) => ({
		from: "gate",
		issue: 1,
		at,
		text: "fail",
	}));
	expect(moraleHint(model, 1200000)).toContain("#1 sent back 2");
	model.asks = [
		{
			from: "smith",
			to: "lead",
			text: "skip or fix?",
			at: 1,
			issues: [1],
			open: true,
		},
	];
	expect(moraleHint(model, 1200000)).toContain("smith needs you");
	model.morale.factors.stalled = [2];
	model.huddles = [
		{ issue: 2, members: ["ada"], startedAt: 0, lastActiveAt: 0, kickbacks: 0 },
	];
	expect(moraleHint(model, 1200000)).toBe("#2 stalled 20m — check in?");
	model.morale.score = 0.5;
	expect(moraleHint(model, 1200000)).toBeUndefined();
});
