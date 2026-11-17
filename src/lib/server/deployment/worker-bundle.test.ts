import { expect, it } from 'vitest';
import { inspectBundleMetadata } from '../../../../scripts/worker-dry-run.js';
it('checks every Worker output size before summing bundle metadata', () => {
	expect(
		inspectBundleMetadata({
			inputs: { 'worker.ts': {} },
			outputs: { 'worker.js': { bytes: 100 }, 'worker.js.map': { bytes: 200 } }
		})
	).toEqual({ inputs: ['worker.ts'], bytes: 100 });
	for (const bytes of [-1, '100', null, 0.5]) {
		expect(() =>
			inspectBundleMetadata({
				inputs: {},
				outputs: { 'first.js': { bytes: 200 }, 'second.js': { bytes } }
			})
		).toThrow();
	}
});

it.each([
	'node_modules/pdfmake/build/pdfmake.js',
	'node_modules/@foliojs-fork/pdfkit/js/pdfkit.js',
	'node_modules/pdfmake/build/vfs_fonts.js'
])('rejects browser-only PDF dependencies in the Worker: %s', (path) => {
	expect(() =>
		inspectBundleMetadata({
			inputs: { [path]: {} },
			outputs: { 'worker.js': { bytes: 100 } }
		})
	).toThrow('Bibliothèque PDF navigateur présente dans le bundle Worker');
});
