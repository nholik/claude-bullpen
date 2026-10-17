import type {
	BoxProps,
	ButtonProps,
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
import { DEMO_PREFIX, DEMO_SCRIPT, demoClock } from "../src/demo";
import { demoAt, demoGithubAt, demoProfile } from "../src/demo-replay";
import { argText, describeTool, issueRefs, oneLine } from "../src/events";
import { drawFloor } from "../src/floor";
import {
	addSnapshot,
	allStatesFilter,
	burndownKey,
	exactCounts,
	fetchCounts,
	issueListArgv,
	parseBurndown,
	parseRepo,
	parseRepoHost,
	pollDelay,
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
import { type BullpenModel, buildModel } from "../src/model";
import { confirmedToolCloses } from "../src/model/detect";
import { createMotion, motionFor } from "../src/motion";
import { DEFAULT_PROFILE, parseProfile } from "../src/profile";
import { band } from "../src/render/header";
import { fit, glyphLines, type Line } from "../src/render/lines";
import { type Focus, paneView } from "../src/render/pane";
import { storyFor, storyLines } from "../src/render/story";
import { join } from "../src/vendor/pathe.js";
import type { BullpenEventKind, Member, Profile } from "../types";

const PANE = "bullpen";
const STORY = "bullpen-story";
const storyIssue = atom({ plugin: "bullpen", key: "storyIssue" } as const, 0);
async function openStory($: $, issue: number) {
	await update($, storyIssue, () => issue);
	return $.ui.open({ id: STORY, title: `Bullpen #${issue}` });
}
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
const demoStart = atom({ plugin: "bullpen", key: "demoStart" } as const, -1);
let demoTimers: Timer[] = [];
async function readScene($: $) {
	await read($, viewTime);
	const realNow = await now($);
	const start = await read($, demoStart);
	if (start >= 0) {
		const elapsed = realNow - start;
		const replay = demoAt(elapsed);
		return {
			...replay,
			github: demoGithubAt(elapsed),
			now: demoClock(elapsed),
			offset: demoClock(elapsed) - realNow,
		};
	}
	return {
		members: await read($, members),
		events: await read($, events),
		github: await read($, github),
		now: realNow,
		offset: 0,
	};
}
let animationTimer: Timer | undefined;
let lastBlit = -Infinity;
let scene:
	| {
			list: Member[];
			config: Profile;
			titles: Record<number, string>;
			morale: number;
			model: BullpenModel;
			offset: number;
			motion: ReturnType<typeof createMotion>;
	  }
	| undefined;
function startAnimation($: $) {
	if (animationTimer || !scene?.config.animations || !floorSize) return;
	animationTimer = $.clock.every(66, () => {
		void tickAnimation($).catch(() => {});
	});
}
async function tickAnimation($: $) {
	const at = await now($);
	if (at - lastBlit < 100) return;
	const current = scene,
		size = floorSize;
	if (!current || !size || !current.config.animations) {
		animationTimer?.cancel();
		animationTimer = undefined;
		return;
	}
	lastBlit = at;
	const sampledAt = at + current.offset;
	const { cells } = drawFloor(
		current.list,
		size.columns,
		size.rows,
		Math.floor(sampledAt / 250),
		current.titles,
		current.config,
		current.motion.sample(sampledAt),
		current.morale,
		{ model: current.model, now: sampledAt },
	);
	await $.ui.blit({ requestId: PANE, key: FLOOR_KEY, cells });
	if (
		!current.motion.active(sampledAt) &&
		!current.list.some((m) => m.status === "running")
	) {
		animationTimer?.cancel();
		animationTimer = undefined;
	}
}
let pollTimer: Timer | undefined;
let pollGeneration = 0;
let viewTimer: Timer | undefined;
const focus = atom({ plugin: "bullpen", key: "focus" } as const, "");
const viewTime = atom({ plugin: "bullpen", key: "viewTime" } as const, 0);
async function focusRegion($: $, region: Focus | "") {
	await update($, focus, (current) => (current === region ? "" : region));
	if (region === "talk") {
		const at = await now($);
		await update($, seenAt, () => at);
	}
}
const seenAt = atom({ plugin: "bullpen", key: "hallwaySeenAt" } as const, -1);

function renderLines(
	Text: ElementConstructor<TextProps>,
	lines: Line[],
	ui: {
		Box: ElementConstructor<BoxProps>;
		Button: ElementConstructor<ButtonProps>;
	},
	$: $,
) {
	const { Box, Button } = ui;
	return lines.map((line, index) => (
		<Box>
			{line.map((seg, j) => {
				const text = (
					<Text
						color={seg.fg === undefined ? undefined : hex(seg.fg)}
						backgroundColor={seg.bg === undefined ? undefined : hex(seg.bg)}
						bold={seg.bold}
						dimColor={seg.dim}
					>
						{seg.text}
					</Text>
				);
				if (seg.story !== undefined) {
					const issue = seg.story;
					return (
						<Button
							key={`story-${index}-${j}`}
							plain
							onPress={() => void openStory($, issue)}
						>
							{text}
						</Button>
					);
				}
				if (seg.agentId) {
					const agentId = seg.agentId;
					return (
						<Button
							key={`agent-${index}-${j}`}
							plain
							onPress={() => void $.ui.view({ agentId })}
						>
							{text}
						</Button>
					);
				}
				return text;
			})}
		</Box>
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
	const path = join(dir, chunkName(writer, index));
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
			await $.fs.write(join(dir, name), "");
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
		await $.fs.write(join(dir, name), text);
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
	extra: {
		target?: string;
		text?: string;
		attribute?: boolean;
		confirmedCloses?: number[];
	} = {},
) {
	collectorOf($).push({
		op: "event",
		at: await now($),
		kind,
		agentId,
		detail,
		target: extra.target,
		text: extra.text,
		confirmedCloses: extra.confirmedCloses,
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
	if ((await read($, demoStart)) >= 0) return;
	const prev = await read($, github);
	const at = await now($);
	const result = await $.process
		.run(issueListArgv(prev.filter))
		.then(readIssueList, runFailure);
	let { repo, host, burndown } = prev;
	if (result.status === "ok") {
		if (!repo || !host) {
			const resolved = await $.process.run(REPO_ARGV).catch(() => undefined);
			if (resolved?.exitCode === 0) {
				repo = parseRepo(resolved.stdout);
				host = parseRepoHost(resolved.stdout);
			}
		}
		if (repo && host)
			result.counts = await fetchCounts(
				(argv) => $.process.run(argv),
				repo,
				prev.filter,
				host,
			);
		const counts = exactCounts(result);
		if (repo && host && counts) {
			const key = burndownKey(repo, prev.filter, host);
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
		host,
		burndown,
		checkedAt: at,
	}));
	return result.status === "ok";
}

/** Demo is a read-only projection; live observers keep recording normally. */
async function playDemo($: $) {
	for (const timer of demoTimers) timer.cancel();
	demoTimers = [];
	const start = await now($);
	await update($, demoStart, () => start);
	await update($, seenAt, () => -1);
	let elapsed = 0;
	const times = new Set<number>();
	for (const step of DEMO_SCRIPT) {
		elapsed += step.wait;
		times.add(elapsed);
	}
	for (const at of times)
		demoTimers.push(
			$.clock.after(at, () => {
				void update($, viewTime, () => start + at).catch(() => {});
			}),
		);
}

/** Reads `.claude/bullpen.json` from the project; a bad file warns once and never blocks. */
async function loadProfile($: $) {
	let text: string | undefined;
	try {
		const path = join(await $.session.root(), ".claude", "bullpen.json");
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
	let failures = 0;
	const poll = async () => {
		const success = await pollGithub($, generation).catch(() => false);
		if ((await read($, demoStart)) < 0) failures = success ? 0 : failures + 1;
		if (generation === pollGeneration)
			pollTimer = $.clock.after(
				pollDelay(parsed.profile.issues.pollSeconds * 1000, failures),
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
	const at = (await readScene($)).now;
	await update($, seenAt, () => at);
	return $.ui.open({ id: PANE, title: "Bullpen", columns: 160, rows: 40 });
}

export function register(on: On) {
	on("ui.close", async (_$, e, next) => {
		if (e.id === PANE) {
			animationTimer?.cancel();
			animationTimer = undefined;
			floorSize = undefined;
			scene = undefined;
		}
		return next(e);
	});
	on("session.start", async ($, e, next) => {
		// A new session in the same process starts its own journal.
		team = undefined;
		journal = undefined;
		journalWarned = false;
		await update($, demoStart, () => -1);

		await loadProfile($);
		viewTimer?.cancel();
		viewTimer = $.clock.every(1000, () => {
			void now($)
				.then((at) => update($, viewTime, () => at))
				.catch(() => {});
		});

		await $.command.register({
			name: "bullpen",
			description: "Open the Bullpen: a live view of your agent team",
			argumentHint: "[demo|live|reload|story #N|focus floor|huddles|talk|all]",
		});

		$.clock.every(
			4000,
			() => void producers.track(reconcile($)).catch(() => {}),
		);

		return next(e);
	});

	// Write out what's still batched before the session goes.
	on("session.end", async (_$, e, next) => {
		for (const timer of demoTimers) timer.cancel();
		demoTimers = [];
		animationTimer?.cancel();
		animationTimer = undefined;
		scene = undefined;
		viewTimer?.cancel();
		pollTimer?.cancel();
		pollGeneration++;
		await producers.drain();
		await collector?.drain();
		await journalWriter?.drain();
		return next(e);
	});

	on("command.run", { command: "bullpen" }, async ($, e) => {
		if (e.args.trim() === "live") {
			for (const timer of demoTimers) timer.cancel();
			demoTimers = [];
			await update($, demoStart, () => -1);
			void pollGithub($).catch(() => {});
			return { text: "Bullpen: showing the live team." };
		}
		if (e.args.trim().startsWith("story")) {
			const match = /^story\s+#?([1-9]\d{0,6})$/.exec(e.args.trim());
			if (!match?.[1]) return { text: "Use /bullpen story #123" };
			const issue = Number(match[1]);
			await openStory($, issue);
			return { text: `Bullpen story #${issue} opened.` };
		}
		if (e.args.trim().startsWith("focus ")) {
			const region = e.args.trim().slice(6);
			if (
				region !== "floor" &&
				region !== "huddles" &&
				region !== "talk" &&
				region !== "all"
			)
				return { text: "Use /bullpen focus floor|huddles|talk|all" };
			await focusRegion($, region === "all" ? "" : region);
			await openPane($);
			return { text: `Bullpen focus: ${region}.` };
		}
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
		const result = await next(e);
		try {
			const closed =
				e.tool === "Bash"
					? confirmedToolCloses(String(args.command ?? ""), result)
					: [];
			if (closed.length)
				void producers
					.track(
						record($, "tool", e.agentId, `closed #${closed[0]}`, {
							target: "Bash",
							confirmedCloses: closed,
							attribute: false,
						}),
					)
					.catch(() => {});
		} catch {
			/* Observation must never change the tool's outcome. */
		}
		return result;
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
		const { Box, Text, Button } = $.ui.resolve(e);
		const snapshot = await readScene($);
		const list = Object.values(snapshot.members);
		const log = snapshot.events;
		const source = snapshot.github;
		const config =
			(await read($, demoStart)) >= 0
				? demoProfile(await read($, profile))
				: await read($, profile);
		const at = snapshot.now;
		const model = buildModel(log, at, {
			present: Object.fromEntries(list.map((m) => [m.name, m.status])),
		});
		const columns = Math.max(20, Math.min(512, e.props.bodyColumns ?? 60));

		await read($, viewTime);
		const focused = await read($, focus);
		const view = paneView(model, list, columns, e.props.scroll.bodyRows, at, {
			github: source,
			profile: config,
			focus: focused || undefined,
			raster: e.surface === "terminal",
			seenAt: await read($, seenAt),
		});
		const floorHeight = view.floorRows;
		const titles =
			source.result?.status === "ok"
				? Object.fromEntries(
						source.result.issues.map((i) => [i.number, i.title]),
					)
				: {};

		// Only the terminal draws a Raster; elsewhere the roster below stands alone.
		let floor: RenderChildren = null;
		floorSize = undefined;
		scene = undefined;
		if (e.surface === "terminal" && floorHeight > 0) {
			const { Raster } = $.ui.resolve(e);
			floorSize = { columns: view.floorColumns, rows: floorHeight };
			const motion = createMotion(
				motionFor(log, list, view.floorColumns, floorHeight, at, config),
			);
			scene = {
				list,
				config,
				titles,
				motion,
				morale: model.morale.score,
				model,
				offset: snapshot.offset,
			};
			const { cells } = drawFloor(
				list,
				view.floorColumns,
				floorHeight,
				config.animations ? Math.floor(at / 250) : 0,
				titles,
				config,
				motion.sample(at),
				model.morale.score,
				{ model, now: at },
			);
			if (
				config.animations &&
				(motion.active(at) || list.some((m) => m.status === "running"))
			)
				startAnimation($);
			floor = (
				<Raster
					key={FLOOR_KEY}
					columns={view.floorColumns}
					rows={floorHeight}
					cells={cells}
				/>
			);
		}

		return (
			<Box flexDirection="column">
				{renderLines(Text, view.header, { Box, Button }, $)}
				<Box flexDirection="row">
					{floor}
					{view.sidebar.length > 0 && (
						<Box flexDirection="column">
							{renderLines(
								Text,
								view.sidebar.map((line) => [
									{ text: " │ ", dim: true },
									...line,
								]),
								{ Box, Button },
								$,
							)}
						</Box>
					)}
				</Box>
				{renderLines(Text, view.regions, { Box, Button }, $)}
				{renderLines(Text, view.footer.slice(0, -1), { Box, Button }, $)}
				<Box>
					<Button
						key="floor-focus"
						plain
						hotkey="f"
						onPress={() => void focusRegion($, "floor")}
					>
						{config.style === "operations" ? "topology" : "floor"}{" "}
					</Button>
					<Button
						key="huddles-focus"
						plain
						hotkey="h"
						onPress={() => void focusRegion($, "huddles")}
					>
						{config.style === "operations" ? "workstreams" : "huddles"}{" "}
					</Button>
					<Button
						key="talk-focus"
						plain
						hotkey="t"
						onPress={() => void focusRegion($, "talk")}
					>
						{config.style === "operations" ? "events" : "talk"}{" "}
					</Button>
					<Button
						key="restore"
						plain
						hotkey="r"
						onPress={() => void focusRegion($, "")}
					>
						restore
					</Button>
				</Box>
			</Box>
		);
	});

	on("ui.render", { component: "Pane", requestId: STORY }, async ($, e) => {
		const { Box, Text, Button } = $.ui.resolve(e);
		const issue = await read($, storyIssue);
		const snapshot = await readScene($);
		const story = storyFor(issue, snapshot.events, snapshot.github);
		const config =
			(await read($, demoStart)) >= 0
				? demoProfile(await read($, profile))
				: await read($, profile);
		const columns = e.props.bodyColumns;
		const names = new Set(story.events.map((ev) => ev.who));
		const team = Object.values(snapshot.members).filter(
			(m) =>
				names.has(m.name) && m.id !== LEAD && !m.id.startsWith(DEMO_PREFIX),
		);
		const links: Line = team.map((m) => ({
			text: `${m.name} `,
			agentId: m.id,
		}));
		return (
			<Box flexDirection="column">
				{renderLines(
					Text,
					storyLines(
						story,
						config,
						columns,
						Math.max(0, e.props.scroll.bodyRows - 2),
					),
					{ Box, Button },
					$,
				)}
				{renderLines(
					Text,
					glyphLines([fit(links, columns)], config.glyphs),
					{ Box, Button },
					$,
				)}
				<Button
					key="story-back"
					hotkey="r"
					plain
					onPress={() => {
						void $.ui.close({ id: STORY });
						void openPane($);
					}}
				>
					Back to Bullpen
				</Button>
			</Box>
		);
	});

	on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
		const snapshot = await readScene($);
		const list = Object.values(snapshot.members).filter(
			(m) => m.id !== LEAD && m.status !== "gone",
		);
		if (e.props.hasSurvey || list.length === 0) return next(e);
		const { Box, Text, Button } = $.ui.resolve(e);
		const at = snapshot.now;
		const model = buildModel(snapshot.events, at);
		const line = band(
			model,
			snapshot.github,
			(await read($, demoStart)) >= 0
				? demoProfile(await read($, profile))
				: await read($, profile),
			e.props.bodyColumns,
			await read($, seenAt),
		);
		return (
			<Box>
				<Button key="open" plain onPress={() => void openPane($)}>
					{line[0]?.text}
				</Button>
				{line.slice(1).map((seg) => (
					<Text
						color={seg.fg === undefined ? undefined : hex(seg.fg)}
						backgroundColor={seg.bg === undefined ? undefined : hex(seg.bg)}
						bold={seg.bold}
						dimColor={seg.dim}
					>
						{seg.text}
					</Text>
				))}
			</Box>
		);
	});
}
