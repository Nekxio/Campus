import { fork } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { FixtureOperation, FixtureReady } from '../../../scripts/browser-fixture.js';
import { fixtureEnvironment } from './fixture-copy.js';

export class FixtureStartupError extends Error {
	constructor(readonly directory?: string) {
		super('Fictional fixture startup failed.');
	}
}
export async function startFixture(failAfterCopy = false) {
	const child = fork(
		fileURLToPath(new URL('../../../scripts/browser-fixture.ts', import.meta.url)),
		failAfterCopy ? ['--fail-after-copy'] : [],
		{
			execArgv: ['--import', 'tsx'],
			env: fixtureEnvironment({ WRANGLER_SEND_METRICS: 'false' }),
			stdio: ['ignore', 'ignore', 'ignore', 'ipc']
		}
	);
	let allocatedDirectory: string | undefined;
	const exited = new Promise<void>((done) => child.once('exit', () => done()));
	let cleanupPromise: Promise<void> | undefined;
	function cleanup() {
		cleanupPromise ??= (async () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill('SIGTERM');
				// The child allows Vite five seconds, then awaits its exit and removes owned files.
				await Promise.race([exited, delay(15000)]);
				if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
			}
			await exited;
			if (allocatedDirectory) {
				if (
					dirname(allocatedDirectory) !== resolve('.svelte-kit/browser-fixture') ||
					!basename(allocatedDirectory).startsWith('run-')
				)
					throw new Error('Unowned fixture cleanup path refused.');
				await rm(allocatedDirectory, { recursive: true, force: true });
			}
		})();
		return cleanupPromise;
	}
	const ready = await new Promise<FixtureReady>((done, reject) => {
		const timeout = setTimeout(() => {
			void cleanup().finally(() => reject(new FixtureStartupError(allocatedDirectory)));
		}, 120000);
		function receive(message: { type: string; value?: FixtureReady; directory?: string }) {
			if (message.type === 'allocated') {
				allocatedDirectory = message.directory;
				return;
			}
			clearTimeout(timeout);
			child.off('message', receive);
			if (message.type === 'ready' && message.value) done(message.value);
			else void cleanup().finally(() => reject(new FixtureStartupError(allocatedDirectory)));
		}
		child.on('message', receive);
		const fail = () => {
			clearTimeout(timeout);
			void cleanup().finally(() => reject(new FixtureStartupError(allocatedDirectory)));
		};
		child.once('error', fail);
		child.once('exit', fail);
	});
	let sequence = 0;
	let stopping: Promise<unknown> | undefined;
	const call = <T = unknown>(operation: FixtureOperation) =>
		new Promise<T>((done, reject) => {
			const id = ++sequence;
			const timeout = setTimeout(() => {
				detach();
				void cleanup().finally(() => reject(new Error('Fictional fixture command timed out.')));
			}, 30000);
			function detach() {
				clearTimeout(timeout);
				child.off('message', receive);
				child.off('exit', fail);
				child.off('disconnect', fail);
			}
			function fail() {
				detach();
				void cleanup().finally(() => reject(new Error('Fictional fixture process ended.')));
			}
			function receive(message: { id?: number; value: T; error?: string }) {
				if (message.id !== id) return;
				detach();
				if (message.error) reject(new Error('Fictional fixture operation failed.'));
				else done(message.value);
			}
			child.on('message', receive);
			child.once('exit', fail);
			child.once('disconnect', fail);
			if (!child.connected) fail();
			else
				child.send({ id, operation }, (error) => {
					if (error) fail();
				});
		});
	return { ...ready, call, stop: () => (stopping ??= call('stop').finally(cleanup)) };
}
export type BrowserFixture = Awaited<ReturnType<typeof startFixture>>;
