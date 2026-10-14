import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const files = {
	'001': '001-final-mark-boundaries.md',
	'002': '002-expire-auth-rate-buckets.md',
	'003': '003-proposal-queue-queries.md',
	'004': '004-repeatable-browser-tests.md',
	'005': '005-recover-module-creation.md',
	'006': '006-propagate-session-cookies.md'
};
const required = [
	'## Status',
	'## Why this matters',
	'## Current state',
	'## Commands you will need',
	'## Scope',
	'## Git workflow',
	'## Steps',
	'## Test plan',
	'## Privacy and French/EU requirements',
	'## Done criteria',
	'## STOP conditions',
	'## Maintenance notes'
];

try {
	const index = await readFile(resolve(directory, 'README.md'), 'utf8');
	await readFile(resolve(directory, 'PRIVACY.md'), 'utf8');
	for (const [id, file] of Object.entries(files)) {
		const plan = await readFile(resolve(directory, file), 'utf8');
		if (!index.includes(`(${file})`)) throw new Error(`Missing index link: ${id}`);
		for (const heading of required) {
			if (!plan.includes(heading)) throw new Error(`${id}: missing ${heading}`);
		}
		if (!plan.includes('e0adfff') || !plan.includes('2026-10-13')) {
			throw new Error(`${id}: missing planning baseline`);
		}
		if (['005', '006'].includes(id) && !plan.includes('004-repeatable-browser-tests.md')) {
			throw new Error(`${id}: missing browser dependency`);
		}
	}
	const privacy = JSON.parse(await readFile(resolve(directory, 'privacy-decisions.json'), 'utf8'));
	if (privacy.decisions.length !== 6) throw new Error('Expected six privacy decisions');
	for (const decision of privacy.decisions) {
		if (!['PENDING', 'VERIFIED', 'NOT_APPLICABLE'].includes(decision.status)) {
			throw new Error(`Invalid privacy status: ${decision.id}`);
		}
		if (decision.status !== 'PENDING' && (!decision.verifiedAt || !decision.evidence)) {
			throw new Error(`Missing dated privacy evidence: ${decision.id}`);
		}
	}
	if (
		privacy.context.readyForRealStudentData &&
		privacy.decisions.some((decision) => decision.status === 'PENDING')
	) {
		throw new Error('Real-student readiness cannot have pending decisions');
	}
	const args = process.argv.slice(2);
	if (args.length) {
		if (args.length !== 2 || args[0] !== '--baseline' || !files[args[1]]) {
			throw new Error('Usage: node plans/check-plans.mjs [--baseline 001]');
		}
		const baseline = JSON.parse(await readFile(resolve(directory, 'baseline.json'), 'utf8'));
		const changed = [];
		for (const path of baseline.plans[args[1]]) {
			if (!baseline.files[path] || path.includes('..') || path.startsWith('/')) {
				throw new Error(`Invalid baseline path: ${path}`);
			}
			const bytes = await readFile(resolve(root, path));
			const hash = createHash('sha256').update(bytes).digest('hex');
			if (hash !== baseline.files[path]) changed.push(path);
		}
		if (changed.length) throw new Error(`Baseline drift: ${changed.join(', ')}`);
		console.log(`Plan ${args[1]} source baseline matches`);
	}
	console.log('Six plans, dependency references and privacy decision structure are valid');
} catch (cause) {
	console.error(cause instanceof Error ? cause.message : 'Dossier validation failed');
	process.exitCode = 1;
}
