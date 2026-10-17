import { expect, test } from "claude-code/testing";
import {
	createTweens,
	easeInOutCubic,
	easeOutBack,
	glow,
	lerpPoint,
	linear,
} from "../src/anim";

const motion = { id: "ada", from: 10, to: 30, startAt: 100, durationMs: 200 };

test("tweens use timestamps with exact start, midpoint and completion", async () => {
	const tweens = createTweens();
	expect(tweens.active(0)).toBe(false);
	tweens.add(motion);
	expect(tweens.sample(0).get("ada")).toBe(10);
	expect(tweens.sample(100).get("ada")).toBe(10);
	expect(tweens.sample(200).get("ada")).toBe(20);
	expect(tweens.sample(300).get("ada")).toBe(30);
	expect(tweens.sample(999).get("ada")).toBe(30);
	expect(tweens.active(0)).toBe(true);
	expect(tweens.active(299)).toBe(true);
	expect(tweens.active(300)).toBe(false);
});

test("sampling is deterministic, supports time rewind, and returns independent maps", async () => {
	const tweens = createTweens();
	tweens.add(motion);
	tweens.sample(300).set("ada", -1);
	expect(tweens.sample(200).get("ada")).toBe(20);
	expect(tweens.sample(100).get("ada")).toBe(10);
	expect(tweens.sample(200).get("ada")).toBe(20);
});

test("IDs replace earlier motion and input mutation does not change the tween", async () => {
	const tweens = createTweens();
	const input = { ...motion };
	tweens.add(input);
	input.to = 999;
	expect(tweens.sample(300).get("ada")).toBe(30);
	tweens.add({ ...motion, from: 30, to: 10 });
	expect(tweens.sample(200).get("ada")).toBe(20);
	expect(tweens.sample(300).size).toBe(1);
	expect(tweens.sample(300).get("ada")).toBe(10);
});

test("prune removes only completed work, preserving scheduled and active IDs", async () => {
	const tweens = createTweens();
	tweens.add(motion);
	tweens.add({ ...motion, id: "gate", startAt: 200 });
	tweens.add({ ...motion, id: "iris", startAt: 500 });
	tweens.prune(300);
	expect([...tweens.sample(300).keys()]).toEqual(["gate", "iris"]);
	expect(tweens.active(400)).toBe(true);
	tweens.prune(700);
	expect(tweens.sample(700).size).toBe(0);
	expect(tweens.active(700)).toBe(false);
});

test("zero duration changes instantly at its scheduled start", async () => {
	const tweens = createTweens();
	tweens.add({ ...motion, durationMs: 0 });
	expect(tweens.sample(99).get("ada")).toBe(10);
	expect(tweens.sample(100).get("ada")).toBe(30);
	expect(tweens.active(99)).toBe(true);
	expect(tweens.active(100)).toBe(false);
});

test("easing curves have expected shape and preserve exact tween endpoints", async () => {
	expect(linear(0.25)).toBe(0.25);
	expect(easeInOutCubic(0.25)).toBe(0.0625);
	expect(easeInOutCubic(0.5)).toBe(0.5);
	expect(easeInOutCubic(0.75)).toBe(0.9375);
	expect(easeOutBack(0.7)).toBeGreaterThan(1);
	for (const ease of [linear, easeInOutCubic, easeOutBack]) {
		const tweens = createTweens();
		tweens.add({ ...motion, ease });
		expect(tweens.sample(100).get("ada")).toBe(10);
		expect(tweens.sample(300).get("ada")).toBe(30);
	}
	const back = createTweens();
	back.add({ ...motion, ease: easeOutBack });
	expect(back.sample(240).get("ada") ?? 0).toBeGreaterThan(30);
});

test("invalid durations and nonfinite inputs reject without replacing valid work", async () => {
	const tweens = createTweens();
	tweens.add(motion);
	for (const patch of [
		{ durationMs: -1 },
		{ durationMs: Infinity },
		{ startAt: NaN },
		{ from: Infinity },
		{ to: NaN },
	]) {
		let rejected = false;
		try {
			tweens.add({ ...motion, ...patch });
		} catch {
			rejected = true;
		}
		expect(rejected).toBe(true);
	}
	expect(tweens.sample(300).get("ada")).toBe(30);
});

test("2D paths interpolate both coordinates and support back-ease overshoot", async () => {
	const from = { x: 2, y: 10 };
	const to = { x: 10, y: 2 };
	expect(lerpPoint(from, to, 0)).toEqual(from);
	expect(lerpPoint(from, to, 0.5)).toEqual({ x: 6, y: 6 });
	expect(lerpPoint(from, to, 1)).toEqual(to);
	expect(lerpPoint(from, to, 1.25)).toEqual({ x: 12, y: 0 });
	expect(lerpPoint(from, from, 0.5)).toEqual(from);
});

test("change glow is bounded and decays over sixty seconds with no timer", async () => {
	expect(glow(99, 100)).toBe(0);
	expect(glow(100, 100)).toBe(1);
	expect(glow(30_100, 100)).toBe(0.25);
	expect(glow(60_100, 100)).toBe(0);
	expect(glow(90_100, 100)).toBe(0);
	expect(glow(150, 100, 100)).toBe(0.25);
	expect(glow(100, 100, 0)).toBe(0);
	let prev = 1;
	for (let t = 100; t <= 60_100; t += 1000) {
		const value = glow(t, 100);
		expect(value >= 0 && value <= prev).toBe(true);
		prev = value;
	}
});
