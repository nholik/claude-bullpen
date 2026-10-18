// Reading intent out of what teammates say and run: asks, kickbacks, closes.
// Heuristics over short English text, so each errs toward not firing.
import { shellSegments } from "../command";

// Phrases (to the clause end) that say nothing is wanted, removed so a real question beside them stays.
const NOTHING_WANTED =
	/(?:\bnothing (?:is |else )?(?:needed|required|wanted)\b|\bnot a (?:request|question|blocker)\b|\bno (?:action|reply|answer|decision) (?:is )?(?:needed|required)\b|\bno need to (?:reply|respond|answer)\b|\bnever ?mind\b|\b(?:that's|it's|question|ask) resolved\b|\bresolved it\b|\bno longer (?:blocked|stuck)\b)[^.;,!?\n]*/gi;
// A review verdict, in capitals so ordinary "pass" and "changes" stay words.
const VERDICT = /\b(?:PASS|CHANGES)\b(?!\.md)[^.;,!?\n]*/g;
// Review language: "one P1 blocks the merge", "no blockers".
const REVIEW_BLOCK =
	/\bP[0-3]\b[^.\n]{0,40}\bblock\w*|\b(?:no|zero|0) blockers?\b/gi;
// Quoted and linked text: a "?" inside it is not the sender's question. A URL
// stops before trailing punctuation, so "review https://x/pull/1?" still asks.
const QUOTED_TEXT = /`[^`]*`|"[^"\n]*"|https?:\/\/\S*[^\s.,;:!?)]/g;

/** Whether the sender takes back an earlier ask: "nothing needed", "never mind". */
export function withdrawsAsk(text: string): boolean {
	return text.search(NOTHING_WANTED) >= 0;
}

/** A message to the lead that wants an answer: a question or a block. */
export function isAsk(text: string): boolean {
	const plain = text
		.replace(NOTHING_WANTED, " ")
		.replace(VERDICT, " ")
		.replace(QUOTED_TEXT, " ")
		.replace(REVIEW_BLOCK, " ")
		.replace(/\b(?:not|no longer|never) block\w*/gi, "");
	return /\?|\bblock(?:ed|ing|er)\b|\bskip or fix\b|\bneed (?:you|your|a decision)\b/i.test(
		plain,
	);
}

const SENT_BACK =
	/\bkick(ing|ed|s)? (it |this |that )?back\b|\bsend(ing)? (it|this|that) back\b|\bsent (it|this|that) back\b|↺/i;
const FAIL = /\bfail(s|ed|ing|ure|ures)?\b/gi;
// "no failures", "0 tests failed", "zero flaky tests failing": a negation up
// to three words before a failure, within its clause.
const NEGATES_FAIL =
	/\b(no|0|zero|not|none|nothing|without)(\s+[\w-]+){0,3}\s+$/i;
// A verdict that work is through outweighs any failure it mentions. PASS only
// in capitals, so a test summary's "2 failed, 5 passed" is still a failure.
const PASSED =
	/\bPASS(ED)?\b|\b(?:[Aa]ll green|[Ll]ooks good|LGTM|lgtm|[Aa]pproved?)\b/;

/** Whether any failure in `text` is not negated in its own clause. */
function unnegatedFailure(text: string): boolean {
	for (const m of text.matchAll(FAIL)) {
		const clause =
			text
				.slice(0, m.index)
				.split(/[.,;:!?\n]/)
				.pop() ?? "";
		if (!NEGATES_FAIL.test(clause)) return true;
	}
	return false;
}

/**
 * Whether `before`, the text ahead of a send-back phrase, negates it: a
 * negation anywhere in the same phrase. An earlier "not ready," or
 * "no fix here -" leaves the send-back standing.
 */
function negatesSendBack(before: string): boolean {
	const phrase = before.split(/[.,;:!?\n\u2014\u2013]|\s-\s/).pop() ?? "";
	return NEGATED.test(phrase);
}

/**
 * Whether a message sends work back: it says so, or a reviewing role (gate,
 * ux) reports a failure and no pass.
 */
export function isKickback(text: string, reviewer: boolean): boolean {
	return text.split(/[;\n]|\bbut\b/i).some((clause) => {
		const sent = SENT_BACK.exec(clause);
		if (sent && !negatesSendBack(clause.slice(0, sent.index))) return true;
		return reviewer && !PASSED.test(clause) && unnegatedFailure(clause);
	});
}

/** Roles whose failures send work back, by team name when no role is given. */
export function isReviewer(name: string, role: string | undefined): boolean {
	return /^(gate|ux)/i.test(role ?? name);
}

const CLOSED = new RegExp(
	[
		/\b(?:closed|shipped)\s+#(\d{1,7})\b/,
		/#(\d{1,7})\s+(?:is\s+)?(?:closed|shipped)\b/,
		/#(\d{1,7})\s*✓/,
		/✓\s*#(\d{1,7})\b/,
	]
		.map((r) => r.source)
		.join("|"),
	"gi",
);

/**
 * Issues a message explicitly confirms closed:
 * "closed #208", "#208 shipped", "#208 ✓". Not "closes #208", a PR promising
 * to close it on merge, nor "merged #13", which is usually a PR number, nor
 * anything negated ("not closed #12").
 */
// A negation earlier in the same clause: "not closed #12", "isn't ✓ #12".
const NEGATED = /\b(not|never|no|yet to)\b|n't\b/i;

// "Can confirm #12 is closed", "Have closed #12": a leading auxiliary that
// goes straight to a confirming verb has dropped its subject; it is no question.
// "Could" is a request ("Could confirm #12 shipped"), and "confirm whether/if"
// is an indirect question, so neither is exempt.
const ELIDED_CONFIRM =
	/^\s*(?:can|have|has)\s+(?:now\s+|also\s+|just\s+)?(?:confirm\w*|closed|shipped)\b(?!\s+(?:whether|if)\b)/i;
const QUESTION_WORD =
	/^\s*(?:who|what|when|where|why|how|is|are|was|were|did|has|have|can|could|should|would)\b/i;

function isInterrogative(clause: string): boolean {
	return QUESTION_WORD.test(clause) && !ELIDED_CONFIRM.test(clause);
}

export function closedIssues(text: string): number[] {
	const found: number[] = [];
	// Questions and quoted commands are not confirmations.
	text = text
		.split(/(?<=[.!?])\s+|[;\n]/)
		.filter(
			(clause) =>
				!clause.includes("?") &&
				!isInterrogative(clause) &&
				!/\bgh\s+issue\s+close\b/.test(clause),
		)
		.join("; ");
	for (const m of text.matchAll(CLOSED)) {
		const clause =
			text
				.slice(0, m.index)
				.split(/[.,;:!?\n]/)
				.pop() ?? "";
		if (NEGATED.test(clause)) continue;
		const issue = Number(m.slice(1).find((g) => g !== undefined));
		if (!found.includes(issue)) found.push(issue);
	}
	return found;
}

/** Only a simple foreground close with a successful Bash result is evidence. */
export function confirmedToolCloses(
	command: string,
	outcome: unknown,
): number[] {
	const match = /^\s*gh\s+issue\s+close\s+#?(\d{1,7})\s*$/.exec(command);
	if (!match || !outcome || typeof outcome !== "object") return [];
	if ("deny" in outcome && outcome.deny !== undefined) return [];
	if ("isError" in outcome && outcome.isError) return [];
	if (
		!("result" in outcome) ||
		!outcome.result ||
		typeof outcome.result !== "object"
	)
		return [];
	const result = outcome.result;
	if (
		!("interrupted" in result) ||
		result.interrupted !== false ||
		("backgroundTaskId" in result && result.backgroundTaskId) ||
		("backgroundedByUser" in result && result.backgroundedByUser) ||
		("timedOutAfterMs" in result && result.timedOutAfterMs)
	)
		return [];
	const issue = Number(match[1]);
	return issue > 0 ? [issue] : [];
}

// Quoted examples in a brief ("Can confirm #12 is closed") are not assignments.
const QUOTED = /"[^"\n]*"|“[^”\n]*”|`[^`\n]*`|(?<!\w)'[^'\n]*'(?!\w)/g;
// Phrases that hand one issue to someone else, removed as spans so the rest of
// the clause still assigns: "leave #12 alone", "#12 is someone else's".
// Plain negation ("do not work on #12", "not #12") is NEGATED.
const NOT_YOURS = new RegExp(
	[
		/\bleave\s+#\d{1,7}\s+(?:alone|to\s+\w+)/,
		/#\d{1,7}\s+(?:is|belongs\s+to|goes\s+to)\s+(?:(?:someone|somebody)\s+else|(?:another|the\s+other)\s+(?:builder|agent|teammate))(?:'s)?/,
	]
		.map((r) => r.source)
		.join("|"),
	"gi",
);
// A negated tail on a positive clause: "Your issue is #13, not #12".
// A parenthesized tail ends at its `)`; a comma tail runs to the clause end.
const NEGATED_TAIL =
	/\s*\((?:not|never)\b[^)\n]*\)?|,\s*(?:but\s+)?(?:not|never)\b[^.!?;\n]*/gi;
