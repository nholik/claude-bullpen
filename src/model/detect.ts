// Reading intent out of what teammates say and run: asks, kickbacks, closes.
// Heuristics over short English text, so each errs toward not firing.

/** A message to the lead that wants an answer: a question or a block. */
export function isAsk(text: string): boolean {
	const unblocked = text.replace(/\b(not|no longer|never) block\w*/gi, "");
	return /\?|\bblock(ed|ing|er)\b|\bskip or fix\b|\bneed (you|your|a decision)\b/i.test(
		unblocked,
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

export function closedIssues(text: string): number[] {
	const found: number[] = [];
	// Questions and quoted commands are not confirmations.
	text = text
		.split(/(?<=[.!?])\s+|[;\n]/)
		.filter(
			(clause) =>
				!clause.includes("?") &&
				!/^\s*(?:who|what|when|where|why|how|is|are|was|were|did|has|have|can|could|should|would)\b/i.test(
					clause,
				) &&
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
