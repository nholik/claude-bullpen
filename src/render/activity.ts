import type { TrailStep } from "../model/types";

const VERBS: Record<string, string> = {
	Edit: "editing",
	Write: "writing",
	NotebookEdit: "editing",
	Read: "reading",
	Grep: "searching",
	Glob: "searching",
};

const FILE_TOOLS = ["Edit", "Write", "Read", "NotebookEdit"];

/** `describeTool` puts the tool's verb first for file tools; the file name is the rest. */
function rest(detail: string): string {
	return detail.replace(/^\S+\s+/, "");
}

/** A live phrase for the latest tool call, like `editing detect.ts`. */
export function activityPhrase(step: TrailStep): string {
	const tool = step.target;
	if (tool === undefined) return step.detail;
	if (tool === "Bash") {
		const issue = /^gh issue view\s+#?(\d+)/.exec(step.detail);
		return issue ? `reading #${issue[1]}` : `running ${step.detail}`;
	}
	const verb = VERBS[tool];
	if (verb && FILE_TOOLS.includes(tool)) return `${verb} ${rest(step.detail)}`;
	if (verb) return verb;
	return step.detail;
}

/** Coarse age that only changes at the existing view refresh: `12s`, `3m`. */
export function shortAge(now: number, at: number): string {
	const seconds = Math.max(0, Math.floor((now - at) / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}
