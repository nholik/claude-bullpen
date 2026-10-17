// The profile: `.claude/bullpen.json`, the one place home and work setups
// differ (issue filter, palette, who plays what role in what color, animations).
// Parsing never throws: a bad field falls back to its default and says so.

import type { Profile, ProfileRole } from "../types";
import { PALETTE } from "./palette";
import {
	array,
	boolean,
	integer,
	looseObject,
	minValue,
	number,
	optional,
	picklist,
	pipe,
	record,
	safeParse,
	string,
	union,
} from "./vendor/valibot.js";

/** The smallest poll interval; GitHub's search API rate limit is the reason. */
export const MIN_POLL_SECONDS = 15;

const RoleSchema = looseObject({
	role: optional(string()),
	color: optional(union([pipe(number(), integer(), minValue(0)), string()])),
});

const IssuesSchema = looseObject({
	filter: optional(string()),
	pollSeconds: optional(pipe(number(), minValue(MIN_POLL_SECONDS))),
});

const ProfileSchema = looseObject({
	issues: optional(IssuesSchema),
	roles: optional(record(string(), RoleSchema)),
	animations: optional(boolean()),
	glyphs: optional(picklist(["unicode", "ascii"])),
	style: optional(picklist(["studio", "operations"])),
	palette: optional(array(string())),
});

export type { Profile };
export type Role = ProfileRole;

export const DEFAULT_PROFILE: Profile = {
	issues: { filter: "", pollSeconds: 60 },
	roles: {},
	animations: true,
	glyphs: "unicode",
	style: "studio",
	palette: [...PALETTE],
};

/** The fields a file actually set; what `mergeProfiles` layers. */
export type PartialProfile = Partial<Omit<Profile, "issues">> & {
	issues?: Partial<Profile["issues"]>;
};

export type Parsed = {
	/** Defaults with the file's valid fields on top. */
	profile: Profile;
	/** Only the valid fields the file set. */
	set: PartialProfile;
	/** One friendly line per problem. */
	warnings: string[];
};

const HEX = /^#[0-9a-f]{6}$/i;

const hexToNumber = (color: string) => Number.parseInt(color.slice(1), 16);

/** A 0xRRGGBB number from `#rrggbb` or an index into `palette`; else undefined. */
export function parseColor(
	color: unknown,
	palette: readonly number[] = PALETTE,
): number | undefined {
	if (typeof color === "number") {
		return Number.isInteger(color) && color >= 0 && palette.length > 0
			? palette[color % palette.length]
			: undefined;
	}
	if (typeof color === "string" && HEX.test(color)) return hexToNumber(color);
	return undefined;
}

/** A JSON object: not null, not an array. */
const isPlain = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

function message(result: { issues?: readonly { message: string }[] }) {
	return result.issues?.[0]?.message ?? "invalid value";
}

export function parsePartial(text: string | undefined): {
	set: PartialProfile;
	warnings: string[];
} {
	const set: PartialProfile = {};
	const warnings: string[] = [];
	if (text === undefined || text.trim() === "") return { set, warnings };
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		return { set, warnings: [`bullpen.json is not valid JSON (${error})`] };
	}
	if (!isPlain(json))
		return { set, warnings: ["bullpen.json must be a JSON object"] };

	const fields = ProfileSchema.entries;
	if (json.style !== undefined) {
		const parsed = safeParse(fields.style, json.style);
		if (parsed.success && parsed.output) set.style = parsed.output;
		else
			warnings.push("style: expected studio or operations; using the default");
	}
	if (json.glyphs !== undefined) {
		const parsed = safeParse(fields.glyphs, json.glyphs);
		if (parsed.success && parsed.output) set.glyphs = parsed.output;
		else warnings.push("glyphs: expected unicode or ascii; using the default");
	}
	type Obj = Record<string, unknown>;
	const obj = json as Record<string, unknown>;

	if (obj.issues !== undefined) {
		const raw = obj.issues;
		if (!isPlain(raw))
			warnings.push("issues: must be an object; using the defaults");
		else {
			const issues: Partial<Profile["issues"]> = {};
			const f = safeParse(IssuesSchema.entries.filter, (raw as Obj).filter);
			if ((raw as Obj).filter !== undefined) {
				if (f.success && f.output !== undefined) issues.filter = f.output;
				else warnings.push(`issues.filter: ${message(f)}; using the default`);
			}
			const p = safeParse(
				IssuesSchema.entries.pollSeconds,
				(raw as Obj).pollSeconds,
			);
			if ((raw as Obj).pollSeconds !== undefined) {
				if (p.success && p.output !== undefined) issues.pollSeconds = p.output;
				else
					warnings.push(
						`issues.pollSeconds: must be a number of at least ${MIN_POLL_SECONDS}; using the default`,
					);
			}
			set.issues = issues;
		}
	}
	if (obj.animations !== undefined) {
		const r = safeParse(fields.animations, obj.animations);
		if (r.success) set.animations = r.output;
		else warnings.push(`animations: ${message(r)}; using the default`);
	}
	if (obj.palette !== undefined) {
		const palette = obj.palette;
		if (!Array.isArray(palette))
			warnings.push("palette: must be a list of #rrggbb colors; ignoring it");
		else {
			const good: number[] = [];
			for (const c of palette) {
				if (typeof c === "string" && HEX.test(c)) good.push(hexToNumber(c));
				else warnings.push(`palette: "${c}" is not #rrggbb; dropping it`);
			}
			if (good.length > 0) set.palette = good;
			else if (palette.length === 0)
				warnings.push("palette: empty; using the default palette");
			else warnings.push("palette: no valid colors; using the default palette");
		}
	}
	if (obj.roles !== undefined) {
		const raw = obj.roles;
		if (!isPlain(raw)) warnings.push("roles: must be an object; ignoring it");
		else {
			const roles: Record<string, Role> = {};
			for (const [name, entry] of Object.entries(raw)) {
				const r = isPlain(entry)
					? safeParse(RoleSchema, entry)
					: {
							success: false as const,
							issues: [{ message: "must be an object" }],
						};
				if (!r.success) {
					warnings.push(`roles.${name}: ${message(r)}; ignoring it`);
					continue;
				}
				const out: Role = {};
				if (r.output.role !== undefined) out.role = r.output.role;
				if (r.output.color !== undefined) {
					if (parseColor(r.output.color, set.palette) === undefined)
						warnings.push(
							`roles.${name}.color: use #rrggbb or a palette index; ignoring it`,
						);
					else out.color = r.output.color;
				}
				roles[name] = out;
			}
			set.roles = roles;
		}
	}
	return { set, warnings };
}

