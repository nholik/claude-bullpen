import { expect, test } from "claude-code/testing";

import { mix } from "../src/color";
import { describeTool, issueRefs, nextIssue, oneLine } from "../src/events";
import { base64, drawFloor, layout } from "../src/floor";
import type { Member } from "../types";

test("issueRefs finds #N refs once each, in order", async () => {
	expect(issueRefs("fix #208 then #204, see #208 again")).toEqual([208, 204]);
	expect(issueRefs("#12 at start")).toEqual([12]);
	expect(issueRefs("no refs, a&#39;b entity, C# code")).toEqual([]);
	expect(issueRefs(undefined)).toEqual([]);
});

test("oneLine flattens whitespace and cuts with an ellipsis", async () => {
	expect(oneLine("a\n  b\tc", 10)).toBe("a b c");
	expect(oneLine("abcdefghij", 5)).toBe("abcd…");
});

test("oneLine measures display width, not string length", async () => {
	// Each CJK character takes two columns.
	expect(oneLine("修正认证重定向", 7)).toBe("修正认…");
	expect(oneLine("修正", 4)).toBe("修正");
	// An emoji is two columns and is never split.
	expect(oneLine("🎉 shipped it", 4)).toBe("🎉 …");
});

test("mix blends in OKLCH and clamps t", async () => {
	expect(mix(0x000000, 0xffffff, 0)).toBe(0x000000);
	expect(mix(0x000000, 0xffffff, 1)).toBe(0xffffff);
	expect(mix(0x112233, 0xffffff, -1)).toBe(0x112233);
	const mid = mix(0x000000, 0xffffff, 0.5) & 0xff;
	expect(mid).toBeGreaterThan(0x40);
	expect(mid).toBeLessThan(0xc0);
});

test("describeTool gives a short phrase per tool", async () => {
	expect(
		describeTool("Edit", { file_path: "/repo/src/auth/redirect.ts" }),
	).toBe("edit redirect.ts");
	expect(describeTool("Bash", { command: "gh issue view 208" })).toBe(
		"gh issue view 208",
	);
	expect(describeTool("SendMessage", { to: "smith" })).toBe("message → smith");
	expect(describeTool("Mystery", {})).toBe("Mystery");
});

test("base64 matches the standard encoding", async () => {
	const enc = (s: string) => base64(new TextEncoder().encode(s));
	expect(enc("")).toBe("");
	expect(enc("f")).toBe("Zg==");
	expect(enc("fo")).toBe("Zm8=");
	expect(enc("foo")).toBe("Zm9v");
	expect(enc("foobar")).toBe("Zm9vYmFy");
});

const member = (
	id: string,
	color: number,
	issue?: number,
	status: Member["status"] = "running",
): Member => ({
	id,
	name: id,
	status,
	issue,
	color,
	lastActiveAt: 0,
});

test("the floor packs columns*rows cells and gives each issue a table", async () => {
	const team = [
		member("smith", 0, 208),
		member("ada", 1, 208),
		member("gate", 2, 204),
		member("scout", 3),
	];
	const { cells, labels } = drawFloor(team, 60, 6, 0);
	// 3 u32 words per cell, base64 of 4 bytes each.
	expect(cells.length).toBe(Math.ceil((60 * 6 * 12) / 3) * 4);
	expect(labels.map((l) => l.text)).toContain("#208");
	expect(labels.map((l) => l.text)).toContain("#204");
	expect(layout(60, 6, [208, 204]).tables.size).toBe(2);
});

test("an idle team draws the same frame every tick", async () => {
	const team = [
		member("smith", 0, 208, "idle"),
		member("gate", 2, 204, "idle"),
	];
	expect(drawFloor(team, 40, 6, 0).cells).toBe(drawFloor(team, 40, 6, 3).cells);
});

test("nextIssue: mentions don't drag a teammate to someone else's table", async () => {
	// Acknowledging gate's #102 while on #101 keeps smith at #101.
	expect(nextIssue("message", 101, [102])).toBe(101);
	// A message can give a newcomer its first issue.
	expect(nextIssue("message", undefined, [102])).toBe(102);
	// Work that still references the current issue stays put.
	expect(nextIssue("tool", 101, [102, 101])).toBe(101);
	// Work on a different issue moves you.
	expect(nextIssue("tool", 101, [204])).toBe(204);
	// No refs, spawns and turn ends never move anyone.
	expect(nextIssue("tool", 101, [])).toBe(101);
	expect(nextIssue("spawn", 101, [5])).toBe(101);
});
