import { describe, expect, it } from 'vitest';
import { filterModules } from './module-library.js';
import type { ModuleSummary } from './types.js';

const modules: ModuleSummary[] = [
	{
		id: 'one',
		title: 'Accessibilité',
		description: '',
		revision: 1,
		resourceCount: 0,
		needsReview: true,
		classes: [{ id: 'a', name: 'Design B3', academicYear: '2026-2027' }]
	},
	{
		id: 'two',
		title: 'Archives',
		description: '',
		revision: 1,
		resourceCount: 0,
		paused: true,
		classes: []
	}
];
describe('module library work filters', () => {
	it('finds a module by title, class or academic year without changing the source', () => {
		expect(filterModules(modules, ' ACCESSIBILITÉ ', 'all')).toEqual([modules[0]]);
		expect(filterModules(modules, 'design b3', 'all')).toEqual([modules[0]]);
		expect(filterModules(modules, '2026', 'all')).toEqual([modules[0]]);
		expect(modules).toHaveLength(2);
	});
	it('combines the search with explicit work states', () => {
		expect(filterModules(modules, '', 'review')).toEqual([modules[0]]);
		expect(filterModules(modules, '', 'unassigned')).toEqual([modules[1]]);
		expect(filterModules(modules, 'Design', 'paused')).toEqual([]);
	});
});
