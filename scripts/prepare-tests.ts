import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testEnvironment } from './test-environment.ts';

const directory = mkdtempSync(join(realpathSync(tmpdir()), 'campus-tests-'));
const environment = testEnvironment(process.env, directory);
for (const name of ['home', 'temp']) mkdirSync(join(directory, name), { mode: 0o700 });
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, environment);

// Workers inherit this prepared environment and must keep their runner-specific variables.
process.execArgv = process.execArgv.filter(
	(argument) => !argument.startsWith('--import=') || pathToFileURL(resolve(argument.slice(9))).href !== import.meta.url
);
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
