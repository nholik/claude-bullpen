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

/** The chain's segments, minus env assignments and output plumbing. */
function segments(command: string): string[] {
	return withoutCd(command)
		.replace(/…$/, "")
		.split(/\s*(?:&&|;)\s*/)
		.map((part) => {
			let s = part.split(/\s*\|\s*/)[0] ?? "";
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
	for (const part of segments(command)) {
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
	const parts = segments(command);
	for (const [pattern, phrase] of PHRASES)
		for (const part of parts) {
			const m = pattern.exec(part);
			if (m) return phrase(m);
		}
	return undefined;
}
