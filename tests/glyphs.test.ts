import { expect, test } from "claude-code/testing";
import { demoAt, demoGithubAt, demoProfile } from "../src/demo-replay";
import { drawFloor } from "../src/floor";
import { glyphText, safeGlyph } from "../src/glyphs";
import { journalDir } from "../src/journal";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE, parseProfile } from "../src/profile";
import { width } from "../src/render/lines";
import { paneView } from "../src/render/pane";
import { storyFor, storyLines } from "../src/render/story";
import { join } from "../src/vendor/pathe.js";
import stringWidth from "../src/vendor/string-width.js";

test("profile accepts ASCII glyphs and rejects unknown modes", () => {
	expect(parseProfile('{"glyphs":"ascii"}').profile.glyphs).toBe("ascii");
	expect(parseProfile('{"glyphs":"unknown"}').profile.glyphs).toBe("unicode");
	expect(glyphText("●○→█─│", "ascii")).toBe("*o>#-|");
	for (const c of glyphText("界😀𝐀é\u0301\u001b…☰"))
		if (!safeGlyph(c)) throw new Error(`unsafe ${JSON.stringify(c)}`);
});

for (const glyphs of ["unicode", "ascii"] as const)
	for (const columns of [48, 60, 72, 100, 160])
		test(`every demo view and Raster uses portable single-cell glyphs (${glyphs}, ${columns} columns)`, () => {
			for (const elapsed of [0, 16000, 40000, 80000]) {
				const demo = demoAt(elapsed);
				const github = demoGithubAt(elapsed);
				const profile = { ...demoProfile(DEFAULT_PROFILE), glyphs };
				const members = Object.values(demo.members);
				const model = buildModel(demo.events, elapsed);
				const pane = paneView(model, members, columns, 32, elapsed, {
					github,
					profile,
				});
				const lines = [
					...pane.header,
					...pane.regions,
					...pane.footer,
					pane.band,
					...storyLines(
						storyFor(204, demo.events, github),
						profile,
						columns,
						32,
					),
				];
				for (const line of lines) {
					if (width(line) > columns)
						throw new Error(
							`width ${glyphs} ${columns}: ${JSON.stringify(line)}`,
						);
					for (const c of line.map((s) => s.text).join("")) {
						if (!safeGlyph(c)) throw new Error(`unsafe ${JSON.stringify(c)}`);
						if (stringWidth(c) !== 1)
							throw new Error(`width ${JSON.stringify(c)}`);
						if (glyphs === "ascii")
							if ((c.codePointAt(0) ?? 0) > 126)
								throw new Error(`text ascii ${c}`);
					}
				}
				const floor = drawFloor(
					members,
					columns,
					10,
					0,
					{ 204: "界😀𝐀" },
					profile,
				);
				const words = new Uint32Array(
					Uint8Array.from(atob(floor.cells), (c) => c.charCodeAt(0)).buffer,
				);
				for (let i = 0; i < words.length; i += 3) {
					const cp = words[i] ?? 0;
					if (!safeGlyph(String.fromCodePoint(cp)))
						throw new Error(`raster unsafe ${cp}`);
					if (glyphs === "ascii")
						if (cp > 126) throw new Error(`raster ascii ${cp}`);
				}
			}
		});

test("paths normalize Windows separators while retaining drive and UNC roots", () => {
	expect(join("C:\\work\\repo", ".claude", "bullpen.json")).toBe(
		"C:/work/repo/.claude/bullpen.json",
	);
	expect(journalDir("C:\\Users\\person\\", "team")).toBe(
		"C:/Users/person/.claude/bullpen/team",
	);
	expect(join("\\\\server\\share\\repo", ".claude", "bullpen.json")).toBe(
		"//server/share/repo/.claude/bullpen.json",
	);
});

test("truncation keeps its ellipsis in unicode mode", () => {
	expect(glyphText("a…")).toBe("a…");
	expect(glyphText("a…", "ascii")).toBe("a.");
});
