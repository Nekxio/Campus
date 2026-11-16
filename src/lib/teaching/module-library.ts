import type { ModuleSummary } from './types.js';

export type ModuleLibraryFilter = 'all' | 'review' | 'unassigned' | 'paused';

export const filterModules = (
	modules: ModuleSummary[],
	query: string,
	filter: ModuleLibraryFilter
): ModuleSummary[] => {
	const search = query.trim().toLocaleLowerCase('fr');
	return modules.filter((module) => {
		const matchesState =
			filter === 'all' ||
			(filter === 'review' && module.needsReview) ||
			(filter === 'unassigned' && module.classes.length === 0) ||
			(filter === 'paused' && module.paused);
		const searchable = [module.title, ...module.classes.flatMap((item) => [item.name, item.academicYear])]
			.join(' ')
			.toLocaleLowerCase('fr');
		return Boolean(matchesState) && searchable.includes(search);
	});
};