/** Parses a `bullpen.json` text. Never throws. */
export function parseProfile(text: string | undefined): Parsed {
	const { set, warnings } = parsePartial(text);
	return { profile: mergeProfiles(set, {}), set, warnings };
}

/** Layers `project` over `user` over the defaults; the project wins. */
export function mergeProfiles(
	project: PartialProfile,
	user: PartialProfile,
): Profile {
	const out: Profile = {
		...DEFAULT_PROFILE,
		issues: { ...DEFAULT_PROFILE.issues },
		roles: {},
	};
	for (const layer of [user, project]) {
		out.issues = { ...out.issues, ...layer.issues };
		out.animations = layer.animations ?? out.animations;
		out.glyphs = layer.glyphs ?? out.glyphs;
		out.style = layer.style ?? out.style;
		out.palette = layer.palette?.length ? layer.palette : out.palette;
		out.roles = { ...out.roles, ...layer.roles };
	}
	return out;
}

/** The role entry for a teammate name or agent type, case-insensitively. */
export function roleFor(name: string, profile: Profile): Role | undefined {
	const exact = profile.roles[name];
	if (exact) return exact;
	const lower = name.toLowerCase();
	for (const [key, role] of Object.entries(profile.roles))
		if (key.toLowerCase() === lower) return role;
	return undefined;
}

const TYPE_ROLES: Record<string, string> = {
	builder: "engineer",
	gate: "reviewer",
	"ux-judge": "designer",
	explore: "researcher",
	plan: "researcher",
};

/**
 * What a card calls a teammate: the profile's role for its name or agent type,
 * else a default from the agent type, else `lead` or `teammate`.
 */
export function roleLabel(
	name: string,
	agentType: string | undefined,
	profile: Profile,
): string {
	const chosen =
		roleFor(name, profile)?.role ??
		(agentType ? roleFor(agentType, profile)?.role : undefined);
	if (chosen) return chosen;
	if (name === "lead") return "lead";
	if (!agentType) return "";
	return TYPE_ROLES[agentType.toLowerCase()] ?? agentType;
}

/** 0xRRGGBB for `name`: its profile color, else the palette at `fallbackIndex`. */
export function colorFor(
	name: string,
	profile: Profile,
	fallbackIndex: number,
	agentType?: string,
): number {
	const chosen = parseColor(
		(
			roleFor(name, profile) ??
			(agentType ? roleFor(agentType, profile) : undefined)
		)?.color,
		profile.palette,
	);
	if (chosen !== undefined) return chosen;
	const i = Math.max(0, Math.trunc(fallbackIndex));
	const palette = profile.palette.length > 0 ? profile.palette : PALETTE;
	return palette[i % palette.length] ?? 0xffffff;
}

/** Stable fallback identity independent of collector insertion order. */
export function colorIndex(name: string): number {
	let hash = 0;
	for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
	return hash;
}

/**
 * The profile with each member's join-order color filled in for those the
 * profile doesn't color (by name or agent type), so every view agrees and
 * neighbours differ.
 */
export function withMemberColors(
	profile: Profile,
	members: readonly { name: string; color: number; agentType?: string }[],
): Profile {
	let roles = profile.roles;
	for (const m of members) {
		const own = roleFor(m.name, profile);
		if (own?.color !== undefined) continue;
		// A type's color is written under the name too, so name-only lookups agree.
		const typed = m.agentType ? roleFor(m.agentType, profile) : undefined;
		if (roles === profile.roles) roles = { ...roles };
		roles[m.name] = { ...own, color: typed?.color ?? m.color };
	}
	return roles === profile.roles ? profile : { ...profile, roles };
}
