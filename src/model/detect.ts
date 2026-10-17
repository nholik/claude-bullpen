// Reading intent out of what teammates say and run: asks, kickbacks, closes.
// Heuristics over short English text, so each errs toward not firing.

/** A message to the lead that wants an answer: a question or a block. */
export function isAsk(text: string): boolean {
	return /\?|\bblock(ed|ing|er)\b|\bskip or fix\b|\bneed (you|your|a decision)\b/i.test(
		text,
	);
}

const SENT_BACK =
	/\bkick(ing|ed|s)? (it |this |that )?back\b|\bsend(ing)? (it|this|that) back\b|\bsent (it|this|that) back\b|↺/i;
const FAIL = /\bfail(s|ed|ing|ure|ures)?\b/i;
const NOT_FAIL = /\b(no|0|zero|not|without) fail/i;

/**
 * Whether a message sends work back: it says so, or a reviewing role (gate,
 * ux) reports a failure.
 */
export function isKickback(text: string, reviewer: boolean): boolean {
	if (SENT_BACK.test(text)) return true;
	return reviewer && FAIL.test(text) && !NOT_FAIL.test(text);
}

/** Roles whose failures send work back, by team name when no role is given. */
export function isReviewer(name: string, role: string | undefined): boolean {
	return /^(gate|ux)/i.test(role ?? name);
}

const CLOSED = new RegExp(
	[
		/\bgh issue close\s+#?(\d{1,7})\b/,
		/\b(?:closed|merged|shipped)\s+#(\d{1,7})\b/,
		/#(\d{1,7})\s+(?:is\s+)?(?:closed|merged|shipped)\b/,
		/#(\d{1,7})\s*✓/,
		/✓\s*#(\d{1,7})\b/,
	]
		.map((r) => r.source)
		.join("|"),
	"gi",
);

/**
 * Issues a tool call or message says were closed: `gh issue close 208`,
 * "closed #208", "#208 merged", "#208 ✓". Not "closes #208": that's a PR
 * promising to close it on merge.
 */
export function closedIssues(text: string): number[] {
	const found: number[] = [];
	for (const m of text.matchAll(CLOSED)) {
		const issue = Number(m.slice(1).find((g) => g !== undefined));
		if (!found.includes(issue)) found.push(issue);
	}
	return found;
}
