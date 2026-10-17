// Color math in OKLCH (perceptually even), borrowed from culori. Colors in
// the rest of the mod are 0xRRGGBB numbers, the form a Raster cell takes.

import {
	formatHex,
	interpolate,
	modeOklch,
	modeRgb,
	useMode,
} from "./vendor/culori.js";

useMode(modeRgb);
useMode(modeOklch);

type Rgb = { mode: "rgb"; r: number; g: number; b: number };

const toRgb = (color: number): Rgb => ({
	mode: "rgb",
	r: ((color >> 16) & 0xff) / 255,
	g: ((color >> 8) & 0xff) / 255,
	b: (color & 0xff) / 255,
});

/** `#rrggbb` for a 0xRRGGBB number. */
export const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/** The color `t` of the way from `from` to `to` (0..1), mixed in OKLCH. */
export function mix(from: number, to: number, t: number): number {
	const mixed = interpolate(
		[toRgb(from), toRgb(to)],
		"oklch",
	)(Math.min(1, Math.max(0, t)));
	return Number.parseInt(formatHex(mixed).slice(1), 16);
}
