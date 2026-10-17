import type { PluginState } from "claude-code";
import { expect, mock, test } from "claude-code/testing";
import type { BullpenEvent } from "../types";

const asks: BullpenEvent[] = [1, 2].map((at) => ({
	version: 1,
	at,
	kind: "message",
	who: "gate",
	agentId: "agent-gate",
	target: "lead",
	detail: `Decision ${at}: skip or fix?`,
	issues: [12],
}));
const member = {
	id: "agent-gate",
	name: "gate",
	status: "idle" as const,
	color: 0,
	lastActiveAt: 2,
};
const pane = {
	plugin: "bullpen",
	surface: "terminal" as const,
	component: "Pane" as const,
	requestId: "bullpen-answer",
	props: {
		title: "Answer gate",
		isFocused: true,
		placement: "dock" as const,
		bodyColumns: 72,
		scroll: { offset: 0, bodyRows: 18 },
		view: {},
	},
};

for (const scenario of [
	"delivered",
	"refused",
	"replacement",
	"demo",
	"replay",
] as const) {
	test(`human reply form: ${scenario}`, async ($, on) => {
		mock.clock(on, { now: 20_000 });
		mock.env(on, {});
		const memory: Partial<PluginState["bullpen"]> = {
			events: asks,
			members: { [member.id]: member },
		};
		if (scenario === "demo") memory.demoStart = 0;
		if (scenario === "replay")
			memory.replay = { events: asks, startedAt: 0, path: "recorded" };
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
		let sent = 0;
		on("ui.open", () => ({ value: { isPlaced: true } }));
		on("session.send", (_$, e) => {
			sent++;
			expect(e.to).toBe(member.id);
			expect(e.text).toContain("Decision 1: skip or fix?");
			expect(e.text).toContain("Fix it properly.");
			return scenario === "refused"
				? { isDelivered: false, reason: "agent unavailable" }
				: { isDelivered: true };
		});
		await $.command.run({
			command: "bullpen",
			args: "answer",
			origin: { kind: "composer" },
			presentation: { isFullscreen: false, columns: 80 },
		});
		expect(memory.decision?.from).toBe("gate");
		const ui = await $.ui.mount(pane);
		expect(JSON.stringify(await ui.drawn())).toContain("human-answer");
		expect(await ui.find({ key: "human-answer" })).toBeDefined();
		if (scenario === "replacement")
			memory.members = { other: { ...member, id: "other" } };
		await ui.input({ key: "human-answer", text: "Fix it properly." });
		// Our in-memory state hooks bypass the host's automatic invalidation.
		await ui.redraw();
		if (scenario === "delivered") {
			expect(sent).toBe(1);
			expect(
				await ui.find({ type: "Text", text: /Answer sent/ }),
			).toBeDefined();
			expect(memory.teamModel?.asks.map((a) => a.open)).toEqual([false, true]);
			await ui.input({ key: "human-answer", text: "Fix it properly." });
			expect(sent).toBe(1);
		} else if (scenario === "refused") {
			expect(sent).toBe(1);
			expect(
				await ui.find({ type: "Text", text: /Not delivered/ }),
			).toBeDefined();
			expect(memory.decisionDraft).toBe("Fix it properly.");
			await ui.press({ key: "send-answer" });
			expect(sent).toBe(2);
		} else {
			expect(sent).toBe(0);
			expect(
				await ui.find({
					type: "Text",
					text:
						scenario === "replacement"
							? /original asking agent is unavailable/
							: /read-only/,
				}),
			).toBeDefined();
		}
		await ui.unmount();
	});
}
