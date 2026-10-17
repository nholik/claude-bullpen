import { expect, mock, test } from "claude-code/testing";
import { demoClock } from "../src/demo";
import { demoAt, demoGithubAt } from "../src/demo-replay";
import { drawFloor } from "../src/floor";
import { safeGlyph } from "../src/glyphs";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE, mergeProfiles, parseProfile } from "../src/profile";
import { width } from "../src/render/lines";
import { paneView } from "../src/render/pane";
import { issueStatus } from "../src/render/studio";

test("style preferences validate and layer without losing the chosen terminal fallback", () => {
	expect(parseProfile('{"style":"operations"}').profile.style).toBe(
		"operations",
	);
	const invalid = parseProfile('{"style":"unknown"}');
	expect(invalid.profile.style).toBe("studio");
	expect(invalid.warnings.length).toBe(1);
	expect(
		mergeProfiles(
			{ style: "studio" },
			{ style: "operations", glyphs: "ascii" },
		),
	).toMatchObject({ style: "studio", glyphs: "ascii" });
});

test("both themes preserve cell budgets, portable glyphs, and explicit overflow across terminal sizes", () => {
	const replay = demoAt(16000);
	const now = demoClock(16000);
	const members = Object.values(replay.members);
	const model = buildModel(replay.events, now);
	for (const style of ["studio", "operations"] as const)
		for (const glyphs of ["unicode", "ascii"] as const)
			for (const columns of [20, 47, 48, 60, 72, 80, 100, 109, 110, 160])
				for (const rows of [8, 17, 27, 28, 29, 40, 48]) {
					const profile = { ...DEFAULT_PROFILE, style, glyphs };
					const view = paneView(model, members, columns, rows, now, {
						profile,
						github: demoGithubAt(16000),
					});
					expect(
						view.header.length +
							view.floorRows +
							view.regions.length +
							view.footer.length +
							1 <=
							rows,
					).toBe(true);
					expect(view.sidebar.length <= view.floorRows).toBe(true);
					for (const line of [
						...view.header,
						...view.regions,
						...view.footer,
						view.band,
					])
						expect(width(line) <= columns).toBe(true);
					for (const line of view.sidebar)
						expect(width(line) + view.floorColumns + 3 <= columns).toBe(true);
					if (glyphs === "ascii") {
						expect(view.floorRows).toBe(1);
						expect(view.sidebar.length).toBe(0);
					}
					if (!view.floorRows) continue;
					const floor = drawFloor(
						members,
						view.floorColumns,
						view.floorRows,
						0,
						{},
						profile,
						undefined,
						model.morale.score,
						{ model, now },
					);
					expect(floor.seats.size + floor.overflowMembers.length).toBe(
						members.filter((m) => m.status !== "gone").length,
					);
					const words = new Uint32Array(
						Uint8Array.from(atob(floor.cells), (c) => c.charCodeAt(0)).buffer,
					);
					expect(words.length).toBe(view.floorColumns * view.floorRows * 3);
					for (let i = 0; i < words.length; i += 3) {
						const cp = words[i] ?? 0;
						if (
							!safeGlyph(String.fromCodePoint(cp)) ||
							(glyphs === "ascii" && cp > 126)
						)
							throw new Error(`Nonportable cell ${cp}`);
					}
				}
});

test("issue states distinguish active review, open decisions, stalls and completion", () => {
	const replay = demoAt(16000);
	const model = buildModel(replay.events, demoClock(16000));
	expect(issueStatus(model, 204, DEFAULT_PROFILE, demoClock(16000)).label).toBe(
		"NEEDS YOU",
	);
	const review = {
		...model,
		asks: [],
		teammates: {
			...model.teammates,
			gate: {
				...model.teammates.gate,
				name: "gate",
				color: 0,
				lastActiveAt: 0,
				trail: [],
				status: "running" as const,
			},
		},
	};
	expect(
		issueStatus(review, 204, DEFAULT_PROFILE, demoClock(16000)).label,
	).toBe("IN REVIEW");
	expect(
		issueStatus(
			{ ...review, closed: [204] },
			204,
			DEFAULT_PROFILE,
			demoClock(16000),
		).label,
	).toBe("DONE");
	expect(
		issueStatus(review, 204, DEFAULT_PROFILE, demoClock(16000) + 3600000).label,
	).toBe("STALLED");
});

for (const style of ["studio", "operations"] as const)
	test(`${style} pane mounts its sidebar and preserves story navigation`, async ($, on) => {
		mock.clock(on, { now: 16000 });
		on("state.get", { plugin: "bullpen", key: "demoStart" }, () => ({
			value: { value: 0, version: 1 },
		}));
		on("state.get", { plugin: "bullpen", key: "profile" }, () => ({
			value: { value: { ...DEFAULT_PROFILE, style }, version: 1 },
		}));
		let opened = "";
		on("ui.open", (_$, e) => {
			opened = e.id;
			return { value: { isPlaced: true } };
		});
		const ui = await $.ui.mount({
			plugin: "bullpen",
			surface: "terminal",
			component: "Pane",
			requestId: "bullpen",
			props: {
				title: "Bullpen",
				isFocused: true,
				placement: "dock",
				bodyColumns: 160,
				scroll: { offset: 0, bodyRows: 40 },
				view: {},
			},
		});
		expect(await ui.find({ key: "floor" })).toBeDefined();
		expect((await ui.find({ key: "floor-focus" }))?.text).toContain(
			style === "operations" ? "topology" : "floor",
		);
		await ui.press({ key: "story-1-1" });
		expect(opened).toBe("bullpen-story");
		await ui.unmount();
	});
