import { section, text } from "./layout";
import { type Line, textLine, wrapText } from "./lines";
import { STUDIO } from "./studio";

/** The question the person is answering. */
export type AnswerAsk = {
	from: string;
	text: string;
	issues: readonly number[];
};

/** The answer view's question: who asks, which issues, and the wrapped text. */
export function answerSection(
	ask: AnswerAsk | undefined,
	columns: number,
): Line[] {
	if (!ask)
		return [
			section("ANSWER", columns),
			textLine("Nothing is waiting on you.", columns),
		];
	const issues = ask.issues.map((n) => `#${n}`).join(" ");
	return [
		section(`ANSWER / ${ask.from} needs your input`, columns),
		...(issues ? [text(issues, STUDIO.muted)] : []),
		...wrapText(ask.text, columns),
	];
}
