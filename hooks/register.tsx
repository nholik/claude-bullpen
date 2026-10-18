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
import { atom, derive, read, update } from "claude-code";
import {
	applyBatch,
	Batcher,
	type CollectOp,
	FLUSH_MS,
	InFlight,
	LEAD,
	type MemberPatch,
	toolOutcome,
} from "../src/collect";
import { hex } from "../src/color";
import {
	moveCursor,
	parseDecisions,
	quotedPrefix,
	waiting,
} from "../src/decisions";
import { DEMO_PREFIX, DEMO_SCRIPT, demoClock } from "../src/demo";
import { demoAt, demoGithubAt, demoProfile } from "../src/demo-replay";
import { describeTool, oneLine, toolText } from "../src/events";
import { drawFloor } from "../src/floor";
import {
	addSnapshot,
	allStatesFilter,
	burndownKey,
	createPollLoop,
	exactCounts,
	fetchCounts,
	issueListArgv,
	type PollLoop,
	parseBurndown,
	parseRepo,
	parseRepoHost,
	prArgv,
	REPO_ARGV,
	readIssueList,
	readPr,
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
	readChunks,
	STATE_EVENTS,
	toLine,
} from "../src/journal";
import { recheckDelay } from "../src/liveness";
import {
	type BullpenModel,
	buildModel,
	foldBatch,
	MODEL_VERSION,
	modelOf,
	stateFor,
} from "../src/model";
import { briefIssue, confirmedToolCloses } from "../src/model/detect";
import { createMotion, motionFor } from "../src/motion";
import { type Own, ownershipOf } from "../src/ownership";
import {
	DEFAULT_PROFILE,
	parseProfile,
	roleNames,
	withMemberColors,
} from "../src/profile";
import {
	createCardWidthTrackers,
	TWEEN_REDRAW_MS,
} from "../src/render/card-width";
import { band } from "../src/render/header";
import { fit, glyphLines, type Line, wrapText } from "../src/render/lines";
import { PULSE_MS as NEEDS_PULSE_MS } from "../src/render/needs";
import { type Focus, paneView } from "../src/render/pane";
import { storyFor, storyLines } from "../src/render/story";
import { replayAt } from "../src/replay";
import { atTail, type RowStart, reanchor, rowStarts } from "../src/scroll";
import { join } from "../src/vendor/pathe.js";
import type { BullpenEventKind, Member, Profile } from "../types";

const PANE = "bullpen";
const STORY = "bullpen-story";
const replay = atom({ plugin: "bullpen", key: "replay" } as const, null);
/** Ids of decisions the person dismissed or acted on; they leave the queue for the session. */
const decisionsHandled = atom(
	{ plugin: "bullpen", key: "decisionsHandled" } as const,
	[],
);
/** The needs-you view's selected row. */
const needsCursor = atom({ plugin: "bullpen", key: "needsCursor" } as const, 0);
const storyIssue = atom({ plugin: "bullpen", key: "storyIssue" } as const, 0);
async function openStory($: $, issue: number) {
	await update($, storyIssue, () => issue);
	return $.ui.open({ id: STORY, title: `Bullpen #${issue}` });
}
const FLOOR_KEY = "floor";
/** How often flushed events are appended to the journal file. */
const JOURNAL_FLUSH_MS = 1000;

const events = atom({ plugin: "bullpen", key: "events" } as const, []);
const teamModel = atom({ plugin: "bullpen", key: "teamModel" } as const, null);
const modelVersion = atom(
	{ plugin: "bullpen", key: "modelVersion" } as const,
	0,
);
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
	const recorded = await read($, replay);
	if (recorded) {
		const scene = replayAt(recorded.events, realNow - recorded.startedAt);
		return {
			...scene,
			github: {
				filter: "replay",
				workspace: "recorded session",
				burndown: [],
				checkedAt: 0,
			},
			offset: scene.now - realNow,
			readOnly: true,
		};
	}
	const start = await read($, demoStart);
	if (start >= 0) {
		const elapsed = realNow - start;
		const replay = demoAt(elapsed);
		return {
			...replay,
			github: demoGithubAt(elapsed),
			now: demoClock(elapsed),
			offset: demoClock(elapsed) - realNow,
			readOnly: true,
		};
	}
	return {
		members: await read($, members),
		events: await read($, events),
		github: await read($, github),
		now: realNow,
		offset: 0,
		readOnly: false,
		state: await currentModel($),
	};
}

