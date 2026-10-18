import type { PluginState } from "claude-code";
import { expect, mock, test } from "claude-code/testing";
import { buildModel } from "../src/model";
import { answerSection } from "../src/render/answer";
import { keys, paneView } from "../src/render/pane";
import type { BullpenEvent } from "../types";

const text = (lines: { text: string }[][]) =>
	lines.map((l) => l.map((s) => s.text).join(""));

const ask: BullpenEvent = {
	version: 1,
	at: 1,
	kind: "message",
	who: "gate",
	agentId: "agent-gate",
	target: "lead",
	detail: "Decision: skip or fix the flaky test?",
	issues: [12],
};

test("the answer key shows only while something waits or the answer view is open", () => {
	expect(keys(undefined, 0)).toBe("s: shipping · t: messages");
	expect(keys(undefined, 2)).toBe("a: answer (2) · s: shipping · t: messages");
	expect(keys("answer", 0)).toBe("a: back · s: shipping · t: messages");
	expect(keys("talk", 1)).toBe("a: answer (1) · s: shipping · t: back");
});

test("the answer section names who asks, the issues and the question", () => {
	const rows = text(
		answerSection(
			{ from: "gate", text: "skip or fix ".repeat(20), issues: [12, 13] },
			40,
		),
	);
	expect(rows[0]).toContain("gate needs your input");
	expect(rows[1]).toBe("#12 #13");
	expect(rows.length).toBeGreaterThan(3);
	expect(text(answerSection(undefined, 40)).join("\n")).toContain(
		"Nothing is waiting",
	);
});

test("the pane shows the question in answer focus and counts asks in the footer", () => {
	const quiet = paneView(buildModel([], 10), [], 110, 32, 10, {});
	expect(text(quiet.footer).join("\n")).not.toContain("a: answer");

	const model = buildModel([ask], 10);
	const idle = paneView(model, [], 110, 32, 10, {});
	expect(text(idle.footer).join("\n")).toContain("a: answer (1)");

	for (const columns of [72, 110, 160]) {
		const view = paneView(model, [], columns, 32, 10, { focus: "answer" });
		const body = text(view.regions).join("\n");
		expect(body).toContain("gate needs your input");
		expect(body).toContain("skip or fix the flaky test?");
		expect(text(view.footer).join("\n")).toContain("a: back");
	}
});

const pane = {
	plugin: "bullpen",
	surface: "terminal" as const,
	component: "Pane" as const,
	requestId: "bullpen",
	props: {
		title: "Bullpen",
		isFocused: true,
		placement: "dock" as const,
		bodyColumns: 110,
		scroll: { offset: 0, bodyRows: 32 },
		view: {},
	},
};

for (const open of [true, false]) {
	test(`the answer button is ${open ? "shown" : "hidden"} when ${open ? "something" : "nothing"} waits`, async ($, on) => {
		mock.clock(on, { now: 20_000 });
		mock.env(on, {});
		const memory: Partial<PluginState["bullpen"]> = {
			events: open ? [ask] : [],
			members: {},
		};
		on("state.get", { plugin: "bullpen" }, (_$, e) => ({
			value: { value: memory[e.key], version: 0 },
		}));
		on("state.set", { plugin: "bullpen" }, (_$, e) => {
			memory[e.key] = e.value as never;
			return { value: { isSet: true, version: 1 } };
		});
		const ui = await $.ui.mount(pane);
		expect(!!(await ui.find({ key: "answer" }))).toBe(open);
		expect(await ui.find({ key: "shipping-focus" })).toBeDefined();
		await ui.unmount();
	});
}
