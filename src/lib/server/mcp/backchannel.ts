import type { DBAdapter, DBTransactionAdapter } from 'better-auth/adapters';

function withoutDestination<T>(value: T): T {
	if (value && typeof value === 'object' && 'backchannelLogoutUri' in value)
		return { ...value, backchannelLogoutUri: null };
	return value;
}

// Back-channel logout is outside the native MCP contract. Mask the destination
// on provider reads, including historical rows, without changing stored clients
// or the provider's session deletion and token-revocation hooks.
export function withoutBackchannelLogout(adapter: DBAdapter): DBAdapter;
export function withoutBackchannelLogout(adapter: DBTransactionAdapter): DBTransactionAdapter;
export function withoutBackchannelLogout(adapter: DBAdapter | DBTransactionAdapter): DBAdapter | DBTransactionAdapter {
	const reads: DBTransactionAdapter = {
		...adapter,
		async findOne<T>(query: Parameters<DBTransactionAdapter['findOne']>[0]) {
			const value = await adapter.findOne<T>(query);
			return query.model === 'oauthClient' ? withoutDestination(value) : value;
		},
		async findMany<T>(query: Parameters<DBTransactionAdapter['findMany']>[0]) {
			const values = await adapter.findMany<T>(query);
			return query.model === 'oauthClient' ? values.map(withoutDestination) : values;
		}
	};
	if ('transaction' in adapter)
		return {
			...reads,
			transaction: (callback) => adapter.transaction((transaction) => callback(withoutBackchannelLogout(transaction)))
		};
	return reads;
}
