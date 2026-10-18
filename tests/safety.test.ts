import { expect, test } from "claude-code/testing";
import { demoClock } from "../src/demo";
import { demoAt, demoGithubAt, demoProfile } from "../src/demo-replay";
import { readJournal } from "../src/journal";
import { buildModel, reduceEvents } from "../src/model";
import { KEEP, TRAIL_LENGTH } from "../src/model/team";
import { DEFAULT_PROFILE } from "../src/profile";
import { width } from "../src/render/lines";
import { paneView } from "../src/render/pane";
import { storyFor, storyLines } from "../src/render/story";

test("all pane focus modes and stories are deterministic across widths and demo beats", () => {
	for (const columns of [48, 60, 72, 100, 160])
		for (const elapsed of [0, 16000, 25000, 55000, 80000]) {
			const demo = demoAt(elapsed),
				at = demoClock(elapsed);
			const model = buildModel(demo.events, at);
			const github = demoGithubAt(elapsed);
			const profile = demoProfile(DEFAULT_PROFILE);
			for (const focus of [undefined, "shipping", "talk"] as const) {
				const render = () =>
					paneView(model, Object.values(demo.members), columns, 32, at, {
						github,
						profile,
						focus,
					});
				const a = render();
				expect(render()).toEqual(a);
				for (const line of [...a.header, ...a.regions, ...a.footer, a.band])
					expect(width(line) <= columns).toBe(true);
			}
			const story = storyFor(204, demo.events, github);
			const a = storyLines(story, profile, columns, 32);
			expect(storyLines(story, profile, columns, 32)).toEqual(a);
			for (const line of a) expect(width(line) <= columns).toBe(true);
		}
});

test("seeded 10k-record malformed journal replay keeps model buffers bounded", () => {
	let seed = 12345;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed;
	};
	const records: string[] = [];
	for (let i = 0; i < 10000; i++) {
		const event = {
			version: 1,
			at: i,
			kind: "message",
			who: `gate${random() % 8}`,
			target: "lead",
			detail:
				i % 997 === 0
					? `FAIL ${"x".repeat(50000)}?`
					: "FAIL: sending it back; need a decision?",
			issues: [(random() % 16) + 1],
		};
		switch (random() % 7) {
			case 0:
				records.push("{garbled");
				break;
			case 1:
				records.push(JSON.stringify({ version: 1, kind: "message" }));
				break;
			case 2:
				records.push(JSON.stringify({ ...event, kind: "unknown-kind" }));
				break;
			case 3:
				records.push(JSON.stringify({ ...event, issues: "invalid" }));
				break;
			default:
				records.push(JSON.stringify(event));
		}
	}
	// Raw external records cross the journal schema before reaching the typed reducer.
	const parsed = readJournal(records.join("\n"));
	expect(parsed.skipped > 0).toBe(true);
	expect(parsed.events.length + parsed.skipped).toBe(10000);
	const state = reduceEvents(parsed.events);
	for (const buffer of [state.hallway, state.asks, state.kickbacks])
		expect(buffer.length <= KEEP).toBe(true);
	expect(Object.keys(state.teammates).length <= 8).toBe(true);
	for (const teammate of Object.values(state.teammates))
		expect(teammate.trail.length <= TRAIL_LENGTH).toBe(true);
	expect(Number.isFinite(buildModel(parsed.events, 10000).morale.score)).toBe(
		true,
	);
});
