import { commandPhrase } from "../command";
import type { TrailStep } from "../model/types";

const FILE_VERBS: Record<string, string> = {
	Edit: "editing",
	Write: "writing",
	NotebookEdit: "editing",
	Read: "reading",
};

/** Tools with a fixed phrase, however they were called. */
const FIXED: Record<string, string> = {
	Grep: "searching code",
	Glob: "searching files",
	Monitor: "watching a task",
	ToolSearch: "looking up tools",
	SubagentHandback: "handing back results",
	WebFetch: "reading the web",
	WebSearch: "searching the web",
	Skill: "using a skill",
	TaskCreate: "planning tasks",
	TaskUpdate: "updating tasks",
	TaskList: "checking tasks",
	TaskGet: "checking tasks",
	TaskStop: "stopping a task",
	Artifact: "publishing a page",
	AskUserQuestion: "asking the user",
};

/** `describeTool` puts a verb or arrow first; the object is the rest. */
function rest(detail: string): string {
	return detail.replace(/^\S+\s+(?:→\s+)?/, "");
}

/**
 * A verb phrase for the latest tool call, like `editing detect.ts`, or
 * undefined when it can't be phrased (callers fall back to the latest message).
 */
export function activityPhrase(step: TrailStep): string | undefined {
	const tool = step.target;
	if (tool === undefined) return undefined;
	if (tool === "Bash") return commandPhrase(step.detail);
	const verb = FILE_VERBS[tool];
	if (verb) {
		const file = rest(step.detail);
		return file && file !== step.detail ? `${verb} ${file}` : verb;
	}
	if (tool === "SendMessage") return `messaging ${rest(step.detail)}`;
	if (tool === "Agent") return `spawning ${rest(step.detail)}`;
	return FIXED[tool];
}
