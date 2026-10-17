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
const FAIL = /\bfail(s|ed|ing|ure|ures)?\b/i;
// "no failures", "0 tests failed", "zero flaky tests failing": a negation up
// to three words before the failure, within one clause.
const NOT_FAIL = /\b(no|0|zero|not|none|without)(\s+[\w-]+){0,3}\s+fail/i;
// A verdict that work is through outweighs any failure it mentions. PASS only
// in capitals, so a test summary's "2 failed, 5 passed" is still a failure.
const PASSED =
	/\bPASS(ED)?\b|\b(?:[Aa]ll green|[Ll]ooks good|LGTM|lgtm|[Aa]pproved?)\b/;

/**
 * Whether a message sends work back: it says so, or a reviewing role (gate,
 * ux) reports a failure and no pass.
 */
export function isKickback(text: string, reviewer: boolean): boolean {
	if (SENT_BACK.test(text)) return true;
	return (
		reviewer && FAIL.test(text) && !NOT_FAIL.test(text) && !PASSED.test(text)
	);
}

/** Roles whose failures send work back, by team name when no role is given. */
export function isReviewer(name: string, role: string | undefined): boolean {
	return /^(gate|ux)/i.test(role ?? name);
}

const CLOSED = new RegExp(
	[
		/\bgh issue close\s+#?(\d{1,7})\b/,
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
 * Issues a tool call or message says were closed: `gh issue close 208`,
 * "closed #208", "#208 shipped", "#208 ✓". Not "closes #208", a PR promising
 * to close it on merge, nor "merged #13", which is usually a PR number, nor
 * anything negated ("not closed #12").
 */
// A negation earlier in the same clause: "not closed #12", "isn't ✓ #12".
const NEGATED = /\b(not|never|no|yet to)\b|n't\b/i;

export function closedIssues(text: string): number[] {
	const found: number[] = [];
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
