import { expect, test } from "claude-code/testing";
import { atTail } from "../src/scroll";

test("a window shows the tail when it reaches the last row or the tree fits", () => {
	expect(atTail(0, 10, 8)).toBe(true);
	expect(atTail(0, 10, 10)).toBe(true);
	expect(atTail(30, 10, 40)).toBe(true);
	expect(atTail(29, 10, 40)).toBe(false);
	expect(atTail(0, 10, 100)).toBe(false);
});
