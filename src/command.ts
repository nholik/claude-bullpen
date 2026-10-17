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
			let rest = `${s} `;
			while (ENV_ASSIGNMENT.test(rest)) rest = rest.replace(ENV_ASSIGNMENT, "");
			return rest.trim();
		})
		.filter(Boolean);
}

const PHRASES: [RegExp, (m: RegExpExecArray) => string][] = [
	[/^npm (?:run )?(?:check|test)\b/, () => "running checks"],
	[/^npm run (?:typecheck|tsc)\b|^(?:npx )?tsc\b/, () => "typechecking"],
	[/^npm (?:ci|install|i)\b/, () => "installing deps"],
	[/^git commit\b/, () => "committing"],
	[/^git push\b/, () => "pushing"],
	[/^git rebase\b/, () => "rebasing"],
	[/^gh pr create\b/, () => "opening a PR"],
	[
		/^gh pr (?:view|diff|checkout|review)\s+#?(\d+)/,
		(m) => `reviewing PR #${m[1]}`,
	],
	[/^gh pr comment\s+#?(\d+)/, (m) => `commenting on PR #${m[1]}`],
	[/^gh issue view\s+#?(\d+)/, (m) => `reading #${m[1]}`],
	[/(?:preview\.ts|snap\.sh)\b/, () => "previewing the UI"],
];

/** A short phrase for a Bash command: `running checks`, `reading #46`, `git fetch`. */
export function commandPhrase(command: string): string {
	const parts = segments(command);
	for (const part of parts)
		for (const [pattern, phrase] of PHRASES) {
			const m = pattern.exec(part);
			if (m) return phrase(m);
		}
	// A cut-off command ends mid-word: don't show the stub.
	const tokens = (parts[0] ?? "").split(/\s+/).filter(Boolean);
	if (command.endsWith("…") && parts.length <= 1) tokens.pop();
	const [name, ...args] = tokens;
	if (!name || name === "cd") return "working in the shell";
	const arg = args
		.find((a) => !a.startsWith("-"))
		?.replace(/^["']+|["']+$/g, "");
	return arg ? `${name} ${arg}` : name;
}
