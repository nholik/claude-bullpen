import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { Worker } from "node:worker_threads";
import type { Line } from "../src/render/lines";
import type { BullpenEvent, GithubSource, Member } from "../types";

// The engine resolves extensionless relative imports. Match it for Node tools.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith(".") && context.parentURL) {
			const url = new URL(specifier, context.parentURL);
			for (const suffix of [".ts", "/index.ts"]) {
				if (existsSync(fileURLToPath(url) + suffix))
					return { url: url.href + suffix, shortCircuit: true };
			}
		}
		return nextResolve(specifier, context);
	},
});

const { demoAt, demoGithubAt, demoProfile } = await import(
	"../src/demo-replay"
);
const { demoClock } = await import("../src/demo");
const { DEFAULT_PROFILE } = await import("../src/profile");
const { motionFor, createMotion } = await import("../src/motion");
const { buildModel } = await import("../src/model");
const { drawFloor } = await import("../src/floor");
const { storyFor, storyLines } = await import("../src/render/story");
const { paneView } = await import("../src/render/pane");
const { readJournal, STATE_EVENTS } = await import("../src/journal");
const { replayAt } = await import("../src/replay");
const { createCardWidthTracker } = await import("../src/render/card-width");

// A render hang must not pin a CPU: a worker thread watches the frame start
// time and kills the process if one frame runs past the limit.
const FRAME_LIMIT_MS = 2000;
const frameClock = new Int32Array(new SharedArrayBuffer(4));
new Worker(
	`const { workerData: c } = require("node:worker_threads");
	setInterval(() => {
		const t = Atomics.load(c, 0);
		if (t !== 0 && (Date.now() & 0x7fffffff) - t > ${FRAME_LIMIT_MS}) {
			require("node:fs").writeSync(2, "preview.ts: a frame took longer than ${FRAME_LIMIT_MS / 1000}s; aborting\\n");
			process.kill(${process.pid}, "SIGKILL");
		}
	}, 100);`,
	{ eval: true, workerData: frameClock },
).unref();

const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
	const key = args[i];
	const value = args[i + 1];
	if (
		!key ||
		![
			"--cols",
			"--focus",
			"--rows",
			"--at",
			"--frames",
			"--out",
			"--story",
			"--glyphs",
			"--animations",
			"--journal",
		].includes(key) ||
		value === undefined
	)
		throw new Error(
			"Usage: preview.ts [--cols 160] [--rows 48] [--at 12] [--frames 1] [--out .scratch/preview/demo.ansi] [--journal <dir>]",
		);
	options.set(key, value);
}
function number(
	key: string,
	fallback: number,
	min: number,
	max: number,
): number {
	const value = Number(options.get(key) ?? fallback);
	if (
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(key !== "--at" && !Number.isInteger(value))
	)
		throw new Error(`Invalid ${key}: expected ${min}..${max}`);
	return value;
}
const glyphs = options.get("--glyphs") ?? "unicode";
const animations = options.get("--animations") ?? "on";
if (glyphs !== "unicode" && glyphs !== "ascii")
	throw new Error("Invalid --glyphs: unicode or ascii");
if (animations !== "on" && animations !== "off")
	throw new Error("Invalid --animations: on or off");
