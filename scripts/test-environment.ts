import { join } from 'node:path';

export const testEnvironment = (
	source: Readonly<Record<string, string | undefined>>,
	directory: string
): NodeJS.ProcessEnv => {
	const environment: NodeJS.ProcessEnv = {};
	for (const name of [
		'PATH',
		'LANG',
		'LC_ALL',
		'CI',
		'TERM',
		'NO_COLOR',
		'FORCE_COLOR',
		'SystemRoot',
		'WINDIR',
		'ComSpec',
		'PATHEXT'
	]) {
		const value = source[name];
		if (value !== undefined) environment[name] = value;
	}
	return {
		...environment,
		NODE_ENV: 'test',
		HOME: join(directory, 'home'),
		USERPROFILE: join(directory, 'home'),
		TMPDIR: join(directory, 'temp'),
		TMP: join(directory, 'temp'),
		TEMP: join(directory, 'temp')
	};
};
