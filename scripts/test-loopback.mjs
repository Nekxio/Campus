import { listenLoopbackFixture as listen } from './test-isolation.mjs';

/**
 * @typedef {Readonly<{
 *   env: Record<string, string>,
 *   revoke: () => void,
 *   close: () => void
 * }>} FixtureChildEnvironment
 */

/**
 * @typedef {Readonly<{
 *   origin: string,
 *   childEnvironment: (source: Readonly<Record<string, string | undefined>>, values?: Record<string, string>) => FixtureChildEnvironment,
 *   close: () => Promise<void>
 * }>} LoopbackFixture
 */

/**
 * Explicitly owns one ephemeral IPv4 endpoint. Child grants are single-use, PID-bound
 * and checked against a live receipt on every operation; close children before revoking.
 * No native networking primitive is exposed by this helper.
 * @param {import('node:http').Server | import('node:net').Server} server
 * @returns {Promise<LoopbackFixture>}
 */
export function listenLoopbackFixture(server) {
	return listen(server);
}
