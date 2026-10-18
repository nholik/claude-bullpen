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
import { newestMessages } from "../src/render/team-studio";

test("legacy style settings are ignored without losing terminal preferences", () => {
	for (const style of ["studio", "operations", "unknown"]) {
		const parsed = parseProfile(JSON.stringify({ style, glyphs: "ascii" }));
		expect(parsed.warnings).toEqual([]);
		expect(parsed.profile).toEqual({ ...DEFAULT_PROFILE, glyphs: "ascii" });
		expect(parsed.set).not.toHaveProperty("style");
	}
	expect(mergeProfiles({ glyphs: "ascii" }, {})).toMatchObject({
		glyphs: "ascii",
	});
});

test("Studio and legacy profiles preserve cell budgets, portable glyphs, and overflow across terminal sizes", () => {
	const replay = demoAt(16000);
	const now = demoClock(16000);
	const members = Object.values(replay.members);
	const model = buildModel(replay.events, now);
	for (const style of ["studio", "operations"] as const)
		for (const glyphs of ["unicode", "ascii"] as const)
			for (const columns of [
				20, 47, 48, 60, 72, 80, 100, 109, 110, 119, 120, 160,
			])
				for (const rows of [8, 16, 17, 27, 28, 29, 40, 48]) {
					const profile = parseProfile(
						JSON.stringify({ style, glyphs }),
					).profile;
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
						expect(view.floorRows).toBe(columns >= 60 && rows >= 16 ? 0 : 1);
						expect(view.sidebar.length).toBe(0);
						for (const line of [
							...view.header,
							...view.regions,
							...view.footer,
							view.band,
						])
							for (const seg of line)
								expect(/^[\x20-\x7e]*$/.test(seg.text)).toBe(true);
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
	test(`legacy ${style} profile mounts Studio and preserves story navigation`, async ($, on) => {
		mock.clock(on, { now: 16000 });
		on("state.get", { plugin: "bullpen", key: "demoStart" }, () => ({
			value: { value: 0, version: 1 },
		}));
		on("state.get", { plugin: "bullpen", key: "profile" }, () => ({
			value: {
				value: parseProfile(JSON.stringify({ style })).profile,
				version: 1,
			},
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
		expect(
			await ui.find({ type: "Text", text: /WORKSTATIONS \/ teammates/ }),
		).toBeDefined();
		expect((await ui.find({ key: "shipping-focus" }))?.text).toContain(
			"shipping",
		);
		const story = (await ui.findAll({ type: "Button" })).find((b) =>
			b.key?.startsWith("story-"),
		);
		expect(story).toBeDefined();
		await ui.press({ key: story?.key ?? "missing" });
		expect(opened).toBe("bullpen-story");
		await ui.unmount();
	});

test("studio compact and sidebar layouts retain open decisions and teammate overflow", () => {
	const replay = demoAt(16000);
	const now = demoClock(16000);
	const model = buildModel(replay.events, now);
	for (const columns of [60, 80, 119, 120, 160]) {
		const view = paneView(model, [], columns, 16, now, {
			github: demoGithubAt(16000),
		});
		const content = [...view.header, ...view.regions]
			.map((line) => line.map((s) => s.text).join(" "))
			.join("\n");
		expect(content).toContain("more teammates");
		expect(content).toContain(
			model.asks.find((ask) => ask.open)?.from ?? "missing ask",
		);
		expect(content).toContain("NEEDS YOU");
	}
});

test("studio workstation names keep real transcript links and suppress demo agent IDs", () => {
	const replay = demoAt(16000);
	const now = demoClock(16000);
	const model = buildModel(replay.events, now);
	const members = Object.values(replay.members);
	const real = members.map((member) => ({
		...member,
		id: `real-${member.name}`,
	}));
	const view = paneView(model, real, 160, 40, now);
	const links = view.regions.flat().filter((seg) => seg.agentId);
	expect(links.length > 0).toBe(true);
	for (const link of links)
		expect(link.agentId).toBe(`real-${link.text.trim()}`);
	const demo = paneView(model, members, 160, 40, now);
	expect(
		demo.regions.flat().some((seg) => seg.agentId?.startsWith("demo-")),
	).toBe(false);
});

test("Studio header carries the morale glyph and observable stall pressure", () => {
	const replay = demoAt(26000);
	const now = demoClock(26000);
	const members = Object.values(replay.members);
	const model = buildModel(replay.events, now);
	expect(model.morale.score).toBeLessThan(0.5);
	const flat = (lines: { text: string }[][]) =>
		lines.map((l) => l.map((s) => s.text).join("")).join("\n");
	for (const columns of [60, 72, 80, 110, 160])
		for (const glyphs of ["unicode", "ascii"] as const) {
			const view = paneView(model, members, columns, 30, now, {
				profile: { ...DEFAULT_PROFILE, glyphs },
				github: demoGithubAt(26000),
			});
			const header = flat(view.header);
			expect(header).toContain("possible stalls");
			if (glyphs === "unicode") expect(header).toContain(model.morale.glyph);
			for (const line of view.header) expect(width(line) <= columns).toBe(true);
		}
	const calm = demoAt(16000);
	const calmClock = demoClock(16000);
	const view = paneView(
		buildModel(calm.events, calmClock),
		Object.values(calm.members),
		110,
		30,
		calmClock,
		{ github: demoGithubAt(16000) },
	);
	expect(flat(view.header)).not.toContain("check in?");
});

test("narrow Studio fills spare rows with the hallway", () => {
	const replay = demoAt(16000);
	const now = demoClock(16000);
	const view = paneView(
		buildModel(replay.events, now),
		Object.values(replay.members),
		80,
		48,
		now,
		{ profile: DEFAULT_PROFILE },
	);
	const rows = view.regions.map((line) => line.map((s) => s.text).join(""));
	const at = rows.findIndex((r) => r.includes("HALLWAY"));
	expect(at).toBeGreaterThan(-1);
	expect(rows[at + 1]?.includes("→")).toBe(true);
});

test("the messages view keeps the newest messages and fits its rows", () => {
	const long = "word ".repeat(80);
	const messages = Array.from({ length: 12 }, (_, i) => ({
		from: "a",
		to: "b",
		text: i === 11 ? `newest ${long}` : `m${i} ${long}`,
		at: 1000 * i,
	}));
	const profile = DEFAULT_PROFILE;
	for (const [columns, rows] of [
		[72, 11],
		[110, 31],
		[160, 31],
	] as const) {
		const lines = newestMessages(messages as never, profile, columns, rows);
		const flat = lines.map((l) => l.map((s) => s.text).join(""));
		expect(lines.length <= rows).toBe(true);
		expect(flat.some((t) => t.includes("newest"))).toBe(true);
		expect(flat.some((t) => t.includes("m0 "))).toBe(false);
	}
});

test("the messages view marks a cut on a full-width line, once", () => {
	const columns = 40;
	const full = "x".repeat(columns * 3);
	// Header + 1 body line fit; the cut lands on a full-width wrapped line.
	const one = [{ from: "a", to: "b", text: full, at: 0 }];
	const cut = newestMessages(one as never, DEFAULT_PROFILE, columns, 2);
	const rowText = cut.map((l) => l.map((s) => s.text).join(""));
	expect(rowText[1]?.endsWith("…")).toBe(true);
	expect(width(cut[1] ?? [])).toBeLessThanOrEqual(columns);

	// The wrap already ended the message with "…" (more than six lines): no doubling.
	const huge = [{ from: "a", to: "b", text: "word ".repeat(400), at: 0 }];
	const marked = newestMessages(huge as never, DEFAULT_PROFILE, columns, 7);
	for (const l of marked) {
		expect(
			l
				.map((s) => s.text)
				.join("")
				.includes("……"),
		).toBe(false);
	}
	const lastRow = marked.at(-1) ?? [];
	expect(
		lastRow
			.map((s) => s.text)
			.join("")
			.endsWith("…"),
	).toBe(true);
});
