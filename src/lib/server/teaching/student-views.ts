import { isHttpError } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { classes, teachingContexts, publicClassLinks, publicModuleLinks } from '../db/schema.js';
import { publicClassPath, publicModulePath } from '../../domain/publication.js';
import { getPublicClass, getPublicModule } from './publications.js';

type Store = Pick<Database, 'select'>;

async function available<T>(read: () => Promise<T>): Promise<T | null> {
	try {
		return await read();
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) return null;
		throw cause;
	}
}

// Private navigation uses the same validated public readers as the student pages.
export async function listPublishedClasses(db: Store) {
	const rows = await db
		.select({ id: classes.id, publicId: publicClassLinks.id })
		.from(classes)
		.leftJoin(publicClassLinks, eq(publicClassLinks.classId, classes.id));
	const links = [];
	for (const row of rows) {
		const id = row.publicId ?? row.id;
		const directory = await available(() => getPublicClass(db, id));
		if (!directory?.className || !directory.academicYear) continue;
		let moduleCount = 0;
		for (const module of directory.modules) {
			if (await available(() => getPublicModule(db, module.contextId))) moduleCount++;
		}
		if (!moduleCount) continue;
		links.push({
			publicId: id,
			publicPath: publicClassPath(id),
			className: directory.className,
			academicYear: directory.academicYear,
			moduleCount
		});
	}
	return links.sort(
		(a, b) =>
			b.academicYear.localeCompare(a.academicYear) || a.className.localeCompare(b.className, 'fr')
	);
}

export async function getPublishedModulePath(db: Store, moduleId: string) {
	const rows = await db
		.select({ id: teachingContexts.id, publicId: publicModuleLinks.id })
		.from(teachingContexts)
		.leftJoin(
			publicModuleLinks,
			and(
				eq(publicModuleLinks.moduleId, teachingContexts.moduleId),
				eq(publicModuleLinks.contextId, teachingContexts.id)
			)
		)
		.where(and(eq(teachingContexts.moduleId, moduleId), isNull(teachingContexts.archivedAt)))
		.orderBy(asc(teachingContexts.id));
	for (const row of rows) {
		const id = row.publicId ?? row.id;
		if (await available(() => getPublicModule(db, id))) return publicModulePath(id);
	}
	return null;
}
