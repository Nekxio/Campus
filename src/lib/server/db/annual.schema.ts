import { sqliteTable, text, integer, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth.schema.js';
import type { AnnualReceipt } from '../../domain/annual.js';

// No class names, student identities or correction bodies survive in these lifecycle records.
export const academicYears = sqliteTable(
	'academic_year_lifecycle',
	{
		academicYear: text('academic_year').primaryKey(),
		archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
		purgedAt: integer('purged_at', { mode: 'timestamp_ms' }),
		revision: integer('revision').notNull().default(1)
	},
	(table) => [
		check('year_revision_positive', sql`${table.revision} > 0`),
		check('purged_year_archived', sql`${table.purgedAt} IS NULL OR ${table.archivedAt} IS NOT NULL`)
	]
);
export const annualReceipts = sqliteTable(
	'annual_receipt',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		requestId: text('request_id').notNull(),
		fingerprint: text('fingerprint').notNull(),
		receipt: text('receipt', { mode: 'json' }).$type<AnnualReceipt>().notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [uniqueIndex('annual_teacher_request_unique').on(table.teacherId, table.requestId)]
);
