// Who owns an issue, from explicit sources before prose. A builder works in a
// worktree on a branch named `<issue>-<slug>` and opens a PR that says
// `Closes #n`; those are stronger evidence than any `#n` in a message.

/** Where an owner came from, strongest first. */
export type OwnSource = "worktree" | "pr" | "brief";

export type Own = { issue: number; by: OwnSource };

const RANK: Record<OwnSource, number> = { worktree: 0, pr: 1, brief: 2 };

const WORKTREE_DIR = /(?:^|[\\/])\.worktrees[\\/](\d{1,7})(?![\w.])/;
// `git worktree add … -b 156-slug`, `git checkout -b 156-slug`, `git switch -c 156-slug`.
const NEW_BRANCH =
	/\bgit\s+(?:-C\s+\S+\s+)?(?:worktree\s+add\b[^\n;&|]*?\s-b|checkout\s+-b|switch\s+-c)\s+["']?(?:[\w.-]+\/)?(\d{1,7})-[\w-]/;
const CD_WORKTREE =
	/\b(?:cd|git\s+-C)\s+["']?(\S*\.worktrees[\\/]\d{1,7}(?![\w.]))/;
const PR_CREATE = /\bgh\s+pr\s+create\b/;
const CLOSES = /\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#(\d{1,7})\b/i;

function str(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

/**
 * The owner one tool call shows, if any. Only writes count for file tools: a
 * lead reading a worktree to review it doesn't take its issue.
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
	const dir = CD_WORKTREE.exec(command)?.[1];
	const fromDir = dir ? WORKTREE_DIR.exec(dir)?.[1] : undefined;
	const branch = NEW_BRANCH.exec(command)?.[1];
	const n = branch ?? fromDir;
	if (n) return { issue: Number(n), by: "worktree" };
	if (PR_CREATE.test(command)) {
		const closes = CLOSES.exec(command)?.[1];
		if (closes) return { issue: Number(closes), by: "pr" };
	}
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
