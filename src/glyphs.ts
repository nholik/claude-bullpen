import stringWidth from "./vendor/string-width.js";

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
export function safeGlyph(ch: string): boolean {
	const cp = ch.codePointAt(0) ?? 0;
	return (
		stringWidth(ch) === 1 &&
		((cp >= 32 && cp <= 126) ||
			(cp >= 0x2500 && cp <= 0x259f) ||
			SAFE_SYMBOLS.includes(ch))
	);
}
/** One output cell per code point; sanitize external names/titles too. */
export function glyphText(text: string, mode: GlyphMode = "unicode"): string {
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
