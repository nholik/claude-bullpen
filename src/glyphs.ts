import stringWidth from "./vendor/string-width.js";
import { printable } from "./width";

export type GlyphMode = "unicode" | "ascii";
/** Portable UI repertoire, deliberately excluding emoji and combining marks. */
export const SAFE_SYMBOLS = "●○◐◑✓✗↺⇄→←↑↓⚑☀☁☂☇✉☰·";
const substitutes: Record<string, string> = {
	"…": ".",
	"—": "-",
	"–": "-",
	"×": "x",
	"▸": ">",
	"▾": "v",
	"●": "*",
	"○": "o",
	"◐": "o",
	"◑": "o",
	"✓": "+",
	"✗": "x",
	"↺": "<",
	"⇄": "=",
	"→": ">",
	"←": "<",
	"↑": "^",
	"↓": "v",
	"⚑": "!",
	"☀": "*",
	"☁": "~",
	"☂": "!",
	"☇": "!",
	"✉": "@",
	"☰": "#",
	"·": ".",
};
/** Verdicts by character: the pane redraws the same few glyphs constantly. */
const safeSeen = new Map<string, boolean>();
export function safeGlyph(ch: string): boolean {
	const seen = safeSeen.get(ch);
	if (seen !== undefined) return seen;
	const cp = ch.codePointAt(0) ?? 0;
	const safe =
		stringWidth(ch) === 1 &&
		((cp >= 32 && cp <= 126) ||
			(cp >= 0x2500 && cp <= 0x259f) ||
			SAFE_SYMBOLS.includes(ch));
	if (safeSeen.size < 4096) safeSeen.set(ch, safe);
	return safe;
}
/** One output cell per code point; sanitize external names/titles too. */
export function glyphText(text: string, mode: GlyphMode = "unicode"): string {
	if (printable(text)) return text;
	return Array.from(text, (ch) => {
		const cp = ch.codePointAt(0) ?? 0;
		if (mode === "unicode" && safeGlyph(ch)) return ch;
		if (cp >= 32 && cp <= 126) return ch;
		if (substitutes[ch]) return substitutes[ch];
		if (cp >= 0x2580 && cp <= 0x259f) return "#";
		if (cp >= 0x2500 && cp <= 0x257f) {
			if ("─━┄┅┈┉╌╍═".includes(ch)) return "-";
			if ("│┃┆┇┊┋╎╏║".includes(ch)) return "|";
			return "+";
		}
		const plain = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
		return /^[ -~]$/.test(plain) ? plain : "?";
	}).join("");
}
