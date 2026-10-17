import type { EngineInterface, FsEntry, On, RenderChildren } from "claude-code";
import { atom, read, update } from "claude-code";
import {
	applyBatch,
	Batcher,
	type CollectOp,
	FLUSH_MS,
	LEAD,
	type MemberPatch,
} from "../src/collect";
import { hex } from "../src/color";
import { DEMO_PREFIX, DEMO_SCRIPT, type DemoStep } from "../src/demo";
import { argText, describeTool, issueRefs, oneLine } from "../src/events";
import { drawFloor, PALETTE } from "../src/floor";
import {
	type BullpenEvent,
	type Chunk,
	chunkLines,
	chunkName,
	journalDir,
	lastChunk,
	MAX_CHUNKS,
	planAppend,
	STATE_EVENTS,
	teamOf,
	toLine,
} from "../src/journal";
import { DEFAULT_PROFILE, parseProfile } from "../src/profile";
import type { BullpenEventKind } from "../types";

const PANE = "bullpen";
const FLOOR_KEY = "floor";
const FLOOR_ROWS = 6;
/** How often flushed events are appended to the journal file. */
const JOURNAL_FLUSH_MS = 1000;

const events = atom({ plugin: "bullpen", key: "events" } as const, []);
const members = atom({ plugin: "bullpen", key: "members" } as const, {});
const profile = atom(
	{ plugin: "bullpen", key: "profile" } as const,
	DEFAULT_PROFILE,
);

type $ = EngineInterface;

/** The size the floor Raster was last drawn at, so blits match it. */
let floorSize: { columns: number; rows: number } | undefined;
let frame = 0;

/** The team name once a teammate's address shows it; until then the session id. */
let team: string | undefined;
/** The journal's current chunk as last written, so appends needn't re-read it. */
let journal: { dir: string; current: Chunk } | undefined;

let collector: Batcher<CollectOp> | undefined;
let journalWriter: Batcher<BullpenEvent> | undefined;

async function now($: $) {
	return $.clock.now();
}

/** Folds a batch into members and events: one write per atom. */
async function flushState($: $, ops: CollectOp[]) {
	let added: BullpenEvent[] = [];
	await update($, members, (all) => {
		const out = applyBatch(all ?? {}, ops);
		added = out.events;
		return out.members;
	});
	if (added.length === 0) return;
	await update($, events, (list) =>
		[...(list ?? []), ...added].slice(-STATE_EVENTS),
	);
	// The demo is scripted; only real teams go in the journal file.
	for (const ev of added)
		if (!ev.agentId?.startsWith(DEMO_PREFIX)) writerOf($).push(ev);
}

/** Whether a journal problem was logged yet; once per session is enough. */
let journalWarned = false;

function warnJournal($: $, text: string) {
	if (journalWarned) return;
	journalWarned = true;
	$.ui.log(`bullpen: ${text}`, { to: "debug" });
}

/**
 * This writer's newest chunk in `dir`, or an empty chunk 1 for a new journal.
 * Never guesses: when the folder can't be listed it answers undefined and the
 * batch isn't written, and a chunk that exists but can't be read is left
 * alone while journaling moves on to the next one in the ring.
 */
async function loadChunk(
	$: $,
	dir: string,
	writer: string,
): Promise<Chunk | undefined> {
	if (!(await $.fs.exists(dir))) return { writer, index: 1, lines: [] };
	let entries: FsEntry[];
	try {
		entries = await $.fs.list(dir);
	} catch (error) {
		warnJournal($, `can't list ${dir} (${error}); not journaling`);
		return undefined;
	}
	const index = Math.max(1, lastChunk(entries, writer));
	const path = `${dir}/${chunkName(writer, index)}`;
	if (!(await $.fs.exists(path))) return { writer, index, lines: [] };
	try {
		return { writer, index, lines: chunkLines(await $.fs.read(path)) };
	} catch (error) {
		warnJournal($, `can't read ${path} (${error}); starting the next chunk`);
		return { writer, index: (index % MAX_CHUNKS) + 1, lines: [] };
	}
}

async function writeJournal($: $, added: BullpenEvent[]) {
	const home = (await $.env.get("HOME")) ?? (await $.env.get("USERPROFILE"));
	if (!home) return;
	const writer = await $.session.id();
	const dir = journalDir(home, team ?? writer);
	if (journal?.dir !== dir || journal.current.writer !== writer) {
		const current = await loadChunk($, dir, writer);
		if (!current) return;
		journal = { dir, current };
	}
	const plan = planAppend(journal.current, added.map(toLine));
	for (const { name, text } of plan.writes)
		await $.fs.write(`${dir}/${name}`, text);
	journal = { dir, current: plan.current };
}

