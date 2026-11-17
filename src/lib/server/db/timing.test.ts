import { describe, expect, it } from 'vitest';
import type { Client } from '@libsql/client/web';
import { createServerTiming } from '../server-timing.js';
import { instrumentDatabaseClient } from './timing.js';

const fixture = () => {
	let elapsed = 0;
	class Connection {
		#closed = false;
		get closed() {
			return this.#closed;
		}
		close() {
			this.#closed = true;
		}
		async execute(statement: unknown) {
			if (this.#closed) throw new Error('closed');
			elapsed += 5;
			return statement;
		}
		async batch(statements: unknown) {
			return this.execute(statements);
		}
		async transaction(mode: unknown) {
			if (this.#closed) throw new Error('closed');
			elapsed += 2;
			return { ...transaction, mode };
		}
	}
	const transaction = {
		closed: false,
		async execute(statement: unknown) {
			elapsed += 3;
			return statement;
		},
		async commit() {
			elapsed += 1;
			this.closed = true;
		},
		async rollback() {
			elapsed += 1;
			this.closed = true;
		}
	};
	const client = new Connection() as unknown as Client;
	return { client, timing: createServerTiming(() => elapsed) };
};

describe('Database timing transparency', () => {
	it('preserves client receivers, statement identity and cleanup without collecting SQL', async () => {
		const { client, timing } = fixture();
		const measured = instrumentDatabaseClient(client, timing);
		const statement = { sql: 'PRIVATE SQL', args: ['PRIVATE argument'] };
		expect(await measured.execute(statement)).toBe(statement);
		expect(await measured.batch([statement])).toEqual([statement]);
		expect(timing.header()).toBe('app;dur=10.0, db;dur=10.0;desc="2 calls"');
		expect(measured.closed).toBe(false);
		measured.close();
		expect(client.closed).toBe(true);
	});

	it.each(['commit', 'rollback'] as const)('includes transaction setup, reads and %s', async (finish) => {
		const { client, timing } = fixture();
		const transaction = await instrumentDatabaseClient(client, timing).transaction('read');
		const statement = { sql: 'PRIVATE', args: [] };
		expect(await transaction.execute(statement)).toBe(statement);
		await transaction[finish]();
		expect(transaction.closed).toBe(true);
		expect(timing.header()).toBe('app;dur=6.0, db;dur=6.0;desc="3 calls"');
	});

	it('preserves driver errors and bypasses wrapping when no request timing exists', async () => {
		const { client, timing } = fixture();
		expect(instrumentDatabaseClient(client)).toBe(client);
		const measured = instrumentDatabaseClient(client, timing);
		measured.close();
		await expect(measured.execute('PRIVATE')).rejects.toThrow('closed');
		expect(timing.header()).toBe('app;dur=0.0, db;dur=0.0;desc="1 calls"');
	});
});
