import type { Client, Transaction } from '@libsql/client/web';
import type { ServerTiming } from '../server-timing.js';

const measuredMethods = new Set<PropertyKey>([
	'execute',
	'batch',
	'executeMultiple',
	'migrate',
	'sync',
	'commit',
	'rollback'
]);

const instrumentCalls = <T extends Client | Transaction>(connection: T, timing: ServerTiming): T => {
	const methods = new Map<PropertyKey, unknown>();
	return new Proxy(connection, {
		get: (target, key) => {
			// libSQL uses private fields: methods and getters must receive the original connection.
			const member = Reflect.get(target, key, target);
			if (typeof member !== 'function') return member;
			if (!methods.has(key)) {
				const invoke = (...args: unknown[]): unknown => Reflect.apply(member, target, args);
				const measured = (...args: unknown[]) => timing.measure('db', () => invoke(...args) as Promise<unknown>);
				methods.set(
					key,
					key === 'transaction'
						? async (...args: unknown[]) => instrumentCalls((await measured(...args)) as Transaction, timing)
						: measuredMethods.has(key)
							? measured
							: invoke
				);
			}
			return methods.get(key);
		}
	});
};

export const instrumentDatabaseClient = (client: Client, timing?: ServerTiming): Client =>
	timing ? instrumentCalls(client, timing) : client;
