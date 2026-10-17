import { expect, mock, test } from "claude-code/testing";
import { burndownKey, REPO_ARGV } from "../src/github";
import type { GithubSource } from "../types";

for (const scenario of [
	{ remote: "github.com", env: undefined, host: "github.com" },
	{ remote: "ghe.example.com", env: undefined, host: "ghe.example.com" },
	{ remote: "github.com", env: "ghe.example.com", host: "ghe.example.com" },
]) {
	test(`poll preserves gh's resolved host: ${scenario.remote}, GH_HOST=${scenario.env}`, async ($, on) => {
		mock.clock(on, { now: 1234 });
		mock.env(on, scenario.env ? { GH_HOST: scenario.env } : {});
		on("store.get", () => ({ value: undefined }));
		const recorded: string[][] = [];
		let storedKey = "";
		let finish: (source: GithubSource) => void = () => {};
		const finished = new Promise<GithubSource>((resolve) => {
			finish = resolve;
		});
		on("process.run", (_$, e) => {
			recorded.push([...e.argv]);
			let stdout = "[]";
			if (e.argv[1] === "repo") {
				expect(e.argv).toEqual(REPO_ARGV);
				// Fake gh resolves the inherited environment before returning its URL.
				const host = scenario.env ?? scenario.remote;
				stdout = JSON.stringify({
					nameWithOwner: "owner/repo",
					url: `https://${host}/owner/repo`,
				});
			}
			if (e.argv[1] === "api") stdout = "12";
			return {
				value: {
					exitCode: 0,
					stdout,
					stderr: "",
					isStdoutTruncated: false,
					isStderrTruncated: false,
				},
			};
		});
		on("store.set", (_$, e) => {
			storedKey = e.key;
			return { value: undefined };
		});
		on(
			"state.set",
			{ plugin: "bullpen", key: "github" },
			async (_$, e, next) => {
				const result = await next(e);
				finish(e.value);
				return result;
			},
		);
		await $.command.run({
			command: "bullpen",
			args: "live",
			origin: { kind: "composer" },
			presentation: { isFullscreen: false, columns: 80 },
		});
		const source = await finished;
		expect(source.repo).toBe("owner/repo");
		expect(source.host).toBe(scenario.host);
		expect(storedKey).toBe(burndownKey("owner/repo", "", scenario.host));
		const api = recorded.filter((argv) => argv[1] === "api");
		expect(api.length).toBe(2);
		for (const argv of api)
			expect(argv[argv.indexOf("--hostname") + 1]).toBe(scenario.host);
		expect(burndownKey("owner/repo", "", "github.com")).not.toBe(
			burndownKey("owner/repo", "", "ghe.example.com"),
		);
	});
}
