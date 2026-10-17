import { expect, mock, test } from "claude-code/testing";

test("the demo band mounts and its button opens the pane", async ($, on) => {
	mock.clock(on, { now: 40_000 });
	on("state.get", { plugin: "bullpen", key: "demoStart" }, () => ({
		value: { value: 0, version: 1 },
	}));
	let opened = "";
	on("ui.open", (_$, e) => {
		opened = e.id;
		return { value: { isPlaced: true } };
	});
	for (const bodyColumns of [48, 72, 110, 160]) {
		const ui = await $.ui.mount({
			plugin: "bullpen",
			surface: "terminal",
			component: "AbovePrompt",
			props: {
				hasSurvey: false,
				isWorking: false,
				maxRows: 3,
				bodyColumns,
				scroll: { offset: 0, bodyRows: 3 },
				view: {},
			},
		});
		expect((await ui.find({ key: "open" }))?.text).toBe("# bullpen");
		expect(await ui.find({ type: "Text", text: /#204/ })).toBeDefined();
		await ui.press({ key: "open" });
		expect(opened).toBe("bullpen");
		await ui.unmount();
	}
});