/**
 * The reduced state for drawing. Drawing can't write `$.state`, so a state
 * left stale by a hot reload is rebuilt in memory, cached by the versions of
 * its three sources, until `syncModel` stores the rebuild from the collector.
 */
const currentState = derive(
	[teamModel, modelVersion, events],
	(state, stamped, list) => stateFor(state, stamped, list),
);

async function currentModel($: $) {
	return read($, currentState);
}

/**
 * Keeps the stored reduced state in step with the reducer and folds `added`
 * onto it: after a hot reload that changed model code (or `/bullpen reload`,
 * `force`) the state is rebuilt from the event window, so stale asks and ship
 * paths don't outlive their rules. Writes state, so it runs only inside the
 * collector's flush, where it can't race a batch.
 */
async function syncModel($: $, added: readonly BullpenEvent[], force: boolean) {
	const state = await read($, teamModel);
	const stamped = await read($, modelVersion);
	if (added.length === 0 && state && stamped === MODEL_VERSION && !force)
		return;
	const roles = roleNames(
		await read($, profile),
		Object.values(await read($, members)),
	);
	const out = foldBatch(state, stamped, await read($, events), added, force, {
		roles,
	});
	await update($, teamModel, () => out.state);
	await update($, modelVersion, () => out.version);
}

function sceneModel(
	snapshot: Awaited<ReturnType<typeof readScene>>,
	options: Parameters<typeof buildModel>[2] = {},
) {
	return "state" in snapshot && snapshot.state
		? modelOf(snapshot.state, snapshot.now, options)
		: buildModel(snapshot.events, snapshot.now, options);
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
let pulseTimer: Timer | undefined;
let pulseUntil = 0;
/** Redraw while the first decision's pulse runs (`remaining` ms left), then stop. */
function followPulse($: $, wallNow: number, remaining: number) {
	if (remaining > 0) pulseUntil = Math.max(pulseUntil, wallNow + remaining);
	if (wallNow >= pulseUntil) {
		pulseTimer?.cancel();
		pulseTimer = undefined;
		return;
	}
	if (pulseTimer) return;
	pulseTimer = $.clock.every(PULSE_REDRAW_MS, () => {
		void (async () => {
			const at = await now($);
			if (at >= pulseUntil) {
				pulseTimer?.cancel();
				pulseTimer = undefined;
			}
			await update($, viewTime, () => at);
		})().catch(() => {});
	});
}
/** Card widths persist between draws; a team-size change tweens them. */
const cardWidths = createCardWidthTrackers();
const PULSE_REDRAW_MS = 250;
let tweenTimer: Timer | undefined;
/** Redraw at 10 Hz while card widths settle, then stop the timer. */
function followCardTween($: $, wallNow: number) {
	if (!cardWidths.anyMoving(wallNow)) {
		tweenTimer?.cancel();
		tweenTimer = undefined;
		return;
	}
	if (tweenTimer) return;
	tweenTimer = $.clock.every(TWEEN_REDRAW_MS, () => {
		void (async () => {
			const at = await now($);
			if (!cardWidths.anyMoving(at)) {
				tweenTimer?.cancel();
				tweenTimer = undefined;
			}
			await update($, viewTime, () => at);
		})().catch(() => {});
	});
}
let pollLoop: PollLoop | undefined;
let pollGeneration = 0;
let prPollCursor = 0;
let viewTimer: Timer | undefined;
let reconcileTimer: Timer | undefined;
/** Last clock reading, when the view tick last fired, and liveness check pacing. */
let lastClockMs = 0;
let lastBeatAt = 0;
let lastTimerStartAt = 0;
let lastEnsureAt = 0;
let recheckTimer: Timer | undefined;
const ENSURE_MS = 2000;
const BEAT_GRACE_MS = 5000;
/** When state last gained events, and when viewTime last ticked. */
let lastActivityAt = 0;
let lastTickAt = 0;
const PULSE_MS = 5000;
const IDLE_TICK_MS = 15_000;
/** Each tick redraws the pane: every second only while a highlight is
 * fading, otherwise often enough for minute-step ages. */
async function tick($: $) {
	const at = await now($);
	lastClockMs = at;
	lastBeatAt = at;
	const recorded = await read($, replay);
	const playing =
		recorded &&
		at - recorded.startedAt <
			(recorded.events.at(-1)?.at ?? 0) - (recorded.events[0]?.at ?? 0);
	if (
		!playing &&
		at - lastActivityAt >= PULSE_MS &&
		at - lastTickAt < IDLE_TICK_MS
	)
		return;
	lastTickAt = at;
	await update($, viewTime, () => at);
}
const focus = atom({ plugin: "bullpen", key: "focus" } as const, "");
const viewTime = atom({ plugin: "bullpen", key: "viewTime" } as const, 0);
/** Pin the talk list to its newest message; the engine keeps up as it grows. */
function followTail($: $) {
	void $.ui.scroll({ in: PANE, to: "end" }).catch(() => {});
}
/** The decisions still waiting on the person, oldest first. */
async function waitingDecisions($: $) {
	const snapshot = await readScene($);
	return waiting(
		sceneModel(snapshot).decisions,
		await read($, decisionsHandled),
	);
}
async function moveNeeds($: $, by: number) {
	const length = (await waitingDecisions($)).length;
	await update($, needsCursor, (at) => moveCursor(at, by, length));
}
/** The selected decision, or none when the queue emptied under the cursor. */
async function selectedNeed($: $) {
	const queue = await waitingDecisions($);
	return queue[Math.min(await read($, needsCursor), queue.length - 1)];
}
/** `d`: take the selected decision off the queue for the session. */
async function dismissNeed($: $) {
	const item = await selectedNeed($);
	if (!item) return;
	await update($, decisionsHandled, (ids) => [...ids, item.id]);
	const length = (await waitingDecisions($)).length;
	await update($, needsCursor, (at) => moveCursor(at, 0, length));
	if (!length) await update($, focus, () => "");
}
/** Enter: quote the selected decision into the prompt, never submitting, and leave the pane. */
async function replyToNeed($: $) {
	const item = await selectedNeed($);
	if (!item) return;
	const draft = await $.prompt.read().catch(() => undefined);
	const gap = draft?.text && !draft.text.endsWith("\n") ? "\n" : "";
	const filled = await $.prompt.fill({
		text: gap + quotedPrefix(item),
		mode: "append",
	});
	if (!filled.isFilled) {
		$.ui.toast(
			`Bullpen could not fill the prompt${filled.refusal ? ` (${filled.refusal})` : ""}; nothing changed.`,
		);
		return;
	}
	await update($, decisionsHandled, (ids) => [...ids, item.id]);
	await update($, focus, () => "");
	await $.ui.close({ id: PANE });
}
async function focusRegion($: $, region: Focus | "") {
	if (region === "needs" && (await read($, focus)) !== "needs") {
		if (!(await waitingDecisions($)).length) {
			$.ui.toast("Nothing is waiting on you.");
			return;
		}
		await update($, needsCursor, () => 0);
	}
	await update($, focus, (current) => (current === region ? "" : region));
	if (region === "talk" && (await read($, focus)) === "talk") {
		const at = await now($);
		await update($, seenAt, () => at);
		followTail($);
	}
}
/** The talk list as last drawn: where each message starts, and the tree's height. */
let talkLayout: { starts: RowStart[]; rows: number } | undefined;
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
		<Box key={line[0]?.key}>
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
	await syncModel(
		$,
		added,
		ops.some((op) => op.op === "rebuild"),
	);
	if (added.length === 0) return;
	lastActivityAt = await now($);
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
	const dir = journalDir(home, writer);
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
		outcome?: "ok" | "error";
		agentType?: string;
		owns?: Own;
		context?: string;
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
		outcome: extra.outcome,
		agentType: extra.agentType,
		owns: extra.owns,
		context: extra.context,
		attribute: extra.attribute ?? true,
	});
}

