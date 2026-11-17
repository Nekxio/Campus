import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { build, loadConfigFromFile } from 'vite';

const require = createRequire(import.meta.url);

test('compiled calendars accept application dates when UI dependencies are linked', async () => {
	const root = process.cwd();
	const directory = await mkdtemp(join(tmpdir(), 'campus-calendar-identity-'));
	const datePackage = await realpath(join(root, 'node_modules/@internationalized/date'));
	const dateRequire = createRequire(join(datePackage, 'package.json'));
	await mkdir(join(directory, 'node_modules/@internationalized'), { recursive: true });
	await mkdir(join(directory, 'node_modules/@swc'), { recursive: true });
	// Reproduce the release layout: the application has a local copy, while Bits UI is linked.
	await cp(datePackage, join(directory, 'node_modules/@internationalized/date'), { recursive: true });
	await symlink(
		dirname(dateRequire.resolve('@swc/helpers/package.json')),
		join(directory, 'node_modules/@swc/helpers'),
		'dir'
	);
	await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
	const entry = join(directory, 'calendar.js');
	await writeFile(
		entry,
		`import { parseDate } from '@internationalized/date';
import { getDateValueType } from ${JSON.stringify(join(dirname(require.resolve('bits-ui')), 'internal/date-time/utils.js'))};
export const calendarDateType = () => getDateValueType(parseDate('2026-11-09'));`
	);
	const compile = async (resolve) => {
		const result = await build({
			configFile: false,
			root: directory,
			envDir: directory,
			logLevel: 'silent',
			resolve,
			build: {
				write: false,
				minify: false,
				lib: { entry, formats: ['es'] }
			}
		});
		const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output);
		const chunk = outputs.find((output) => output.type === 'chunk' && output.isEntry);
		assert.ok(chunk);
		return import('data:text/javascript;base64,' + Buffer.from(chunk.code).toString('base64'));
	};
	const duplicated = await compile({});
	assert.throws(duplicated.calendarDateType, /Unknown date type/);
	const configured = await loadConfigFromFile(
		{ command: 'build', mode: 'production' },
		join(root, 'vite.config.ts'),
		directory,
		'silent'
	);
	assert.ok(configured);
	const calendar = await compile(configured.config.resolve);
	assert.equal(calendar.calendarDateType(), 'date');
});
