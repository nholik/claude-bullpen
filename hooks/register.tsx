import type {
	ElementConstructor,
	EngineInterface,
	FsEntry,
	On,
	RenderChildren,
	TextProps,
	Timer,
} from "claude-code";
import { atom, read, update } from "claude-code";
import {
	applyBatch,
	Batcher,
	type CollectOp,
	FLUSH_MS,
	InFlight,
	LEAD,
	type MemberPatch,
} from "../src/collect";
import { hex } from "../src/color";
import { DEMO_PREFIX, DEMO_SCRIPT, type DemoStep } from "../src/demo";
import { demoOps } from "../src/demo-replay";
import { argText, describeTool, issueRefs, oneLine } from "../src/events";
import { drawFloor, floorRows } from "../src/floor";
import {
	addSnapshot,
	allStatesFilter,
	burndownKey,
	exactCounts,
	fetchCounts,
	issueListArgv,
	parseBurndown,
	parseRepo,
	REPO_ARGV,
	readIssueList,
	runFailure,
} from "../src/github";
import {
	type BullpenEvent,
	type Chunk,
	chunkLines,
	chunkName,
	journalDir,
	lastChunk,
	MAX_CHUNKS,
	planAppend,
	planRetention,
	STATE_EVENTS,
	teamOf,
	toLine,
} from "../src/journal";
import { buildModel } from "../src/model";
import { DEFAULT_PROFILE, parseProfile } from "../src/profile";
import { band, footer, header } from "../src/render/header";
import type { Line } from "../src/render/lines";
import { roster } from "../src/render/roster";
import type { BullpenEventKind } from "../types";

const PANE = "bullpen";
const FLOOR_KEY = "floor";
/** How often flushed events are appended to the journal file. */
const JOURNAL_FLUSH_MS = 1000;

const events = atom({ plugin: "bullpen", key: "events" } as const, []);
const members = atom({ plugin: "bullpen", key: "members" } as const, {});
const profile = atom(
	{ plugin: "bullpen", key: "profile" } as const,
	DEFAULT_PROFILE,
);
const github = atom({ plugin: "bullpen", key: "github" } as const, {
	filter: "",
	burndown: [],
	checkedAt: 0,
});

type $ = EngineInterface;

/** The size the floor Raster was last drawn at, so blits match it. */
let floorSize: { columns: number; rows: number } | undefined;
let frame = 0;
let pollTimer: Timer | undefined;
let pollGeneration = 0;
const seenAt = atom({ plugin: "bullpen", key: "hallwaySeenAt" } as const, -1);

function renderLines(Text: ElementConstructor<TextProps>, lines: Line[]) {
	return lines.map((line) => (
		<Text>
			{line.map((seg) => (
				<Text
					color={seg.fg === undefined ? undefined : hex(seg.fg)}
					bold={seg.bold}
					dimColor={seg.dim}
				>
					{seg.text}
				</Text>
			))}
		</Text>
	));
}

/** The team name once a teammate's address shows it; until then the session id. */
let team: string | undefined;
/** The journal's current chunk as last written, so appends needn't re-read it. */
let journal: { dir: string; current: Chunk } | undefined;

const producers = new InFlight();
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

