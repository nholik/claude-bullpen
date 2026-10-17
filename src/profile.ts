// The profile: `.claude/bullpen.json`, the one place home and work setups
// differ (issue filter, who plays what role in what color, animations).
// Parsing never throws: a bad field falls back to its default and says so.

import type { Profile, ProfileRole } from "../types";
import { PALETTE } from "./floor";
import {
	boolean,
	integer,
	looseObject,
	minValue,
	number,
	optional,
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

const ProfileSchema = looseObject({
	issueFilter: optional(string()),
	roles: optional(record(string(), RoleSchema)),
	animations: optional(boolean()),
	pollSeconds: optional(pipe(number(), minValue(MIN_POLL_SECONDS))),
});

export type { Profile };
export type Role = ProfileRole;

export const DEFAULT_PROFILE: Profile = {
	issueFilter: "is:open",
	roles: {},
	animations: true,
	pollSeconds: 60,
};

/** The fields a file actually set; what `mergeProfiles` layers. */
export type PartialProfile = Partial<Profile>;

export type Parsed = {
	/** Defaults with the file's valid fields on top. */
	profile: Profile;
	/** Only the valid fields the file set. */
	set: PartialProfile;
	/** One friendly line per problem. */
	warnings: string[];
};

const HEX = /^#?[0-9a-f]{6}$/i;

/** A 0xRRGGBB number from `#rrggbb` or a palette index; undefined if neither. */
export function parseColor(color: unknown): number | undefined {
	if (typeof color === "number") {
		return Number.isInteger(color) && color >= 0
			? (PALETTE[color % PALETTE.length] ?? undefined)
			: undefined;
	}
	if (typeof color === "string" && HEX.test(color))
		return Number.parseInt(color.replace("#", ""), 16);
	return undefined;
}

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
	if (typeof json !== "object" || json === null || Array.isArray(json))
		return { set, warnings: ["bullpen.json must be a JSON object"] };

	const fields = ProfileSchema.entries;
	const obj = json as Record<string, unknown>;

	if (obj.issueFilter !== undefined) {
		const r = safeParse(fields.issueFilter, obj.issueFilter);
		if (r.success && r.output !== undefined) set.issueFilter = r.output;
		else warnings.push(`issueFilter: ${message(r)}; using the default`);
	}
	if (obj.animations !== undefined) {
		const r = safeParse(fields.animations, obj.animations);
		if (r.success) set.animations = r.output;
		else warnings.push(`animations: ${message(r)}; using the default`);
	}
	if (obj.pollSeconds !== undefined) {
		const r = safeParse(fields.pollSeconds, obj.pollSeconds);
		if (r.success) set.pollSeconds = r.output;
		else
			warnings.push(
				`pollSeconds: must be a number of at least ${MIN_POLL_SECONDS}; using the default`,
			);
	}
	if (obj.roles !== undefined) {
		const raw = obj.roles;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			warnings.push("roles: must be an object; ignoring it");
		else {
			const roles: Record<string, Role> = {};
			for (const [name, entry] of Object.entries(raw)) {
				const r = safeParse(RoleSchema, entry);
				if (!r.success) {
					warnings.push(`roles.${name}: ${message(r)}; ignoring it`);
					continue;
				}
				const out: Role = {};
				if (r.output.role !== undefined) out.role = r.output.role;
				if (r.output.color !== undefined) {
					if (parseColor(r.output.color) === undefined)
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
	const layers = [DEFAULT_PROFILE, user, project];
	const out: Profile = { ...DEFAULT_PROFILE, roles: {} };
	for (const layer of layers) {
		out.issueFilter = layer.issueFilter ?? out.issueFilter;
		out.animations = layer.animations ?? out.animations;
		out.pollSeconds = layer.pollSeconds ?? out.pollSeconds;
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

/** 0xRRGGBB for `name`: its profile color, else the palette at `fallbackIndex`. */
export function colorFor(
	name: string,
	profile: Profile,
	fallbackIndex: number,
): number {
	const chosen = parseColor(roleFor(name, profile)?.color);
	if (chosen !== undefined) return chosen;
	const i = Math.max(0, Math.trunc(fallbackIndex));
	return PALETTE[i % PALETTE.length] ?? 0xffffff;
}