const profile = demoProfile({
	...DEFAULT_PROFILE,
	glyphs,
	animations: animations === "on",
});
const columns = number("--cols", 160, 20, 512);
const rows = number("--rows", 48, 8, 200);
const focus = options.get("--focus");
const journalDir = options.get("--journal");
const at = number("--at", journalDir ? 2 : 12, 0, 86400) * 1000;
const frames = number("--frames", 1, 1, 1000);
const color = (n: number, background = false) =>
	`\x1b[${background ? 48 : 38};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
const line = (segments: Line) =>
	`${segments
		.map(
			(s) =>
				`\x1b[0m${s.fg === undefined ? "" : color(s.fg)}${s.bg === undefined ? "" : color(s.bg, true)}${s.bold ? "\x1b[1m" : ""}${s.dim ? "\x1b[2m" : ""}${s.text}`,
		)
		.join("")}\x1b[0m`;

type Replay = { events: BullpenEvent[]; members: Member[] };
type Frame = { now: number; replay: Replay; source: GithubSource };

/** The newest events of a real team journal directory, with members derived. */
function readTeam(dir: string): Replay {
	const events: BullpenEvent[] = [];
	for (const name of readdirSync(dir).sort())
		if (/^events-.*\.jsonl$/.test(name))
			events.push(
				...readJournal(readFileSync(resolve(dir, name), "utf8")).events,
			);
	if (!events.length) throw new Error(`No events in ${dir}`);
	events.sort((a, b) => a.at - b.at);
	const kept = events.slice(-STATE_EVENTS);
	const last = kept.at(-1)?.at ?? 0;
	const members = Object.values(
		replayAt(kept, last - (kept[0]?.at ?? last)).members,
	);
	return { events: kept, members };
}
const team = journalDir ? readTeam(resolve(journalDir)) : undefined;

function frameAt(elapsed: number): Frame {
	if (team) {
		const now = (team.events.at(-1)?.at ?? 0) + elapsed;
		return {
			now,
			replay: team,
			source: {
				workspace: "recorded session",
				filter: "",
				burndown: [],
				checkedAt: now,
			},
		};
	}
	const replay = demoAt(elapsed);
	return {
		now: demoClock(elapsed),
		replay: { events: replay.events, members: Object.values(replay.members) },
		source: demoGithubAt(elapsed),
	};
}

const cardWidths = createCardWidthTracker();
for (let frame = 0; frame < frames; frame++) {
	Atomics.store(frameClock, 0, Date.now() & 0x7fffffff);
	const { now, replay, source } = frameAt(at + frame * 100);
	const members = replay.members;
	const model = buildModel(replay.events, now, {
		present: Object.fromEntries(members.map((m) => [m.name, m.status])),
		github: source,
	});
	const view = paneView(model, members, columns, rows, now, {
		github: source,
		profile: profile,
		mode: team ? "replay" : "demo",
		cardWidths,
		focus:
			focus === "shipping" || focus === "talk" || focus === "answer"
				? focus
				: undefined,
	});
	if (options.has("--story")) {
		const issue = number("--story", 204, 1, 9999999);
		view.header = storyLines(
			storyFor(issue, replay.events, source),
			profile,
			columns,
			rows - 2,
		);
		view.floorRows = 0;
		view.sidebar = [];
		view.regions = [];
		view.footer = [[{ text: "r Back to Bullpen" }]];
	}
	const output = view.header.map(line);
	if (view.floorRows > 0) {
		const floor = drawFloor(
			members,
			view.floorColumns,
			view.floorRows,
			profile.animations ? Math.floor(now / 250) : 0,
			Object.fromEntries(
				(source.result?.status === "ok" ? source.result.issues : []).map(
					(i) => [i.number, i.title],
				),
			),
			profile,
			createMotion(
				motionFor(
					replay.events,
					members,
					view.floorColumns,
					view.floorRows,
					now,
					profile,
				),
			).sample(now),
			model.morale.score,
			{ model, now },
		);
		const bytes = Buffer.from(floor.cells, "base64");
		for (let y = 0; y < view.floorRows; y++) {
			let row = "";
			for (let x = 0; x < view.floorColumns; x++) {
				const offset = (y * view.floorColumns + x) * 12;
				row +=
					color(bytes.readUInt32LE(offset + 4)) +
					color(bytes.readUInt32LE(offset + 8), true) +
					String.fromCodePoint(bytes.readUInt32LE(offset));
			}
			output.push(
				`${row}\x1b[0m${view.sidebar.length ? line([{ text: " │ ", dim: true }, ...(view.sidebar[y] ?? [])]) : ""}`,
			);
		}
	}
	output.push(...view.regions.map(line));
	while (output.length < rows - view.footer.length - 1)
		output.push(" ".repeat(columns));
	output.push(...view.footer.map(line), line(view.band));
	const ansi = `${output.join("\n")}\n`;
	const target = options.get("--out");
	if (target) {
		const path = resolve(
			frames === 1
				? target
				: `${target.replace(/\.ansi$/, "")}-${String(frame).padStart(4, "0")}.ansi`,
		);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, ansi);
	} else process.stdout.write(ansi);
	Atomics.store(frameClock, 0, 0);
}