/** Empties other sessions' old chunks (`$.fs` can't delete); best effort. */
async function pruneJournal($: $, dir: string, writer: string) {
	try {
		const entries = await $.fs.list(dir);
		for (const name of planRetention(entries, await $.clock.now(), writer))
			await $.fs.write(`${dir}/${name}`, "");
	} catch (error) {
		warnJournal($, `can't prune ${dir} (${error})`);
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
		void pruneJournal($, dir, writer).catch(() => {});
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

/** Polls `gh` for the issue list and adds a burndown point to `$.store`. */
async function pollGithub($: $, generation = pollGeneration) {
	const prev = await read($, github);
	const at = await now($);
	const result = await $.process
		.run(issueListArgv(prev.filter))
		.then(readIssueList, runFailure);
	let { repo, burndown } = prev;
	if (result.status === "ok") {
		if (!repo) {
			const resolved = await $.process.run(REPO_ARGV).catch(() => undefined);
			if (resolved?.exitCode === 0) repo = parseRepo(resolved.stdout);
		}
		if (repo)
			result.counts = await fetchCounts(
				(argv) => $.process.run(argv),
				repo,
				prev.filter,
			);
		const counts = exactCounts(result);
		if (repo && counts) {
			const key = burndownKey(repo, prev.filter);
			const point = { at, ...counts };
			burndown = addSnapshot(parseBurndown(await $.store.get(key)), point);
			await $.store.set(key, burndown);
		}
	}
	if (generation !== pollGeneration) return;
	await update($, github, (cur) => ({
		...cur,
		result,
		repo,
		burndown,
		checkedAt: at,
	}));
}

/** Plays one step of the demo script through the same path real events take. */
async function playStep($: $, step: DemoStep) {
	for (const op of demoOps(step, await now($))) collectorOf($).push(op);
}

/** Clears earlier demo members and plays the script on the session clock. */
async function playDemo($: $) {
	collectorOf($).push({ op: "clear-demo" });
	let at = 0;
	for (const step of DEMO_SCRIPT) {
		at += step.wait;
		$.clock.after(
			at,
			() => void producers.track(playStep($, step)).catch(() => {}),
		);
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
	const filter = allStatesFilter(parsed.profile.issues.filter);
	await update($, github, (old) =>
		old.filter === filter ? old : { filter, burndown: [], checkedAt: 0 },
	);
	pollTimer?.cancel();
	const generation = ++pollGeneration;
	const poll = async () => {
		await pollGithub($, generation).catch(() => {});
		if (generation === pollGeneration)
			pollTimer = $.clock.after(
				parsed.profile.issues.pollSeconds * 1000,
				() => void poll(),
			);
	};
	void poll();
	if (parsed.warnings.length > 0)
		$.ui.toast(`bullpen.json: ${parsed.warnings.join("; ")}`, {
			timeoutMs: 10000,
		});
}

async function openPane($: $) {
	const at = await now($);
	await update($, seenAt, () => at);
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

		$.clock.every(
			4000,
			() => void producers.track(reconcile($)).catch(() => {}),
		);

		// Animate only while someone is working; an idle office draws nothing new.
		$.clock.every(250, async () => {
			if (!floorSize) return;
			const config = await read($, profile);
			if (!config.animations) return;
			const list = Object.values(await read($, members));
			if (!list.some((m) => m.status === "running")) return;
			frame++;
			const { cells } = drawFloor(
				list,
				floorSize.columns,
				floorSize.rows,
				frame,
				{},
				config,
			);
			await $.ui.blit({ requestId: PANE, key: FLOOR_KEY, cells });
		});

		return next(e);
	});

	// Write out what's still batched before the session goes.
	on("session.end", async (_$, e, next) => {
		pollTimer?.cancel();
		pollGeneration++;
		await producers.drain();
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
		const result = next(e);
		void producers
			.track(
				result.then(async (spawned) => {
					team ??= teamOf(spawned.teammateId);
					const { agentId } = spawned;
					if (!agentId) return;
					const brief = `${e.description} ${e.prompt}`;
					await touch($, agentId, {
						name: e.name ?? e.description,
						status: "running",
						issue: issueRefs(brief)[0],
					});
					await record(
						$,
						"spawn",
						e.parentAgentId,
						`${e.isTeammate ? "teammate" : "subagent"} ${e.name ?? e.description} joined`,
						{ target: e.name, text: brief, attribute: false },
					);
				}),
			)
			.catch(() => {});
		return result;
	});

	on("turn.start", async ($, e, next) => {
		void producers
			.track(
				touch($, e.agentId ?? LEAD, { status: "running" }).then(() =>
					record($, "turn-start", e.agentId, "started a turn", {
						text: e.text,
					}),
				),
			)
			.catch(() => {});
		return next(e);
	});

	on("turn.complete", async ($, e, next) => {
		const result = next(e);
		void producers
			.track(
				result.then(async () => {
					await touch($, e.agentId ?? LEAD, { status: "idle" });
					await record(
						$,
						"turn-end",
						e.agentId,
						`finished a turn (${Math.round(e.durationMs / 1000)}s)`,
					);
				}),
			)
			.catch(() => {});
		return result;
	});

	on("tool.call", async ($, e, next) => {
		const args = e as unknown as Record<string, unknown>;
		// Observe only, and never hold up the call while recording it.
		void producers
			.track(
				record($, "tool", e.agentId, describeTool(String(e.tool), args), {
					target: String(e.tool),
					text: argText(args),
				}),
			)
			.catch(() => {});
		return next(e);
	});

	on("session.send", async ($, e, next) => {
		void producers
			.track(
				record($, "message", e.agentId, oneLine(e.text, 80), {
					target: e.to,
					text: e.text,
				}),
			)
			.catch(() => {});
		return next(e);
	});

	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e);
		const all = await read($, members);
		const list = Object.values(all);
		const log = await read($, events);
		const source = await read($, github);
		const config = await read($, profile);
		const at = await now($);
		const model = buildModel(log, at, {
			present: Object.fromEntries(list.map((m) => [m.name, m.status])),
		});
		const columns = Math.max(20, Math.min(512, e.props.bodyColumns ?? 60));
		const floorHeight = floorRows(columns);
		const viewportRows = e.props.scroll.bodyRows;
		const heading = header(model, source, columns, at);
		const logRoom = Math.max(
			0,
			viewportRows - floorHeight - heading.length - 1,
		);

		// Only the terminal draws a Raster; elsewhere the roster below stands alone.
		let floor: RenderChildren = null;
		if (e.surface === "terminal") {
			const { Raster } = $.ui.resolve(e);
			floorSize = { columns, rows: floorHeight };
			const { cells } = drawFloor(
				list,
				columns,
				floorHeight,
				frame,
				{},
				config,
			);
			floor = (
				<Raster
					key={FLOOR_KEY}
					columns={columns}
					rows={floorHeight}
					cells={cells}
				/>
			);
		}

		return (
			<Box flexDirection="column">
				{renderLines(Text, heading)}
				{floor}
				{renderLines(Text, roster(list, log, config, columns, logRoom))}
				{renderLines(Text, footer(source, columns))}
			</Box>
		);
	});

	on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
		const list = Object.values(await read($, members)).filter(
			(m) => m.id !== LEAD && m.status !== "gone",
		);
		if (e.props.hasSurvey || list.length === 0) return next(e);
		const { Box, Text, Button } = $.ui.resolve(e);
		const at = await now($);
		const model = buildModel(await read($, events), at);
		const line = band(
			model,
			await read($, github),
			await read($, profile),
			e.props.bodyColumns,
			await read($, seenAt),
		);
		return (
			<Box>
				<Button key="open" plain onPress={() => void openPane($)}>
					{renderLines(Text, [line])}
				</Button>
			</Box>
		);
	});
}
