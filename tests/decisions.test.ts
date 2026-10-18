import type { On, PluginState } from "claude-code";
import { expect, mock, test } from "claude-code/testing";
import type { BullpenEvent } from "../types";

const decisions: BullpenEvent[] = [1, 2].map((at) => ({
	version: 1,
	at,
	kind: "decision",
	who: "lead",
	detail: `skip or fix #${at}?`,
	context: "The flaky test failed twice.",
	issues: [at],
}));
const pane = {
	plugin: "bullpen",
	surface: "terminal" as const,
	component: "Pane" as const,
	requestId: "bullpen",
	props: {
		title: "Bullpen",
		isFocused: true,
		placement: "dock" as const,
		bodyColumns: 72,
		scroll: { offset: 0, bodyRows: 18 },
		view: {},
	},
};

function setup(on: On, extra: Partial<PluginState["bullpen"]> = {}) {
	mock.clock(on, { now: 20_000 });
	mock.env(on, {});
	const memory: Partial<PluginState["bullpen"]> = {
		events: decisions,
		members: {},
		focus: "needs",
		...extra,
	};
	const versions: Record<string, number> = {};
	on("state.get", { plugin: "bullpen" }, (_$, e) => ({
		value: { value: memory[e.key], version: versions[e.key] ?? 0 },
	}));
	on("state.set", { plugin: "bullpen" }, (_$, e) => {
		const version = versions[e.key] ?? 0;
		if (e.ifVersion !== undefined && e.ifVersion !== version)
			return { value: { isSet: false, version } };
		memory[e.key] = e.value as never;
		versions[e.key] = version + 1;
		return { value: { isSet: true, version: version + 1 } };
	});
	return memory;
}

for (const scenario of ["fills", "refused"] as const) {
	test(`enter on a decision: ${scenario}`, async ($, on) => {
		const memory = setup(on);
		const fills: { text: string; mode: string }[] = [];
		const toasts: string[] = [];
		const closed: string[] = [];
		on("prompt.read", () => ({ value: { text: "", cursor: 0 } }));
		on("prompt.fill", (_$, e) => {
			fills.push({ text: e.text, mode: e.mode });
			return scenario === "fills"
				? { isFilled: true }
				: { isFilled: false, refusal: "dialog" as const };
		});
		on("ui.toast", (_$, e) => {
			toasts.push(e.text);
			return { value: undefined };
		});
		on("ui.close", (_$, e) => {
			closed.push(e.id);
			return { value: undefined };
		});
		const ui = await $.ui.mount(pane);
		expect(JSON.stringify(await ui.drawn())).toContain("skip or fix #1?");
		await ui.press({ key: "need-reply" });
		// Never submits: only a fill, quoted, appended.
		expect(fills).toEqual([
			{ text: "> re #1: skip or fix #1?\n", mode: "append" },
		]);
		if (scenario === "fills") {
			// Still queued: only the submitted prompt (or d) takes it off.
			expect(memory.decisionsHandled ?? []).toEqual([]);
			expect(closed).toContain("bullpen");
			expect(memory.focus).toBe("");
		} else {
			expect(memory.decisionsHandled ?? []).toEqual([]);
			expect(closed).toEqual([]);
			expect(toasts.join(" ")).toContain("could not fill");
		}
		await ui.unmount();
	});
}

test("j and k move the cursor, d dismisses the selected decision", async ($, on) => {
	const memory = setup(on);
	const ui = await $.ui.mount(pane);
	await ui.press({ key: "need-next" });
	expect(memory.needsCursor).toBe(1);
	await ui.press({ key: "need-next" });
	expect(memory.needsCursor).toBe(1);
	await ui.press({ key: "need-prev" });
	expect(memory.needsCursor).toBe(0);
	await ui.press({ key: "need-dismiss" });
	expect(memory.decisionsHandled).toEqual(["d1-0"]);
	await ui.press({ key: "need-dismiss" });
	// The queue is empty: the view returns to the floor.
	expect(memory.focus).toBe("");
	await ui.unmount();
});

test("with nothing queued there is no needs-you key, and n only toasts", async ($, on) => {
	const memory = setup(on, { events: [], focus: "" });
	const toasts: string[] = [];
	on("ui.toast", (_$, e) => {
		toasts.push(e.text);
		return { value: undefined };
	});
	on("ui.open", () => ({ value: { isPlaced: true } }));
	const ui = await $.ui.mount(pane);
	expect(await ui.find({ key: "needs-focus" })).toBeUndefined();
	await $.command.run({
		command: "bullpen",
		args: "needs",
		origin: { kind: "composer" },
		presentation: { isFullscreen: false, columns: 80 },
	});
	expect(memory.focus).toBe("");
	expect(toasts.join(" ")).toContain("Nothing is waiting");
	await ui.unmount();
});

test("a queued decision shows the n key with its count", async ($, on) => {
	setup(on, { focus: "" });
	const ui = await $.ui.mount(pane);
	expect(await ui.find({ key: "needs-focus" })).toBeDefined();
	expect(JSON.stringify(await ui.drawn())).toContain("needs you (2)");
	await ui.unmount();
});