function collectorOf($: $) {
	collector ??= new Batcher(
		FLUSH_MS,
		(ms, fn) => void $.clock.after(ms, fn),
		(ops) => flushState($, ops),
	);
	return collector;
}

function writerOf($: $) {
	journalWriter ??= new Batcher(
		JOURNAL_FLUSH_MS,
		(ms, fn) => void $.clock.after(ms, fn),
		(added) => writeJournal($, added),
	);
	return journalWriter;
}

async function touch($: $, id: string, patch: MemberPatch) {
	collectorOf($).push({ op: "touch", at: await now($), id, patch });
}

async function record(
	$: $,
	kind: BullpenEventKind,
	agentId: string | undefined,
	detail: string,
	extra: { target?: string; text?: string; attribute?: boolean } = {},
) {
	collectorOf($).push({
		op: "event",
		at: await now($),
		kind,
		agentId,
		detail,
		target: extra.target,
		text: extra.text,
		attribute: extra.attribute ?? true,
	});
}

async function reconcile($: $) {
	const listed = await $.agent.list();
	team ??= listed.map((a) => teamOf(a.teammateId)).find((t) => t);
	collectorOf($).push({ op: "reconcile", at: await now($), listed });
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
			await record($, "leave", id, `${step.who} left`, { attribute: false });
			return;
	}
}

/** Clears earlier demo members and plays the script on the session clock. */
async function playDemo($: $) {
	collectorOf($).push({ op: "clear-demo" });
	let at = 0;
	for (const step of DEMO_SCRIPT) {
		at += step.wait;
		$.clock.after(at, () => void playStep($, step).catch(() => {}));
	}
}

/** Reads `.claude/bullpen.json` from the project; a bad file warns once and never blocks. */
async function loadProfile($: $) {
	let text: string | undefined;
	try {
		const path = `${await $.session.root()}/.claude/bullpen.json`;
		if (await $.fs.exists(path)) text = await $.fs.read(path);
	} catch (error) {
		$.ui.log(`bullpen: can't read bullpen.json (${error})`, { to: "debug" });
	}
	const parsed = parseProfile(text);
	await update($, profile, () => parsed.profile);
	if (parsed.warnings.length > 0)
		$.ui.toast(`bullpen.json: ${parsed.warnings.join("; ")}`, {
			timeoutMs: 10000,
		});
}

async function openPane($: $) {
	return $.ui.open({ id: PANE, title: "Bullpen" });
}

export function register(on: On) {
	on("session.start", async ($, e, next) => {
		// A new session in the same process starts its own journal.
		team = undefined;
		journal = undefined;
		journalWarned = false;

		await loadProfile($);

		await $.command.register({
			name: "bullpen",
			description: "Open the Bullpen: a live view of your agent team",
			argumentHint: "[demo|reload]",
		});

		$.clock.every(4000, () => void reconcile($));

		// Animate only while someone is working; an idle office draws nothing new.
		$.clock.every(250, async () => {
			if (!floorSize) return;
			if (!(await read($, profile)).animations) return;
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

	// Write out what's still batched before the session goes.
	on("session.end", async (_$, e, next) => {
		await collector?.drain();
		await journalWriter?.drain();
		return next(e);
	});

	on("command.run", { command: "bullpen" }, async ($, e) => {
		if (e.args.trim() === "reload") {
			await loadProfile($);
			return { text: "Bullpen: reloaded .claude/bullpen.json." };
		}
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
		team ??= teamOf(spawned.teammateId);
		const { agentId } = spawned;
		if (agentId) {
			const brief = `${e.description} ${e.prompt}`;
			void touch($, agentId, {
				name: e.name ?? e.description,
				status: "running",
				issue: issueRefs(brief)[0],
			})
				.then(() =>
					record(
						$,
						"spawn",
						e.parentAgentId,
						`${e.isTeammate ? "teammate" : "subagent"} ${e.name ?? e.description} joined`,
						{ target: e.name, text: brief, attribute: false },
					),
				)
				.catch(() => {});
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
		void touch($, e.agentId ?? LEAD, { status: "idle" })
			.then(() =>
				record(
					$,
					"turn-end",
					e.agentId,
					`finished a turn (${Math.round(e.durationMs / 1000)}s)`,
				),
			)
			.catch(() => {});
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
