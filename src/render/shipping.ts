// The Studio's decision rows: what needs the lead, and each issue's path to
// shipping (issue, PR, review, merged), from the model's ship paths.

import type { GithubSource, Profile } from "../../types";
import type { BullpenModel, ShipPath } from "../model";
import { colorFor, colorIndex } from "../profile";
import { fit, type Line, textLine, width } from "./lines";
import { age, section, text } from "./operations";
import { STUDIO } from "./studio";

/** A merged issue stays in the list this long, then only the count keeps it. */
export const SHIP_LINGER_MS = 10 * 60_000;

export type ShipRow = {
	issue: number;
	/** The stage the row is at; `working` for an issue with no PR yet. */
	stage: ShipPath["stage"];
	pr?: number;
	bounced: boolean;
	verdict?: ShipPath["verdict"];
	owners: string[];
	at: number;
};

const done = (stage: ShipRow["stage"]) =>
	stage === "merged" || stage === "shipped";

/** In-flight issues, and merged ones still lingering: needing attention first. */
export function shippingRows(model: BullpenModel, now: number): ShipRow[] {
	const rows = new Map<number, ShipRow>();
	const owners = (issue: number) => {
		const huddle = model.huddles.find((h) => h.issue === issue);
		return (
			huddle?.members ??
			Object.values(model.teammates)
				.filter((t) => t.issue === issue && t.status !== "gone")
				.map((t) => t.name)
		);
	};
	for (const path of model.ship) {
		if (done(path.stage) && now - path.at > SHIP_LINGER_MS) continue;
		rows.set(path.issue, {
			issue: path.issue,
			stage: path.stage,
			...(path.pr !== undefined ? { pr: path.pr } : {}),
			bounced: path.bounced,
			...(path.verdict ? { verdict: path.verdict } : {}),
			owners: owners(path.issue),
			at: path.at,
		});
	}
	for (const huddle of model.huddles) {
		if (
			rows.has(huddle.issue) ||
			model.closed.includes(huddle.issue) ||
			model.ship.some((p) => p.issue === huddle.issue && done(p.stage))
		)
			continue;
		rows.set(huddle.issue, {
			issue: huddle.issue,
			stage: "working",
			bounced: false,
			owners: huddle.members,
			at: huddle.lastActiveAt,
		});
	}
	return [...rows.values()].sort(
		(a, b) =>
			Number(done(a.stage)) - Number(done(b.stage)) ||
			b.at - a.at ||
			a.issue - b.issue,
	);
}

/** The path as four steps joined by bars: finished steps lit, bounces red. */
export function shipChain(row: ShipRow, pad = 0): Line {
	const idle = STUDIO.edge;
	const merged = done(row.stage);
	const hasPr = row.pr !== undefined;
	const reviewed = row.stage === "approved" || merged;
	const review: Line =
		row.verdict === "changes" && !reviewed
			? [{ text: "review ✗", fg: STUDIO.coral, bold: true }]
			: row.bounced && reviewed
				? [
						{ text: "review ", fg: STUDIO.mint },
						{ text: "✗", fg: STUDIO.coral, bold: true },
						{ text: "→✓", fg: STUDIO.mint },
					]
				: reviewed
					? [{ text: "review ✓", fg: STUDIO.mint }]
					: [
							{
								text: "review",
								fg: row.stage === "in-review" ? STUDIO.lavender : idle,
							},
						];
	const bar = (lit: boolean): Seg1 => ({
		text: " ━ ",
		fg: lit ? STUDIO.mint : idle,
	});
	const line: Line = [
		{ text: "issue", fg: row.stage === "working" ? STUDIO.amber : STUDIO.mint },
		bar(hasPr),
		{ text: hasPr ? `PR #${row.pr}` : "PR", fg: hasPr ? STUDIO.mint : idle },
		bar(row.stage !== "working" && row.stage !== "pr-open"),
		...review,
		bar(merged),
		{
			text: merged
				? `${row.stage === "shipped" ? "shipped" : "merged"} ✓`
				: "merged",
			fg: merged ? STUDIO.mint : idle,
			bold: merged,
		},
	];
	const gap = Math.max(0, pad - width(line));
	return gap ? [...line, { text: " ".repeat(gap) }] : line;
}
type Seg1 = Line[number];

/** One row per issue: `#73 title  kit  issue ━ PR #77 ━ review ✗→✓ ━ merged ✓`. */
export function shippingSection(
	model: BullpenModel,
	github: GithubSource,
	profile: Profile,
	columns: number,
	rows: number,
	now: number,
): Line[] {
	if (rows < 2) return [];
	const all = shippingRows(model, now);
	const lines: Line[] = [section("SHIPPING / path to merge", columns)];
	if (!all.length)
		return [...lines, textLine("Nothing in flight.", columns)].slice(0, rows);
	const capacity = rows - 1;
	const shown = all.slice(0, all.length > capacity ? capacity - 1 : capacity);
	const chainWidth = Math.max(...shown.map((r) => width(shipChain(r))));
	const ownerWidth = Math.min(
		12,
		Math.max(...shown.map((r) => r.owners.join(" ").length)),
	);
	const idWidth = Math.max(...shown.map((r) => `#${r.issue}`.length));
	// The title takes what the fixed columns leave; below a few cells it is dropped.
	const titles = new Map(
		github.result?.status === "ok"
			? github.result.issues.map((i) => [i.number, i.title])
			: [],
	);
	const titleWidth = titles.size
		? columns - idWidth - ownerWidth - chainWidth - 4
		: 0;
	for (const row of shown) {
		const title = titles.get(row.issue);
		const owner = row.owners.map((name) => ({
			text: `${name} `,
			fg: colorFor(name, profile, colorIndex(name)),
		}));
		const head: Line = [
			{
				text: `#${row.issue}`.padEnd(idWidth),
				fg: STUDIO.text,
				story: row.issue,
			},
			{ text: " " },
		];
		if (titleWidth >= 6) {
			const fitted = fit(text(title ?? "", STUDIO.text), titleWidth);
			head.push(...fitted, {
				text: " ".repeat(Math.max(0, titleWidth - width(fitted))),
			});
		}
		const who = fit(owner, ownerWidth);
		lines.push(
			fit(
				[
					...head,
					...who,
					{ text: " ".repeat(Math.max(0, ownerWidth - width(who) + 1)) },
					...shipChain(row, chainWidth),
				],
				columns,
			),
		);
	}
	if (shown.length < all.length)
		lines.push(textLine(`+${all.length - shown.length} more issues`, columns));
	return lines.slice(0, rows);
}

/** The lead's open asks, first under the header: at most two lines, or one calm one. */
export function needsYou(
	model: BullpenModel,
	columns: number,
	now = 0,
): Line[] {
	const asks = model.asks.filter((a) => a.open).sort((a, b) => a.at - b.at);
	const lines: Line[] = asks.slice(0, 3).map((ask) =>
		fit(
			[
				{
					text: ` ! NEEDS YOU · ${ask.from} · ${age(now, ask.at)} · ${ask.text}  [answer]`,
					fg: now - ask.at >= 600_000 ? STUDIO.coral : STUDIO.amber,
					bg: STUDIO.panel,
					ask: { from: ask.from, at: ask.at },
				},
			],
			columns,
		),
	);
	if (asks.length > 3)
		lines.push(
			textLine(` +${asks.length - 3} more decisions · a answers`, columns),
		);
	return lines;
}
