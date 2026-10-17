import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { classes, modules, teachingContexts } from './teaching.schema.js';

// Public identities outlive annual rosters. They never contain student information.
export const publicClassLinks = sqliteTable(
	'public_class_link',
	{
		id: text('id').primaryKey(),
		classId: text('class_id').references(() => classes.id, { onDelete: 'set null' })
	},
	(table) => [uniqueIndex('public_class_current_unique').on(table.classId)]
);
export const publicModuleLinks = sqliteTable(
	'public_module_link',
	{
		id: text('id').primaryKey(),
		moduleId: text('module_id')
			.notNull()
			.references(() => modules.id, { onDelete: 'restrict' }),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'restrict' }),
		publishedContextId: text('published_context_id').references(() => teachingContexts.id, {
			onDelete: 'restrict'
		}),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true)
	},
	(table) => [uniqueIndex('public_module_current_unique').on(table.contextId)]
);
