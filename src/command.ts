// Pure helpers that turn a shell command into something a card can show.

const LEADING_CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/;
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=\S*\s+/;

/** The command without leading `cd <dir> &&` hops. */
export function withoutCd(command: string): string {
	let rest = command;
	for (let next = rest.replace(LEADING_CD, ""); next !== rest; ) {
		rest = next;
		next = rest.replace(LEADING_CD, "");
	}
	return rest.trim();
}

const HEREDOC = /(?<!<)<<(?!<)-?\s*(["']?)([A-Za-z_]\w*)\1/;

/**
 * The command without heredoc bodies: their lines are data (a commit message,
 * a script piped to a tool), not commands. Walks the lines once, so it always
 * ends.
 */
function withoutHeredocs(command: string): string {
	const kept: string[] = [];
	let end: string | undefined;
	for (const line of command.split("\n")) {
		if (end !== undefined) {
			if (line.trim() === end) end = undefined;
			continue;
		}
		kept.push(line);
		const m = HEREDOC.exec(line);
		// A `<<` after an unclosed quote is text, not a redirection.
		const quotes = m ? line.slice(0, m.index).match(/["']/g)?.length : 0;
		if (m?.[2] && !((quotes ?? 0) % 2)) end = m[2];
	}
	return kept.join("\n");
}

/** The chain's segments, minus env assignments and output plumbing. */
export function shellSegments(command: string): string[] {
	const parts: string[] = [];
	let part = "",
		quote = "",
		escaped = false;
	for (const ch of withoutHeredocs(withoutCd(command)).replace(/…$/, "")) {
		if (escaped) {
			part += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			part += ch;
			escaped = true;
			continue;
		}
		if (quote) {
			part += ch;
			if (ch === quote) quote = "";
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			part += ch;
			continue;
		}
		if (ch === ";" || ch === "&" || ch === "|" || ch === "\n") {
			if (part.trim()) parts.push(part);
			part = "";
		} else part += ch;
	}
	if (part.trim()) parts.push(part);
	return parts
		.map((part) => {
			let s = part;
			s = s.replace(/\s*\d?>+\s*(?:&\d|\S+)/g, "").trim();
			// Loop and subshell scaffolding: `do cmd`, `(cmd`, `x=$(cmd`.
			s = s.replace(/^(?:[\\({]\s*|(?:do|then|else)\s+|\w+=\$\(\s*)+/, "");
			let rest = `${s} `;
			while (ENV_ASSIGNMENT.test(rest)) rest = rest.replace(ENV_ASSIGNMENT, "");
			return rest.trim();
		})
		.filter((part) => part && !/^(?:while|until|if|done|fi)\b/.test(part));
}

/**
 * PR numbers a chain merges: every `gh pr merge N` segment, plus `gh pr merge
 * $p` inside a `for p in 92 94; do ...` loop.
 */
export function mergedPrs(command: string): number[] {
	const loops = new Map<string, number[]>();
	const merged: number[] = [];
	for (const part of shellSegments(command)) {
		const loop = /^for\s+(\w+)\s+in\s+([#\d\s]+)$/.exec(part);
		if (loop?.[1] && loop[2]) {
			loops.set(loop[1], loop[2].match(/\d+/g)?.map(Number) ?? []);
			continue;
		}
		const m = /^gh\s+pr\s+merge\s+(?:#?(\d+)|\$\{?(\w+)\}?)/.exec(part);
		if (m?.[1]) merged.push(Number(m[1]));
		else if (m?.[2]) merged.push(...(loops.get(m[2]) ?? []));
	}
	return merged;
}

const PHRASES: [RegExp, (m: RegExpExecArray) => string][] = [
	[
		/^npm (?:run )?(?:check|test)\b|^claude plugin test\b/,
		() => "running checks",
	],
	[/^npm run (?:typecheck|tsc)\b|^(?:npx )?tsc\b/, () => "typechecking"],
	[/^npm (?:ci|install|i)\b/, () => "installing deps"],
	[/^git commit\b/, () => "committing"],
	[/^git push\b/, () => "pushing"],
	[/^git rebase\b/, () => "rebasing"],
	[/^gh pr create\b/, () => "opening a PR"],
	[/^gh pr merge\s+#?(\d+)/, (m) => `merging PR #${m[1]}`],
	[
		/^gh pr (?:view|diff|checkout|review)\s+#?(\d+)/,
		(m) => `reviewing PR #${m[1]}`,
	],
	[/^gh pr comment\s+#?(\d+)/, (m) => `commenting on PR #${m[1]}`],
	[/^gh issue view\s+#?(\d+)/, (m) => `reading #${m[1]}`],
	[/^gh issue (?:create|comment|edit)\b/, () => "writing an issue"],
	[/^gh \w+/, () => "checking GitHub"],
	[/(?:preview\.ts|snap\.sh)\b/, () => "previewing the UI"],
	[/^git worktree\b/, () => "setting up a worktree"],
	[/^git (?:fetch|pull|merge|checkout|switch|branch)\b/, () => "syncing git"],
	[/^git (?:diff|log|show|status|blame)\b/, () => "reading git history"],
	[/^git (?:add|restore|reset|rm|mv)\b/, () => "staging changes"],
	[/^(?:rg|grep|ag|fd|find|ast-grep)\b/, () => "searching code"],
	[
		/^(?:cat|sed|head|tail|less|ls|tree|wc|jq|stat|file)\b/,
		() => "reading files",
	],
	[/^sleep\b/, () => "waiting"],
	[/^(?:uptime|ps|top|free|df|pgrep)\b/, () => "checking the machine"],
	[/^(?:node|python3?|bash|sh|tsx|npx)\b/, () => "running a script"],
	[/^(?:mkdir|cp|mv|rm|touch|chmod|ln)\b/, () => "organizing files"],
	[/^(?:curl|wget)\b/, () => "fetching a URL"],
];

/**
 * A verb phrase for a Bash command: `running checks`, `reading #46`. Undefined
 * when nothing recognizes it: raw shell text never reaches a card.
 */
export function commandPhrase(command: string): string | undefined {
	const parts = shellSegments(command);
	for (const [pattern, phrase] of PHRASES)
		for (const part of parts) {
			const m = pattern.exec(part);
			if (m) return phrase(m);
		}
	return undefined;
}
