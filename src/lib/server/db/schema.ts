import { integer, sqliteTable, text, check, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export * from './auth.schema.js';
export * from './teaching.schema.js';
export * from './annual.schema.js';

export const authRateLimit = sqliteTable(
	'auth_rate_limit',
	{
		key: text('key').primaryKey(),
		count: integer('count').notNull(),
		startedAt: integer('started_at').notNull()
	},
	(table) => [
		check('rate_limit_positive', sql`${table.count} > 0`),
		index('auth_rate_limit_started_at_key').on(table.startedAt, table.key)
	]
);
