import type { EngineInterface, On, RenderChildren } from "claude-code";
import { atom, read, update } from "claude-code";
import { hex } from "../src/color";
import { DEMO_PREFIX, DEMO_SCRIPT, type DemoStep } from "../src/demo";
import {
	argText,
	describeTool,
	issueRefs,
	nextIssue,
	oneLine,
} from "../src/events";
import { drawFloor, PALETTE } from "../src/floor";
import type { BullpenEvent, BullpenEventKind, Member } from "../types";

const PANE = "bullpen";
const FLOOR_KEY = "floor";
const FLOOR_ROWS = 6;
const LEAD = "lead";

const events = atom({ plugin: "bullpen", key: "events" } as const, []);
const members = atom({ plugin: "bullpen", key: "members" } as const, {});

type $ = EngineInterface;

/** The size the floor Raster was last drawn at, so blits match it. */
let floorSize: { columns: number; rows: number } | undefined;
let frame = 0;

async function now($: $) {
	return $.clock.now();
}

async function touch(
	$: $,
	id: string,
	patch: Partial<Member> & { name?: string },
) {
	const at = await now($);
	await update($, members, (all) => {
		const prev = all?.[id];
		const color = prev?.color ?? Object.keys(all ?? {}).length;
		const next: Member = {
			id,
			name: patch.name ?? prev?.name ?? (id === LEAD ? LEAD : id.slice(0, 8)),
			status: patch.status ?? prev?.status ?? "running",
			issue: patch.issue ?? prev?.issue,
			color,
			lastActiveAt: at,
		};
		return { ...all, [id]: next };
	});
}

async function nameOf($: $, agentId: string | undefined) {
	if (!agentId) return LEAD;
	const all = await read($, members);
	return all[agentId]?.name ?? agentId.slice(0, 8);
}

async function record(
	$: $,
	kind: BullpenEventKind,
	agentId: string | undefined,
	detail: string,
	extra: { target?: string; text?: string; attribute?: boolean } = {},
) {
	const who = await nameOf($, agentId);
	const issues = issueRefs(`${detail} ${extra.text ?? ""}`);
	const event: BullpenEvent = {
		at: await now($),
		kind,
		agentId,
		who,
		target: extra.target,
		detail,
		issues,
	};
	await update($, events, (list) => [...(list ?? []), event].slice(-300));
	if (extra.attribute === false) {
		await touch($, agentId ?? LEAD, {});
		return;
	}
	const current = (await read($, members))[agentId ?? LEAD]?.issue;
	const issue = nextIssue(kind, current, issues);
	await touch($, agentId ?? LEAD, issue === undefined ? {} : { issue });
}

async function reconcile($: $) {
	const listed = await $.agent.list();
	const at = await now($);
	await update($, members, (all) => {
		const next = { ...all };
		for (const agent of listed) {
			const prev = next[agent.id];
			if (!prev && !agent.teammateId) continue;
			next[agent.id] = {
				id: agent.id,
				name: agent.name ?? prev?.name ?? agent.description,
				status: agent.status === "running" ? "running" : "idle",
				issue: prev?.issue,
				color: prev?.color ?? Object.keys(next).length,
				lastActiveAt: prev?.lastActiveAt ?? at,
			};
		}
		for (const [id, member] of Object.entries(next)) {
			const isDemo = id.startsWith(DEMO_PREFIX);
			if (id !== LEAD && !isDemo && !listed.some((a) => a.id === id))
				next[id] = { ...member, status: "gone" };
		}
		return next;
	});
}

/** Plays one step of the demo script through the same path real events take. */
async function playStep($: $, step: DemoStep) {
	const id = `${DEMO_PREFIX}${step.who}`;
	const act = step.do;
	switch (act.kind) {
		case "join":
			await touch($, id, {
				name: step.who,
				status: "running",
				issue: act.issue,
			});
			await record($, "spawn", id, `${step.who} joined`, { attribute: false });
			return;
		case "work":
			await touch($, id, { status: "running", issue: act.issue });
			await record($, "tool", id, act.detail);
			return;
		case "rest":
			await touch($, id, { status: "idle" });
			await record($, "turn-end", id, "finished a turn");
			return;
		case "say":
			await record($, "message", id, act.text, {
				target: act.to,
				text: act.text,
			});
			return;
		case "leave":
			await touch($, id, { status: "gone" });
			return;
	}
}

/** Clears earlier demo members and plays the script on the session clock. */
async function playDemo($: $) {
	await update($, members, (all) =>
		Object.fromEntries(
			Object.entries(all ?? {}).filter(([id]) => !id.startsWith(DEMO_PREFIX)),
		),
	);
	let at = 0;
	for (const step of DEMO_SCRIPT) {
		at += step.wait;
		$.clock.after(at, () => void playStep($, step).catch(() => {}));
	}
}

async function openPane($: $) {
	return $.ui.open({ id: PANE, title: "Bullpen" });
}