const ASSIGNED =
	/\b(?:(?:your|the|this|assigned|owned?)\s+(?:issue|task|ticket)|(?:issue|task|ticket)\s+(?:is|:)|(?:work(?:ing)?\s+on|own|owns|take|taking|fix|implement))\s*(?:is\s+)?(?:issue\s+)?#(\d{1,7})\b/i;

/**
 * The one issue a spawn brief assigns: an explicit "issue is #N" style
 * phrase, else the only ref in its first sentence. Quoted examples are
 * ignored, and a brief naming several issues (a reviewer's whole round)
 * assigns none; those join huddles when they act on an issue.
 */
export function briefIssue(brief: string): number | undefined {
	const text = brief
		.replace(QUOTED, " ")
		.replace(NEGATED_TAIL, "")
		.replace(NOT_YOURS, " ")
		.split(/(?<=[.!?])\s+|[;\n]/)
		.filter((clause) => !NEGATED.test(clause))
		.join(". ");
	const assigned = ASSIGNED.exec(text);
	if (assigned?.[1]) return Number(assigned[1]);
	const first = text.trim().split(/(?<=[.!?])\s+|\n/, 1)[0] ?? "";
	const refs = [
		...new Set(
			[...first.matchAll(/(?:^|[^\w&])#(\d{1,7})\b/g)].map((m) => m[1]),
		),
	];
	const only = refs.length === 1 ? refs[0] : undefined;
	return only === undefined ? undefined : Number(only);
}

const GH_TARGET =
	/\bgh\s+issue\s+(?:view|comment|edit|close|reopen)\s+#?(\d{1,7})\b/g;

/** Numbers named by `gh issue <verb> <n>` (a PR number is not an issue) in a shell command. */
export function ghTargets(command: string): number[] {
	const found: number[] = [];
	for (const part of shellSegments(command)) {
		if (!/^gh\s+issue\s/.test(part)) continue;
		const m = GH_TARGET.exec(part);
		GH_TARGET.lastIndex = 0;
		if (!m) continue;
		const n = Number(m[1]);
		if (!found.includes(n)) found.push(n);
	}
	return found;
}