async function reconcile($: $) {
	const listed = await $.agent.list();
	collectorOf($).push({ op: "reconcile", at: await now($), listed });
}

/** Polls `gh` for the issue list and adds a burndown point to `$.store`. */
async function pollGithub($: $, generation = pollGeneration) {
	if ((await read($, demoStart)) >= 0 || (await read($, replay))) return;
	const prev = await read($, github);
	const at = await now($);
	const result = await $.process
		.run(issueListArgv(prev.filter))
		.then(readIssueList, runFailure);
	let { repo, host, burndown, workspace, prs } = prev;
	if (!workspace)
		workspace = (await $.session.cwd().catch(() => ""))
			.split(/[\\/]/)
			.findLast(Boolean);
	// An enrichment failure (store, counts, PR lookups) must not hide the poll result.
	try {
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
			if (repo && host) {
				const repoName = repo,
					hostname = host;
				const tracked = [
					...new Set(
						sceneModel(await readScene($)).ship.flatMap((p) =>
							p.pr === undefined ? [] : [p.pr],
						),
					),
				];
				const batch = Array.from(
					{ length: Math.min(4, tracked.length) },
					(_, i) => tracked[(prPollCursor + i) % tracked.length],
				).filter((pr): pr is number => pr !== undefined);
				prPollCursor = tracked.length
					? (prPollCursor + batch.length) % tracked.length
					: 0;
				const updated = new Map((prs ?? []).map((p) => [p.number, p]));
				const results = await Promise.allSettled(
					batch.map((pr) =>
						$.process.run(prArgv(repoName, hostname, pr), { timeoutMs: 5000 }),
					),
				);
				for (const [i, result] of results.entries()) {
					const pr =
						result.status === "fulfilled"
							? readPr(result.value, at)
							: undefined;
					if (pr && pr.number === batch[i]) {
						updated.delete(pr.number);
						updated.set(pr.number, pr);
					}
				}
				prs = [...updated.values()].slice(-40);
			}
		}
	} catch (error) {
		$.ui.log(`bullpen: github poll follow-up failed (${error})`, {
			to: "debug",
		});
	}
	if (generation !== pollGeneration) return;
	await update($, github, (cur) => ({
		...cur,
		result,
		repo,
		host,
		workspace,
		burndown,
		checkedAt: at,
		prs,
	}));
	return result.status === "ok";
}

