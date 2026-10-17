import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { Line } from "../src/render/lines";

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

const { demoAt } = await import("../src/demo-replay");
const { buildModel } = await import("../src/model");
const { drawFloor } = await import("../src/floor");
const { paneView } = await import("../src/render/pane");

const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
	const key = args[i];
	const value = args[i + 1];
	if (
		!key ||
		!["--cols", "--rows", "--at", "--frames", "--out"].includes(key) ||
		value === undefined
	)
		throw new Error(
			"Usage: preview.ts [--cols 160] [--rows 48] [--at 12] [--frames 1] [--out .scratch/preview/demo.ansi]",
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
const columns = number("--cols", 160, 20, 512);
const rows = number("--rows", 48, 8, 200);
const at = number("--at", 12, 0, 86400) * 1000;
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
for (let frame = 0; frame < frames; frame++) {
	const now = at + frame * 100;
	const replay = demoAt(now);
	const members = Object.values(replay.members);
	const model = buildModel(replay.events, now);
	const view = paneView(model, members, columns, rows, now);
	const output = view.header.map(line);
	if (view.floorRows > 0) {
		const floor = drawFloor(
			members,
			columns,
			view.floorRows,
			Math.floor(now / 250),
		);
		const bytes = Buffer.from(floor.cells, "base64");
		for (let y = 0; y < view.floorRows; y++) {
			let row = "";
			for (let x = 0; x < columns; x++) {
				const offset = (y * columns + x) * 12;
				row +=
					color(bytes.readUInt32LE(offset + 4)) +
					color(bytes.readUInt32LE(offset + 8), true) +
					String.fromCodePoint(bytes.readUInt32LE(offset));
			}
			output.push(`${row}\x1b[0m`);
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
}