export function register(on: On) {
	on("session.start", async ($, e, next) => {
		await $.command.register({
			name: "bullpen",
			description: "Open the Bullpen: a live view of your agent team",
			argumentHint: "[demo]",
		});

		$.clock.every(4000, () => void reconcile($));

		// Animate only while someone is working; an idle office draws nothing new.
		$.clock.every(250, async () => {
			if (!floorSize) return;
			const list = Object.values(await read($, members));
			if (!list.some((m) => m.status === "running")) return;
			frame++;
			const { cells } = drawFloor(
				list,
				floorSize.columns,
				floorSize.rows,
				frame,
			);
			await $.ui.blit({ requestId: PANE, key: FLOOR_KEY, cells });
		});

		return next(e);
	});

	on("command.run", { command: "bullpen" }, async ($, e) => {
		const opened = await openPane($);
		if (e.args.trim() === "demo") {
			await playDemo($);
			return { text: "Bullpen demo: a scripted team is joining the floor." };
		}
		return {
			text: opened.isPlaced
				? "Bullpen opened."
				: `Bullpen is waiting for room: ${opened.reason}`,
		};
	});

	on("agent.spawn", async ($, e, next) => {
		const spawned = await next(e);
		if (spawned.agentId) {
			const brief = `${e.description} ${e.prompt}`;
			await touch($, spawned.agentId, {
				name: e.name ?? e.description,
				status: "running",
				issue: issueRefs(brief)[0],
			});
			await record(
				$,
				"spawn",
				e.parentAgentId,
				`${e.isTeammate ? "teammate" : "subagent"} ${e.name ?? e.description} joined`,
				{
					target: e.name,
					text: brief,
					attribute: false,
				},
			);
		}
		return spawned;
	});

	on("turn.start", async ($, e, next) => {
		void touch($, e.agentId ?? LEAD, { status: "running" })
			.then(() =>
				record($, "turn-start", e.agentId, "started a turn", { text: e.text }),
			)
			.catch(() => {});
		return next(e);
	});

	on("turn.complete", async ($, e, next) => {
		const done = await next(e);
		await touch($, e.agentId ?? LEAD, { status: "idle" });
		await record(
			$,
			"turn-end",
			e.agentId,
			`finished a turn (${Math.round(e.durationMs / 1000)}s)`,
		);
		return done;
	});

	on("tool.call", async ($, e, next) => {
		const args = e as unknown as Record<string, unknown>;
		// Observe only, and never hold up the call while recording it.
		void record($, "tool", e.agentId, describeTool(String(e.tool), args), {
			target: String(e.tool),
			text: argText(args),
		}).catch(() => {});
		return next(e);
	});

	on("session.send", async ($, e, next) => {
		void record($, "message", e.agentId, oneLine(e.text, 80), {
			target: e.to,
			text: e.text,
		}).catch(() => {});
		return next(e);
	});

	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e);
		const all = await read($, members);
		const list = Object.values(all);
		const log = await read($, events);
		const columns = Math.max(20, Math.min(512, e.props.bodyColumns ?? 60));
		const viewportRows = e.viewport?.rows ?? 30;
		const logRoom = Math.max(3, viewportRows - FLOOR_ROWS - list.length - 6);

		// Only the terminal draws a Raster; elsewhere the roster below stands alone.
		let floor: RenderChildren = null;
		if (e.surface === "terminal") {
			const { Raster } = $.ui.resolve(e);
			floorSize = { columns, rows: FLOOR_ROWS };
			const { cells } = drawFloor(list, columns, FLOOR_ROWS, frame);
			floor = (
				<Raster
					key={FLOOR_KEY}
					columns={columns}
					rows={FLOOR_ROWS}
					cells={cells}
				/>
			);
		}

		const active = list.filter((m) => m.status !== "gone");
		const messages = log.filter((ev) => ev.kind === "message").length;

		return (
			<Box flexDirection="column">
				<Text bold>
					Bullpen · {active.length} on the floor · ✉ {messages}
				</Text>
				{floor}
				{active.map((m) => (
					<Text>
						<Text color={hex(PALETTE[m.color % PALETTE.length] ?? 0xffffff)}>
							{m.status === "running" ? "●" : "○"} {m.name}
						</Text>
						<Text dimColor>
							{" "}
							{m.issue === undefined ? "no issue yet" : `#${m.issue}`}
						</Text>
					</Text>
				))}
				<Text dimColor>── recent ──</Text>
				{log.length === 0 && (
					<Text dimColor>
						Nothing yet. Spawn a teammate to see the floor come alive.
					</Text>
				)}
				{log.slice(-logRoom).map((ev) => (
					<Text dimColor={ev.kind !== "message"}>
						{ev.kind === "message"
							? `✉ ${ev.who} → ${ev.target}: `
							: `${ev.who}: `}
						{oneLine(ev.detail, Math.max(10, columns - ev.who.length - 6))}
					</Text>
				))}
			</Box>
		);
	});

	on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
		const list = Object.values(await read($, members)).filter(
			(m) => m.id !== LEAD && m.status !== "gone",
		);
		if (e.props.hasSurvey || list.length === 0) return next(e);
		const { Box, Text, Button } = $.ui.resolve(e);
		return (
			<Box>
				<Button key="open" plain onPress={() => void openPane($)}>
					☰ bullpen
				</Button>
				{list.map((m) => (
					<Text color={hex(PALETTE[m.color % PALETTE.length] ?? 0xffffff)}>
						{"  "}
						{m.status === "running" ? "●" : "○"}
						{m.name}
						{m.issue === undefined ? "" : ` #${m.issue}`}
					</Text>
				))}
			</Box>
		);
	});
}