/** Demo is a read-only projection; live observers keep recording normally. */
async function playDemo($: $) {
	await update($, replay, () => null);
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
				// A scripted step is activity: keep highlights on the one-second pulse.
				void now($)
					.then((real) => {
						lastActivityAt = real;
						return update($, viewTime, () => start + at);
					})
					.catch(() => {});
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
	startPolling($, parsed.profile.issues.pollSeconds);
	if (parsed.warnings.length > 0)
		$.ui.toast(`bullpen.json: ${parsed.warnings.join("; ")}`, {
			timeoutMs: 10000,
		});
}

/** (Re)starts the GitHub poll loop; a previous loop is cancelled first. */
function startPolling($: $, pollSeconds: number) {
	pollLoop?.cancel();
	const generation = ++pollGeneration;
	const loop = createPollLoop({
		baseMs: pollSeconds * 1000,
		poll: async () => {
			const success = await pollGithub($, generation).catch(() => false);
			return (await read($, demoStart)) < 0 ? success : undefined;
		},
		current: () => generation === pollGeneration,
		now: () => lastClockMs,
		after: (ms, fn) => $.clock.after(ms, fn),
	});
	pollLoop = loop;
	loop.start();
}

/** Starts the 1 s view tick and 4 s reconcile; each is cancelled first, so never doubled. */
function startTimers($: $) {
	viewTimer?.cancel();
	viewTimer = $.clock.every(1000, () => {
		void tick($).catch(() => {});
	});
	reconcileTimer?.cancel();
	reconcileTimer = $.clock.every(
		4000,
		() => void producers.track(reconcile($)).catch(() => {}),
	);
	lastTimerStartAt = lastClockMs;
}

