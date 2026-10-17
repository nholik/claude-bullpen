import type { MemberStatus } from "../../types";
import { STUDIO } from "./studio";

export type MoodKind =
	| "gone"
	| "needs-you"
	| "failing"
	| "merged"
	| "review"
	| "running"
	| "away"
	| "idle";

/** What the mood needs to know about one teammate; callers derive it from the model. */
export type MoodInput = {
	status: MemberStatus;
	away?: boolean;
	/** An open ask to the lead. */
	needsYou?: boolean;
	/** Waiting on a reviewer or gate. */
	waitingOnReview?: boolean;
	/** Consecutive failing checks. */
	failingChecks?: number;
	/** Their issue closed a moment ago. */
	justMerged?: boolean;
};

export type Mood = {
	kind: MoodKind;
	/** Printable ASCII only, so every terminal draws it the same. */
	face: string;
	/** Short state word; always shown beside the face. */
	label: string;
	color: number;
	/** The card frame stays quiet unless a mood asks for a warm one. */
	frame?: number;
	/** Dim the whole card (idle, away, gone). */
	dim: boolean;
	/** The only moods that may pulse: asks, and the one-shot merge flourish. */
	pulse: boolean;
	/** Only idle moods drift. */
	snoozes: boolean;
};

const MOODS: Record<MoodKind, Omit<Mood, "kind" | "label">> = {
	gone: {
		face: "(u_u)",
		color: STUDIO.edge,
		dim: true,
		pulse: false,
		snoozes: false,
	},
	"needs-you": {
		face: "(o_o)/",
		color: STUDIO.amber,
		frame: STUDIO.amber,
		dim: false,
		pulse: true,
		snoozes: false,
	},
	failing: {
		face: "(>_<)",
		color: STUDIO.coral,
		frame: STUDIO.coral,
		dim: false,
		pulse: false,
		snoozes: false,
	},
	merged: {
		face: "(^_^)b",
		color: STUDIO.mint,
		dim: false,
		pulse: true,
		snoozes: false,
	},
	review: {
		face: "(o_o)?",
		color: STUDIO.lavender,
		dim: false,
		pulse: false,
		snoozes: false,
	},
	running: {
		face: "(-_-)",
		color: STUDIO.text,
		dim: false,
		pulse: false,
		snoozes: false,
	},
	away: {
		face: "(-_-)",
		color: STUDIO.muted,
		dim: true,
		pulse: false,
		snoozes: true,
	},
	idle: {
		face: "(-_-)",
		color: STUDIO.muted,
		dim: true,
		pulse: false,
		snoozes: true,
	},
};

const LABELS: Record<MoodKind, string> = {
	gone: "clocked out",
	"needs-you": "needs you",
	failing: "checks red",
	merged: "merged",
	review: "waiting on review",
	running: "heads-down",
	away: "snoozing",
	idle: "snoozing",
};

/** Highest priority first: what needs a human beats what is merely going on. */
export function moodKind(input: MoodInput): MoodKind {
	if (input.status === "gone") return "gone";
	if (input.needsYou) return "needs-you";
	if ((input.failingChecks ?? 0) > 0) return "failing";
	if (input.justMerged) return "merged";
	if (input.waitingOnReview) return "review";
	if (input.status === "running") return "running";
	return input.away ? "away" : "idle";
}

export function moodFor(input: MoodInput): Mood {
	const kind = moodKind(input);
	const label =
		kind === "failing" && (input.failingChecks ?? 0) > 1
			? `checks red x${input.failingChecks}`
			: LABELS[kind];
	return { kind, label, ...MOODS[kind] };
}

/** Snooze drifts one frame per 2 s; widths stay fixed so nothing around it shifts. */
export const SNOOZE_MS = 2000;
const SNOOZE_FRAMES = ["z    ", " z   ", "z z  ", " z Z ", "  z Z", "   Z "];

export function snoozeFrame(now: number, animations = true): string {
	if (!animations) return SNOOZE_FRAMES[2] ?? "";
	const i = Math.floor(now / SNOOZE_MS) % SNOOZE_FRAMES.length;
	return SNOOZE_FRAMES[i] ?? "";
}

/** True while this mood has anything that moves with time. */
export function isAnimated(mood: Mood, animations: boolean): boolean {
	return animations && mood.snoozes;
}
