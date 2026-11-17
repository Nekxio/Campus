import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRequire = createRequire(import.meta.url);
const eslintRequire = createRequire(projectRequire.resolve('eslint'));
const minimatchEntry = eslintRequire.resolve('minimatch');

// Exercise the installed transitive package, so removing the pnpm patch breaks these regressions.
describe('minimatch security backport', () => {
	for (const [format, entry] of [
		['CommonJS', minimatchEntry],
		['ESM', join(dirname(minimatchEntry), '../esm/index.js')]
	]) {
		it(`bounds pattern amplification (${format})`, async () => {
			const { Minimatch } = await import(pathToFileURL(entry).href);
			const pattern = Array(8).fill('**/../a/b').join('/');
			expect(new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 }).set).toHaveLength(64);
			const defaultLimitPattern = Array(17).fill('**/../a/b').join('/');
			expect(new Minimatch(defaultLimitPattern, { optimizationLevel: 2 }).set).toHaveLength(100_000);
		}, 20_000);

		it(`preserves ordinary matching and skips quadratic large-set deduplication (${format})`, async () => {
			const { Minimatch } = await import(pathToFileURL(entry).href);
			const ordinary = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
			expect(ordinary.set).toHaveLength(4);
			expect(ordinary.match('../a/b/../c/d')).toBe(true);
			expect(ordinary.match('x/a/b/y/c/d')).toBe(true);
			const small = new Minimatch('{x,*}/{0..9}', { optimizationLevel: 2 });
			expect(small.set).toHaveLength(10);
			const large = new Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
			expect(large.set).toHaveLength(2000);
			expect(large.match('y/999')).toBe(true);
			expect(large.match('.y/5')).toBe(false);
			for (const optimizationLevel of [0, 1, 2]) {
				const normal = new Minimatch('src/**/*.ts', { optimizationLevel });
				expect(normal.match('src/routes/index.ts')).toBe(true);
				expect(normal.match('src/.private/index.ts')).toBe(false);
				expect(normal.match('src/routes/index.js')).toBe(false);
				expect(new Minimatch('src/Exact.ts', { optimizationLevel }).match('src/exact.ts')).toBe(false);
				expect(new Minimatch('src/Exact.ts', { optimizationLevel, nocase: true }).match('src/exact.ts')).toBe(true);
				expect(new Minimatch('a/../b', { optimizationLevel }).match('a/../b')).toBe(optimizationLevel !== 1);
				expect(new Minimatch('a/../b', { optimizationLevel }).match('b')).toBe(optimizationLevel !== 0);
			}
		});
	}
});
