// Who owns an issue, from explicit sources before prose. A builder works in a
// worktree on a branch named `<issue>-<slug>` and opens a PR that says
// `Closes #n`; those are stronger evidence than any `#n` in a message.
import { shellSegments } from "./command";

/** Where an owner came from, strongest first. */
export type OwnSource = "worktree" | "pr" | "brief";

export type Own = { issue: number; by: OwnSource };

const RANK: Record<OwnSource, number> = { worktree: 0, pr: 1, brief: 2 };

const WORKTREE_DIR = /(?:^|[\\/])\.worktrees[\\/](\d{1,7})(?![\w.])/;
// `git worktree add … -b 156-slug`, `git checkout -b 156-slug`, `git switch -c 156-slug`:
// starting work on a branch. Reading a worktree (`cd`, `git -C`) claims nothing.
const NEW_BRANCH =
	/^\s*git\s+(?:-C\s+\S+\s+)?(?:worktree\s+add\b[^\n]*?\s-b|checkout\s+-b|switch\s+-c)\s+["']?((?:[\w.-]+\/)?(\d{1,7})-[\w-]*)/;
const PR_CREATE = /^\s*gh\s+pr\s+create\b/;
// The body argument, to the next flag: a title (`--title 'fix #3'`) is no claim.
const BODY_FLAG = /(?:^|\s)(?:--body|-b)(?:\s+|=)/;
const NEXT_FLAG =
	/\s--(?:title|base|head|label|assignee|draft|fill|reviewer|repo|milestone|project|web|template|body-file|recover|no-maintainer-edit)\b|\s-[tBHlard]\s/;
const CLOSES = /\b(?:closes|fixes|resolves)\s+#(\d{1,7})\b/i;

function str(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

/**
 * The raw text of the first `gh pr create` that starts a command, up to the
 * next top-level separator. Raw, since a heredoc body sits inside the quoted
 * `$(cat <<EOF …)` of `--body`; scoped, so an `echo --body '…'` beside it is
 * not its body.
 */
function createSegment(command: string): string | undefined {
	let quote = "";
	let escaped = false;
	let start = true;
	for (let i = 0; i < command.length; i++) {
		const ch = command.charAt(i);
		if (start && !/\s/.test(ch)) {
			if (!PR_CREATE.test(command.slice(i, i + 40))) start = false;
			else return command.slice(i, segmentEnd(command, i));
		}
		if (escaped) escaped = false;
		else if (ch === "\\" && quote !== "'") escaped = true;
		else if (quote) {
			if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === ";" || ch === "&" || ch === "|" || ch === "\n")
			start = true;
	}
	return undefined;
}

/** The index of the first unquoted separator at or after `from`, else the end. */
function segmentEnd(command: string, from: number): number {
	let quote = "";
	let escaped = false;
	for (let i = from; i < command.length; i++) {
		const ch = command.charAt(i);
		if (escaped) escaped = false;
		else if (ch === "\\" && quote !== "'") escaped = true;
		else if (quote) {
			if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === ";" || ch === "&" || ch === "|" || ch === "\n") return i;
	}
	return command.length;
}

/** The PR body's `Closes #n` in a `gh pr create` segment. */
function prCloses(segment: string): number | undefined {
	const flag = BODY_FLAG.exec(segment);
	if (!flag) return undefined;
	const rest = segment.slice(flag.index + flag[0].length);
	const end = NEXT_FLAG.exec(rest)?.index ?? rest.length;
	const n = CLOSES.exec(rest.slice(0, end))?.[1];
	return n ? Number(n) : undefined;
}

/**
 * The owner one tool call shows, if any. Only writes count: a file edit in a
 * worktree, a new `<n>-slug` branch, a PR whose body says `Closes #n`. A lead
 * or helper reading a worktree (`cd`, `git -C`, Read) takes nothing, and
 * quoted text (`echo 'git checkout -b 9-x'`) is no command.
 */
export function ownershipOf(
	tool: string,
	args: Record<string, unknown>,
): Own | undefined {
	if (tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
		const path = str(args, "file_path") || str(args, "notebook_path");
		const n = WORKTREE_DIR.exec(path)?.[1];
		return n ? { issue: Number(n), by: "worktree" } : undefined;
	}
	if (tool !== "Bash") return undefined;
	const command = str(args, "command");
	const segments = shellSegments(command);
	for (const segment of segments) {
		const m = NEW_BRANCH.exec(segment);
		const branch = m?.[1];
		// `checkout -b x origin/x` follows an existing remote branch to review it.
		if (m && branch && !segment.includes(`origin/${branch}`))
			return { issue: Number(m[2]), by: "worktree" };
	}
	const create = createSegment(command);
	const closes = create === undefined ? undefined : prCloses(create);
	if (closes !== undefined) return { issue: closes, by: "pr" };
	return undefined;
}

/**
 * The owner after `claim`: a claim from the same or a stronger source wins
 * (a builder moving to its next worktree), a weaker one is ignored.
 */
export function claimOwner(
	current: OwnSource | undefined,
	claim: Own,
): Own | undefined {
	return current === undefined || RANK[claim.by] <= RANK[current]
		? claim
		: undefined;
}
