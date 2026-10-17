import { expect, mock, test } from "claude-code/testing";
import { prArgv, readPr } from "../src/github";
import { buildModel } from "../src/model";
import { SHIP_LINGER_MS, shippingRows } from "../src/render/shipping";
import type { BullpenEvent, GithubSource } from "../types";

const announced: BullpenEvent = {
	version: 1,
	at: 100,
	kind: "message",
	who: "builder",
	target: "lead",
	detail: "#12 PR: https://ghe.example.com/o/r/pull/22",
	issues: [12],
};
const source: GithubSource = {
	repo: "o/r",
	host: "ghe.example.com",
	filter: "",
	burndown: [],
	checkedAt: 1000,
};

test("GitHub confirms merges from another session and finished work never returns to SHIPPING", () => {
	const pr = readPr(
		{
			exitCode: 0,
			stderr: "",
			stdout: JSON.stringify({
				number: 22,
				state: "closed",
				merged_at: "2026-10-17T14:00:00Z",
			}),
		},
		Date.parse("2026-10-17T14:01:00Z"),
	);
	expect(pr?.state).toBe("MERGED");
	const github = { ...source, prs: pr ? [pr] : [] };
	const now = pr?.checkedAt ?? 0;
	const model = buildModel([announced], now, { github });
	expect(model.ship[0]?.stage).toBe("merged");
	expect(model.shipped).toBe(1);
	expect(model.huddles).toEqual([]);
	expect(shippingRows(model, now)).toHaveLength(1);
	const later = now + SHIP_LINGER_MS + 1;
	expect(
		shippingRows(buildModel([announced], later, { github }), later),
	).toEqual([]);
	expect(prArgv("o/r", "ghe.example.com", 22)).toEqual([
		"gh",
		"api",
		"repos/o/r/pulls/22",
		"--hostname",
		"ghe.example.com",
	]);
});

test("closed unmerged PRs return to working, failed polls invent no state, and old polls cannot undo newer evidence", () => {
	const closed = readPr(
		{
			exitCode: 0,
			stderr: "",
			stdout: '{"number":22,"state":"closed","merged_at":null}',
		},
		1000,
	);
	const model = buildModel([announced], 1000, {
		github: { ...source, prs: closed ? [closed] : [] },
	});
	expect(model.ship[0]?.stage).toBe("working");
	expect(model.ship[0]?.pr).toBeUndefined();
	expect(model.shipped).toBe(0);
	expect(
		readPr({ exitCode: 1, stdout: "", stderr: "network" }, 1000),
	).toBeUndefined();
	expect(
		readPr({ exitCode: 0, stdout: "{}", stderr: "" }, 1000),
	).toBeUndefined();
	const merged = { ...announced, at: 2000, detail: "PR #22 merged" };
	expect(
		buildModel([announced, merged], 2001, {
			github: {
				...source,
				prs: [{ number: 22, state: "OPEN", checkedAt: 1000 }],
			},
		}).ship[0]?.stage,
	).toBe("merged");
});

test("a requested or failed merge never counts as shipped before confirmation", () => {
	for (const outcome of [undefined, "error"] as const) {
		const command: BullpenEvent = {
			...announced,
			kind: "tool",
			target: "Bash",
			at: 200,
			detail: "gh pr merge 22",
			outcome,
		};
		expect(buildModel([announced, command], 300).shipped).toBe(0);
	}
});

test("later review recaps cannot undo a GitHub-confirmed merge, while a replacement PR stays in flight", () => {
	const github: GithubSource = {
		...source,
		prs: [{ number: 22, state: "MERGED", checkedAt: 1000, mergedAt: 900 }],
	};
	const recap = {
		...announced,
		at: 2000,
		detail: "PR #22 (#12): PASS",
	};
	const merged = buildModel([announced, recap], 2001, { github });
	expect(merged.ship[0]?.stage).toBe("merged");
	expect(merged.ship[0]?.at).toBe(900);
	expect(merged.shipped).toBe(1);
	const replacement = {
		...announced,
		at: 3000,
		detail: "#12 PR: https://ghe.example.com/o/r/pull/24",
	};
	const reopened = buildModel([announced, recap, replacement], 3001, {
		github,
	});
	expect(reopened.ship[0]?.stage).toBe("pr-open");
	expect(reopened.ship[0]?.pr).toBe(24);
	expect(reopened.shipped).toBe(0);
});

for (const state of ["MERGED", "CLOSED"] as const) {
	test(`live poll reconciles an externally ${state.toLowerCase()} PR and retains evidence when another PR lookup fails`, async ($, on) => {
		mock.clock(on, { now: 2000 });
		on("store.get", () => ({ value: undefined }));
		on("store.set", () => ({ value: undefined }));
		const previous: GithubSource = {
			...source,
			prs: [{ number: 23, state: "OPEN", checkedAt: 500 }],
		};
		const events = [
			announced,
			{
				...announced,
				detail: "#13 PR: https://ghe.example.com/o/r/pull/23",
				issues: [13],
			},
		];
		on("state.get", { plugin: "bullpen", key: "events" }, () => ({
			value: { value: events, version: 1 },
		}));
		on("state.get", { plugin: "bullpen", key: "github" }, () => ({
			value: { value: previous, version: 1 },
		}));
		const requested: string[][] = [];
		on("process.run", (_$, e) => {
			requested.push([...e.argv]);
			const failed = e.argv[2] === "repos/o/r/pulls/23";
			const stdout =
				e.argv[1] === "issue"
					? "[]"
					: e.argv[2] === "search/issues"
						? "0"
						: JSON.stringify({
								number: 22,
								state: "closed",
								merged_at: state === "MERGED" ? "1970-01-01T00:00:01Z" : null,
							});
			return {
				value: {
					exitCode: failed ? 1 : 0,
					stdout: failed ? "" : stdout,
					stderr: failed ? "network unavailable" : "",
					isStdoutTruncated: false,
					isStderrTruncated: false,
				},
			};
		});
		let finish: (value: GithubSource) => void = () => {};
		const finished = new Promise<GithubSource>((resolve) => {
			finish = resolve;
		});
		on("state.set", { plugin: "bullpen", key: "github" }, (_$, e) => {
			finish(e.value);
			return { value: { isSet: true, version: 2 } };
		});
		await $.command.run({
			command: "bullpen",
			args: "live",
			origin: { kind: "composer" },
			presentation: { isFullscreen: false, columns: 80 },
		});
		const github = await finished;
		expect(requested).toContainEqual(prArgv("o/r", "ghe.example.com", 22));
		expect(requested).toContainEqual(prArgv("o/r", "ghe.example.com", 23));
		expect(github.prs?.find((pr) => pr.number === 23)).toEqual(
			previous.prs?.[0],
		);
		const model = buildModel(events, 2000, { github });
		expect(model.ship.find((path) => path.issue === 12)?.stage).toBe(
			state === "MERGED" ? "merged" : "working",
		);
		expect(model.shipped).toBe(state === "MERGED" ? 1 : 0);
		expect(model.ship.find((path) => path.issue === 13)?.stage).toBe("pr-open");
	});
}

test("a tracked issue closed on GitHub completes its rail without counting unrelated closed issues", () => {
	const github: GithubSource = {
		...source,
		result: {
			status: "ok",
			issues: [12, 99].map((number) => ({
				number,
				title: "issue",
				state: "closed",
				labels: [],
				assignees: [],
				closedAt: 900,
			})),
		},
	};
	const model = buildModel([announced], 1000, { github });
	expect(model.ship[0]?.stage).toBe("shipped");
	expect(model.shipped).toBe(1);
	expect(model.huddles).toEqual([]);
});