/**
 * A hot reload cancels pending clock waits, and `session.start` only re-fires
 * for changed modules, so the timers can die while the pane stays open. Called
 * from render and from observers: restarts whatever has stopped beating.
 */
async function ensureLive($: $, rearm = true) {
	const at = await now($);
	lastClockMs = at;
	if (at - lastEnsureAt < ENSURE_MS) return;
	lastEnsureAt = at;
	const viewDead =
		!viewTimer || at - Math.max(lastBeatAt, lastTimerStartAt) > BEAT_GRACE_MS;
	if (viewDead) startTimers($);
	else if (rearm) {
		// Beating inside the grace may be a cancelled timer that has not yet
		// aged out: look once more just past it. One pending recheck at most, and
		// the recheck itself never arms another (ticks beat every second).
		const delay = recheckDelay(at, lastBeatAt, lastTimerStartAt, BEAT_GRACE_MS);
		// A reload may have killed the pending wait without clearing the handle,
		// so never trust it: cancel (harmless on a dead handle) and replace.
		if (delay !== undefined) {
			recheckTimer?.cancel();
			recheckTimer = $.clock.after(delay, () => {
				recheckTimer = undefined;
				lastEnsureAt = 0;
				void ensureLive($, false).catch(() => {});
			});
		}
	}
	if (!pollLoop || pollLoop.stalled(at))
		startPolling($, (await read($, profile)).issues.pollSeconds);
}

async function openPane($: $) {
	const at = (await readScene($)).now;
	await update($, seenAt, () => at);
	const opened = await $.ui.open({
		id: PANE,
		title: "Bullpen",
		columns: 160,
		rows: 40,
	});
	if ((await read($, focus)) === "talk") followTail($);
	return opened;
}

