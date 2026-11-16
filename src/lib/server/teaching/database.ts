import type { Database } from '../db/index.js';
import { createDatabase } from '../db/index.js';
import { requireTeacher } from '../auth/access.js';
import { withPrivateClient } from '../auth/runtime.js';
import { measureServerTiming } from '../server-timing.js';
import { instrumentDatabaseClient } from '../db/timing.js';

// Future teaching services must authorize before connecting or querying private records.
export const withTeacherDatabase = <T>(
	locals: Parameters<typeof requireTeacher>[0] & Pick<App.Locals, 'serverTiming'>,
	operation: (db: Database) => Promise<T>
) => {
	requireTeacher(locals);
	return measureServerTiming(locals.serverTiming, 'data', () =>
		withPrivateClient((client) => operation(createDatabase(instrumentDatabaseClient(client, locals.serverTiming))))
	);
};
