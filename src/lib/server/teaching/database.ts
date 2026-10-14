import type { Database } from '../db/index.js';
import { createDatabase } from '../db/index.js';
import { requireTeacher } from '../auth/access.js';
import { withAuth } from '../auth/runtime.js';

// Future teaching services must authorize before connecting or querying private records.
export function withTeacherDatabase<T>(
	locals: Parameters<typeof requireTeacher>[0],
	operation: (db: Database) => Promise<T>
) {
	requireTeacher(locals);
	return withAuth((_auth, client) => operation(createDatabase(client)));
}
