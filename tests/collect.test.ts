import { expect, test } from "claude-code/testing";
import { Batcher, InFlight } from "../src/collect";

function deferred() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test("shutdown waits for an entire producer chain before draining both batchers", async () => {
	const producers = new InFlight();
	const clock = deferred();
	const record = deferred();
	const written: string[] = [];
	const writer = new Batcher<string>(
		100,
		() => {},
		async (items) => {
			written.push(...items);
		},
	);
	const collector = new Batcher<string>(
		100,
		() => {},
		async (items) => {
			for (const item of items) writer.push(item);
		},
	);
	void producers.track(
		clock.promise.then(async () => {
			collector.push("touch");
			await record.promise;
			collector.push("last event");
		}),
	);
	let finished = false;
	const end = (async () => {
		await producers.drain();
		await collector.drain();
		await writer.drain();
		finished = true;
	})();
	await Promise.resolve();
	expect(finished).toBe(false);
	clock.release();
	await Promise.resolve();
	expect(finished).toBe(false);
	record.release();
	await end;
	expect(written).toEqual(["touch", "last event"]);
	expect(finished).toBe(true);
});

test("tracker removes settled work and tolerates rejection", async () => {
	const producers = new InFlight();
	const failure = Promise.reject(new Error("observer failed"));
	expect(producers.track(failure)).toBe(failure);
	await producers.drain();
	expect(await producers.track(Promise.resolve(42))).toBe(42);
	await producers.drain();
});

test("drain includes producers registered while waiting", async () => {
	const producers = new InFlight();
	const first = deferred();
	const second = deferred();
	void producers.track(
		first.promise.then(() => {
			void producers.track(second.promise);
		}),
	);
	let finished = false;
	const end = producers.drain().then(() => {
		finished = true;
	});
	first.release();
	await Promise.resolve();
	await Promise.resolve();
	expect(finished).toBe(false);
	second.release();
	await end;
	expect(finished).toBe(true);
});
