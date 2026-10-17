import { expect, mock, test } from "claude-code/testing";
import { DEFAULT_PROFILE } from "../src/profile";

for (const glyphs of ["ascii", "unicode"] as const) {
	test(`story teammate links respect ${glyphs} mode and still open the agent`, async ($, on) => {
		mock.clock(on, { now: 0 });
		on("state.get", { plugin: "bullpen", key: "storyIssue" }, () => ({
			value: { value: 12, version: 1 },
		}));
		on("state.get", { plugin: "bullpen", key: "events" }, () => ({
			value: {
				value: [
					{
						version: 1,
						at: 0,
						kind: "tool",
						who: "dev→",
						detail: "edit",
						issues: [12],
					},
				],
				version: 1,
			},
		}));
		on("state.get", { plugin: "bullpen", key: "members" }, () => ({
			value: { value: { worker: { id: "worker", name: "dev→" } }, version: 1 },
		}));
		let viewed = "";
		on("ui.view", (_$, e) => {
			viewed = e.agentId ?? "";
			return { value: {} };
		});
		on("state.get", { plugin: "bullpen", key: "profile" }, () => ({
			value: { value: { ...DEFAULT_PROFILE, glyphs }, version: 1 },
		}));
		const ui = await $.ui.mount({
			plugin: "bullpen",
			surface: "terminal",
			component: "Pane",
			requestId: "bullpen-story",
			props: {
				title: "Bullpen #12",
				isFocused: true,
				placement: "dock",
				bodyColumns: 48,
				scroll: { offset: 0, bodyRows: 12 },
				view: {},
			},
		});
		expect((await ui.find({ key: "agent-0-0" }))?.text).toBe(
			glyphs === "ascii" ? "dev> " : "dev→ ",
		);
		await ui.press({ key: "agent-0-0" });
		expect(viewed).toBe("worker");
		await ui.unmount();
	});
}