export function register(on: On) {
	on("ui.close", async (_$, e, next) => {
		if (e.id === PANE) {
			animationTimer?.cancel();
			animationTimer = undefined;
			floorSize = undefined;
			scene = undefined;
			tweenTimer?.cancel();
			tweenTimer = undefined;
			cardWidths.clear();
		}
		return next(e);
	});
	on("session.start", async ($, e, next) => {
		// A new session in the same process starts its own journal.
		journal = undefined;
		journalWarned = false;
		await update($, demoStart, () => -1);
		await update($, replay, () => null);

		await loadProfile($);
		lastClockMs = await now($);
		startTimers($);

		await $.command.register({
			name: "bullpen",
			description: "Open the Bullpen: a live view of your agent team",
			argumentHint:
				"[demo|live|replay PATH|needs|reload|story #N|focus shipping|talk|all]",
		});

		return next(e);
	});

	// Write out what's still batched before the session goes.
	on("session.end", async (_$, e, next) => {
		for (const timer of demoTimers) timer.cancel();
		demoTimers = [];
		animationTimer?.cancel();
		animationTimer = undefined;
		scene = undefined;
		tweenTimer?.cancel();
		tweenTimer = undefined;
		cardWidths.clear();
		viewTimer?.cancel();
		viewTimer = undefined;
		recheckTimer?.cancel();
		recheckTimer = undefined;
		reconcileTimer?.cancel();
		reconcileTimer = undefined;
		pollLoop?.cancel();
		pollLoop = undefined;
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
			await update($, replay, () => null);
			void pollGithub($)
				.then((ok) => ok && pollLoop?.recover())
				.catch(() => {});
			return { text: "Bullpen: showing the live team." };
		}
		if (e.args.trim() === "answer" || e.args.trim() === "needs") {
			await focusRegion($, "needs");
			await openPane($);
			return { text: "Bullpen: opening what needs you." };
		}
		if (e.args.trim().startsWith("replay")) {
			const path = e.args
				.trim()
				.slice(6)
				.trim()
				.replace(/^(["'])(.*)\1$/, "$2");
			if (!path)
				return { text: "Use /bullpen replay PATH (a journal directory)." };
			try {
				const home =
					(await $.env.get("HOME")) ?? (await $.env.get("USERPROFILE"));
				const dir =
					path.startsWith("~/") && home ? join(home, path.slice(2)) : path;
				const files = (await $.fs.list(dir)).filter((f) =>
					/^events-.*\.jsonl$/.test(f.name),
				);
				const parsed = readChunks(
					await Promise.all(files.map((f) => $.fs.read(join(dir, f.name)))),
				);
				if (!parsed.events.length)
					return {
						text: "Bullpen: no readable journal events in that directory.",
					};
				for (const timer of demoTimers) timer.cancel();
				demoTimers = [];
				await update($, demoStart, () => -1);
				await update($, replay, () => ({
					events: parsed.events,
					startedAt: 0,
					path: dir,
				}));
				const start = await now($);
				await update($, replay, (r) => (r ? { ...r, startedAt: start } : r));
				await openPane($);
				return {
					text: `Bullpen: replaying ${parsed.events.length} recorded events${parsed.skipped ? ` (${parsed.skipped} unreadable lines skipped)` : ""}. /bullpen live returns to your team.`,
				};
			} catch (error) {
				return { text: `Bullpen: can't read that journal (${String(error)}).` };
			}
		}
		if (e.args.trim().startsWith("story")) {
			const match = /^story\s+#?([1-9]\d{0,6})$/.exec(e.args.trim());
			if (!match?.[1]) return { text: "Use /bullpen story #123" };
			const issue = Number(match[1]);
			await openStory($, issue);
			return { text: `Bullpen story #${issue} opened.` };
		}
		if (e.args.trim().startsWith("focus ")) {
			const requested = e.args.trim().slice(6);
			const region =
				requested === "huddles"
					? "shipping"
					: requested === "floor"
						? "all"
						: requested;
			if (region !== "shipping" && region !== "talk" && region !== "all")
				return { text: "Use /bullpen focus shipping|talk|all" };
			await focusRegion($, region === "all" ? "" : region);
			await openPane($);
			return { text: `Bullpen focus: ${region}.` };
		}
		if (e.args.trim() === "reload") {
			await loadProfile($);
			collectorOf($).push({ op: "rebuild" });
			return {
				text: "Bullpen: reloaded .claude/bullpen.json and rebuilt the team state.",
			};
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
					const { agentId } = spawned;
					if (!agentId) return;
					const brief = `${e.description} ${e.prompt}`;
					const assigned = briefIssue(brief);
					await touch($, agentId, {
						name: e.name ?? e.description,
						status: "running",
						issue: assigned,
						agentType: e.subagentType,
					});
					await record(
						$,
						"spawn",
						e.parentAgentId,
						`${e.isTeammate ? "teammate" : "subagent"} ${e.name ?? e.description} joined`,
						{
							target: e.name,
							text: assigned === undefined ? "" : `#${assigned}`,
							attribute: false,
							agentType: e.subagentType,
						},
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
					// The lead's `Decision:` lines are what the person is asked.
					if (e.agentId === undefined)
						for (const found of parseDecisions(e.answer))
							await record($, "decision", undefined, found.text, {
								text: found.text,
								context: found.context,
								attribute: false,
							});
				}),
			)
			.catch(() => {});
		return result;
	});

	// The person's own prompt answers whatever the lead asked before it.
	on("prompt.submit", async ($, e, next) => {
		if (
			(e.origin.kind === "composer" || e.origin.kind === "bridge") &&
			!e.command &&
			!e.isMeta &&
			e.text.trim()
		)
			void producers
				.track(
					(async () => {
						if ((await waitingDecisions($)).length)
							await record($, "reply", undefined, "replied", {
								attribute: false,
							});
					})(),
				)
				.catch(() => {});
		return next(e);
	});

	on("tool.call", async ($, e, next) => {
		void ensureLive($).catch(() => {});
		const args = e as unknown as Record<string, unknown>;
		// Observe only, and never hold up the call while recording it.
		void producers
			.track(
				record($, "tool", e.agentId, describeTool(String(e.tool), args), {
					target: String(e.tool),
					text: toolText(args),
				}),
			)
			.catch(() => {});
		const result = await next(e);
		try {
			const outcome = e.tool === "Bash" ? toolOutcome(result) : undefined;
			if (outcome)
				void producers
					.track(
						record($, "tool", e.agentId, describeTool(String(e.tool), args), {
							target: String(e.tool),
							text: toolText(args),
							outcome,
						}),
					)
					.catch(() => {});
			// An owner is claimed only once the call went through: a denied or
			// failed call changed nothing.
			const owns = ownershipOf(String(e.tool), args);
			const failed =
				!!result &&
				typeof result === "object" &&
				(("deny" in result && result.deny !== undefined) ||
					("isError" in result && result.isError === true));
			if (owns && !failed)
				void producers
					.track(
						record($, "tool", e.agentId, `owns #${owns.issue}`, {
							target: String(e.tool),
							text: "",
							owns,
							attribute: false,
						}),
					)
					.catch(() => {});
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
							text: closed.map((n) => `#${n}`).join(" "),
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
		const result = next(e);
		// Human replies are recorded once, with their exact ask, after delivery.
		if (e.origin.kind === "plugin" && e.origin.name === "bullpen")
			return result;
		void producers
			.track(
				result.then((sent) =>
					sent.isDelivered
						? record($, "message", e.agentId, oneLine(e.text, 2000), {
								target: e.to,
								text: e.text,
							})
						: undefined,
				),
			)
			.catch(() => {});
		return result;
	});

	// The person's scroll in the talk list: back at the bottom, follow new messages again.
	on(
		"ui.scroll",
		{ component: "Pane", requestId: PANE },
		async ($, e, next) => {
			const result = await next(e);
			try {
				if (
					e.origin.kind === "person" &&
					(await read($, focus)) === "talk" &&
					atTail(e.offset, e.bodyRows, e.contentRows)
				)
					followTail($);
			} catch {}
			return result;
		},
	);
	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		void ensureLive($).catch(() => {});
		const ui = $.ui.resolve(e);
		const { Box, Text, Button } = ui;
		const snapshot = await readScene($);
		const list = Object.values(snapshot.members);
		const log = snapshot.events;
		const source = snapshot.github;
		const config =
			(await read($, demoStart)) >= 0
				? demoProfile(await read($, profile))
				: withMemberColors(await read($, profile), list);
		const at = snapshot.now;
		const model = sceneModel(snapshot, {
			github: source,
			roles: roleNames(config, list),
			present: Object.fromEntries(list.map((m) => [m.name, m.status])),
			agentTypes: Object.fromEntries(
				list.flatMap((m) => (m.agentType ? [[m.name, m.agentType]] : [])),
			),
		});
		const columns = Math.max(20, Math.min(512, e.props.bodyColumns ?? 60));

		await read($, viewTime);
		const focused = await read($, focus);
		const wallNow = await now($);
		if (focused === "needs" && e.surface === "mobile")
			return (
				<Text>
					Answer this decision in the terminal or desktop Bullpen pane.
				</Text>
			);
		// Decisions the person dismissed or acted on are off every view.
		const queue = waiting(model.decisions, await read($, decisionsHandled));
		model.decisions = queue;
		const first = queue[0];
		if (first && config.animations)
			followPulse($, wallNow, NEEDS_PULSE_MS - (at - first.at));
		const view = paneView(model, list, columns, e.props.scroll.bodyRows, at, {
			cursor: await read($, needsCursor),
			mode: (await read($, replay))
				? "replay"
				: snapshot.readOnly
					? "demo"
					: "live",
			github: source,
			profile: config,
			focus: focused || undefined,
			raster: e.surface === "terminal",
			seenAt: await read($, seenAt),
			cardWidths: cardWidths.for(e.surface),
			wallNow,
		});
		followCardTween($, wallNow);
		if (focused === "talk") {
			// Once the hallway is full each arrival drops its oldest message from
			// the top; a window scrolled up keeps its row, so put it back on its message.
			const starts = rowStarts(view.regions, view.header.length);
			const key = talkLayout
				? reanchor(
						talkLayout.starts,
						starts,
						e.props.scroll.offset,
						e.props.scroll.bodyRows,
						talkLayout.rows,
					)
				: undefined;
			talkLayout = {
				starts,
				rows: view.header.length + view.regions.length + view.footer.length,
			};
			if (key)
				void $.ui
					.scroll({ in: PANE, to: { key }, block: "start" })
					.catch(() => {});
		} else talkLayout = undefined;
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
					{focused === "needs" && (
						<Button
							key="need-reply"
							plain
							autoFocus
							onPress={() => void replyToNeed($)}
						>
							reply (enter)
						</Button>
					)}
					{focused === "needs" && <Text dimColor> · </Text>}
					{focused === "needs" && (
						<Button
							key="need-next"
							plain
							hotkey="j"
							onPress={() => void moveNeeds($, 1)}
						>
							next
						</Button>
					)}
					{focused === "needs" && <Text dimColor> · </Text>}
					{focused === "needs" && (
						<Button
							key="need-prev"
							plain
							hotkey="k"
							onPress={() => void moveNeeds($, -1)}
						>
							prev
						</Button>
					)}
					{focused === "needs" && <Text dimColor> · </Text>}
					{focused === "needs" && (
						<Button
							key="need-dismiss"
							plain
							hotkey="d"
							onPress={() => void dismissNeed($)}
						>
							dismiss
						</Button>
					)}
					{focused === "needs" && <Text dimColor> · </Text>}
					{(queue.length > 0 || focused === "needs") && (
						<Button
							key="needs-focus"
							plain
							hotkey="n"
							onPress={() => void focusRegion($, "needs")}
						>
							{focused === "needs" ? "back" : `needs you (${queue.length})`}
						</Button>
					)}
					{queue.length > 0 && focused !== "needs" && <Text dimColor> · </Text>}
					{focused !== "needs" && (
						<Button
							key="shipping-focus"
							plain
							hotkey="s"
							onPress={() => void focusRegion($, "shipping")}
						>
							{focused === "shipping" ? "back" : "shipping"}
						</Button>
					)}
					{focused !== "needs" && <Text dimColor> · </Text>}
					{focused !== "needs" && (
						<Button
							key="talk-focus"
							plain
							hotkey="t"
							onPress={() => void focusRegion($, "talk")}
						>
							{focused === "talk" ? "back" : "messages"}
						</Button>
					)}
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
				: withMemberColors(
						await read($, profile),
						Object.values(snapshot.members),
					);
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
		const config =
			(await read($, demoStart)) >= 0
				? demoProfile(await read($, profile))
				: withMemberColors(
						await read($, profile),
						Object.values(snapshot.members),
					);
		const model = sceneModel(snapshot, {
			github: snapshot.github,
			roles: roleNames(config, list),
			present: Object.fromEntries(
				Object.values(snapshot.members).map((m) => [m.name, m.status]),
			),
		});
		const line = band(
			model,
			snapshot.github,
			config,
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
