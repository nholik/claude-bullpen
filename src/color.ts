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

/** Quiet floor/wall lighting, cool and dim at low morale, warm at high morale. */
export function moraleLight(score: number): {
	floor: number;
	alternate: number;
	wall: number;
} {
	const t = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0.7;
	const floor =
		t < 0.5
			? mix(0x101923, 0x14212c, t * 2)
			: mix(0x14212c, 0x1e2b30, (t - 0.5) * 2);
	return {
		floor,
		alternate: mix(floor, 0xffffff, 0.012),
		wall: mix(floor, 0xffffff, 0.18),
	};
}
