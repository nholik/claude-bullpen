// The Codex review adapter: the connector bot's `codex-review-state` summary
// comment and its P0/P1 badge findings. Selected by `review.bots: ["codex"]`
// in `bullpen.json`; nothing here runs for a repo that doesn't ask for it.

import { looseObject, nullable, safeParse, string } from "./vendor/valibot.js";

/**
 * Codex's summary comment is posted by its connector bot. graphql names a bot
 * without the `[bot]` suffix REST adds; both are accepted.
 */
export const CODEX_BOT = /^chatgpt-codex-connector(\[bot\])?$/;
export const CODEX_STATE = /<!-- codex-review-state:v1 (\{.*?\}) -->/;
const CodexState = looseObject({
	code_review: looseObject({
		commit_sha: nullable(string()),
		status: nullable(string()),
	}),
});
/** Codex's inline findings carry a severity badge: `![P1 Badge](...)`. */
const BADGE = /\bP[01] Badge\b/;

/**
 * True when the newest summary comment from the Codex connector bot carries a
 * `codex-review-state:v1` marker whose code review is `completed` on exactly
 * `head`. No marker, an older sha or a review still running is not reviewed;
 * a marker quoted by anyone else is ignored.
 */
export function codexReviewed(
	comments: readonly {
		body: string;
		author?: { login: string } | null | undefined;
	}[],
	head: string,
): boolean {
	// Each pass moves `i` toward 0, so the walk ends.
	for (let i = comments.length - 1; i >= 0; i--) {
		const comment = comments[i];
		if (!comment?.author || !CODEX_BOT.test(comment.author.login)) continue;
		const marker = CODEX_STATE.exec(comment.body)?.[1];
		if (!marker) continue;
		let json: unknown;
		try {
			json = JSON.parse(marker);
		} catch {
			continue;
		}
		const state = safeParse(CodexState, json);
		if (!state.success) continue;
		const review = state.output.code_review;
		return review.commit_sha === head && review.status === "completed";
	}
	return false;
}

/**
 * Codex's P0/P1 findings still open on the head: a review thread that is
 * neither resolved nor outdated (its lines unchanged since) and whose opening
 * comment carries the P0 or P1 badge. Inline threads are the reliable signal:
 * the summary comment's `codex-review-state` marker only says which commit was
 * reviewed, not what is still open.
 */
export function openCodexFindings(
	threads: readonly {
		isResolved: boolean;
		isOutdated: boolean;
		comments: { nodes: readonly { body: string }[] };
	}[],
): number {
	return threads.filter(
		(t) =>
			!t.isResolved &&
			!t.isOutdated &&
			BADGE.test(t.comments.nodes[0]?.body ?? ""),
	).length;
}
