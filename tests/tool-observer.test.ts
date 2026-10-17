import { expect, test } from "claude-code/testing";

test("a throwing collector never changes a tool result or denial", async ($, on) => {
	on("clock.now", () => {
		throw new Error("collector unavailable");
	});
	let calls = 0;
	on("tool.call", { tool: "Bash" }, (_$, e) => {
		calls++;
		if (e.command === "denied") return { deny: "policy denied" };
		if (e.command === "failed") return { isError: true, result: "failed" };
		return { result: { stdout: "closed", stderr: "", interrupted: false } };
	});
	const result = await $.tool.call({
		tool: "Bash",
		command: "gh issue close 12",
	});
	expect(result).toEqual({
		result: { stdout: "closed", stderr: "", interrupted: false },
	});
	expect(await $.tool.call({ tool: "Bash", command: "denied" })).toEqual({
		deny: "policy denied",
	});
	expect(await $.tool.call({ tool: "Bash", command: "failed" })).toEqual({
		isError: true,
		result: "failed",
	});
	expect(calls).toBe(3);
});
