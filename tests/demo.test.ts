import { expect, test } from "claude-code/testing";
import { DEMO_DURATION_MS, DEMO_SCRIPT, demoClock } from "../src/demo";
import { demoAt, demoGithubAt } from "../src/demo-replay";
import { buildModel, isHallwayLive } from "../src/model";
import { createMotion, motionFor } from "../src/motion";
import { DEFAULT_PROFILE } from "../src/profile";
import { width } from "../src/render/lines";
import { moraleHint } from "../src/render/morale";
import { paneView } from "../src/render/pane";

test("shared demo lasts eighty seconds and exercises quiet stalls asks and recovery", () => {
	expect(DEMO_SCRIPT.reduce((n, s) => n + s.wait, 0)).toBe(DEMO_DURATION_MS);
	expect(DEMO_SCRIPT.every((s) => s.wait >= 0)).toBe(true);
	const quiet = buildModel(demoAt(26000).events, demoClock(26000));
	expect(isHallwayLive(quiet.hallway, demoClock(26000))).toBe(false);
	expect(quiet.morale.score).toBeLessThan(0.5);
	expect(moraleHint(quiet, demoClock(26000))).toContain("stalled");
	expect(quiet.asks.some((a) => a.open)).toBe(true);
	const wake = buildModel(demoAt(35000).events, demoClock(35000));
	expect(isHallwayLive(wake.hallway, demoClock(35000))).toBe(true);
	const end = buildModel(demoAt(80000).events, demoClock(80000));
	expect(end.closed).toEqual([204, 208]);
	expect(end.asks.some((a) => a.open)).toBe(false);
	expect(end.teammates.luna?.issue).toBe(217);
	expect(
		Object.values(demoAt(80000).members).every((m) => m.status === "idle"),
	).toBe(true);
	expect(demoAt(80000)).toEqual(demoAt(90000));
});
test("fake GitHub parsing produces the same close totals and burndown timeline", () => {
	const source = demoGithubAt(80000);
	expect(source.burndown.map((p) => p.open)).toEqual([4, 3, 2]);
	expect(source.burndown.map((p) => p.closed)).toEqual([0, 1, 2]);
	expect(demoGithubAt(54999).burndown.length).toBe(1);
});
test("preview data fits every supported pane size at key demo beats", () => {
	for (const at of [0, 7500, 16000, 26000, 35000, 55000, 70000, 80000]) {
		const replay = demoAt(at),
			now = demoClock(at),
			model = buildModel(replay.events, now);
		for (const columns of [47, 48, 60, 72, 80, 100, 110, 160]) {
			const view = paneView(
				model,
				Object.values(replay.members),
				columns,
				32,
				now,
				{ github: demoGithubAt(at) },
			);
			const lines = [
				...view.header,
				...view.regions,
				...view.footer,
				view.band,
			];
			expect(lines.length + view.floorRows <= 32).toBe(true);
			for (const line of lines) expect(width(line) <= columns).toBe(true);
		}
	}
});
test("demo closes animate and eventually stop", () => {
	const replay = demoAt(55000),
		now = demoClock(55000);
	const motion = createMotion(
		motionFor(
			replay.events,
			Object.values(replay.members),
			72,
			13,
			now,
			DEFAULT_PROFILE,
		),
	);
	expect(motion.sample(now).tables.length).toBe(1);
	expect(motion.sample(now + 2500).tables.length).toBe(0);
});
