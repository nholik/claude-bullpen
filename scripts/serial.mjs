// Runs a command while holding a machine-wide lock, so parallel worktrees
// queue their checks instead of running them at once: each `claude plugin
// test` starts a child per test file, and several checks together can
// overheat a laptop.
//
//   node scripts/serial.mjs npm run check:all

import { spawn } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lock = join(tmpdir(), "bullpen-check.lock");
const owner = join(lock, "pid");
const command = process.argv.slice(2);
if (command.length === 0) {
	console.error("Usage: node scripts/serial.mjs <command...>");
	process.exit(2);
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/** A lock with no pid this long after it was made lost its owner mid-take. */
const ORPHAN_MS = 10_000;

function stale(pid) {
	if (pid) return !alive(pid);
	try {
		return Date.now() - statSync(lock).mtimeMs > ORPHAN_MS;
	} catch {
		return false;
	}
}

/** Clears a stale lock. Renaming first means only one waiter can win. */
function clear() {
	const aside = `${lock}.${process.pid}`;
	try {
		renameSync(lock, aside);
	} catch {
		return;
	}
	rmSync(aside, { recursive: true, force: true });
}

function holder() {
	try {
		return Number(readFileSync(owner, "utf8"));
	} catch {
		return 0;
	}
}

let waited = false;
for (;;) {
	try {
		mkdirSync(lock);
		writeFileSync(owner, String(process.pid));
		break;
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		const pid = holder();
		// A holder that died leaves a stale lock. A lock with no pid yet is
		// being taken right now, unless it has stayed that way too long.
		if (stale(pid)) {
			clear();
			continue;
		}
		if (!waited) {
			console.error(`Waiting for another check to finish (pid ${pid || "?"})…`);
			waited = true;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
}

const release = () => {
	if (holder() === process.pid) rmSync(lock, { recursive: true, force: true });
};
const child = spawn(command.join(" "), { shell: true, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
	release();
	process.exit(code ?? (signal ? 1 : 0));
});
