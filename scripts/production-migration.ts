import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client/web';
import { productionMigrationEntries } from './production-migration-manifest.js';

export const migrationTarget = 'libsql://coursely-prod-nekxio.aws-eu-west-1.turso.io';
export const migrationConfirmation = 'APPLIQUER 0011 COURSELY-PROD';
const triggerName = 'coursely_bound_unused_oauth_clients';
const messages = {
	plan: 'Arrêt : les migrations locales ne correspondent pas au lot 0000–0011 vérifié.',
	journal: 'Arrêt : journal ou trigger distant inattendu. Aucune mise à jour autorisée.',
	schema: 'Arrêt : schéma distant inattendu. Aucune mise à jour autorisée.',
	cancel: 'Annulé : confirmation exacte absente. Aucune écriture.',
	data: 'Arrêt : les compteurs applicatifs ont changé dans la transaction. Annulation.',
	remote:
		'Opération non confirmée. Relancer la même commande pour vérifier le journal avant toute autre action.',
	tty: 'Lancer personnellement dans un terminal interactif, sans argument, redirection ni journal de session.'
};
export class ProductionMigrationError extends Error {
	constructor(readonly code: keyof typeof messages) {
		super(messages[code]);
	}
}
export function migrationMessage(error: unknown) {
	return error instanceof ProductionMigrationError ? error.message : messages.remote;
}
type Query = Pick<Client, 'execute'>;
export type ProductionMigrationPlan = {
	entries: ReadonlyArray<{ tag: string; hash: string; createdAt: number }>;
	sql: string;
};
export function loadProductionMigrationPlan(
	folder = fileURLToPath(new URL('../drizzle/', import.meta.url))
): ProductionMigrationPlan {
	try {
		const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
			entries: { idx: number; tag: string; when: number }[];
		};
		if (journal.entries.length !== productionMigrationEntries.length) throw new Error();
		for (const [index, expected] of productionMigrationEntries.entries()) {
			const entry = journal.entries[index];
			if (entry.idx !== index || entry.tag !== expected.tag || entry.when !== expected.createdAt)
				throw new Error();
			const bytes = readFileSync(resolve(folder, expected.tag + '.sql'));
			if (createHash('sha256').update(bytes).digest('hex') !== expected.hash) throw new Error();
		}
		return {
			entries: productionMigrationEntries,
			sql: readFileSync(resolve(folder, productionMigrationEntries.at(-1)!.tag + '.sql'), 'utf8')
		};
	} catch {
		throw new ProductionMigrationError('plan');
	}
}
const normalizeSql = (sql: string) =>
	sql
		.replace(/^\s*--.*$/gm, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/;$/, '');
async function state(query: Query, plan: ProductionMigrationPlan) {
	const rows = (
		await query.execute('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
	).rows;
	if (
		![11, 12].includes(rows.length) ||
		rows.some(
			(row, index) =>
				row.hash !== plan.entries[index]?.hash ||
				Number(row.created_at) !== plan.entries[index]?.createdAt
		)
	)
		throw new ProductionMigrationError('journal');
	const triggers = (
		await query.execute({
			sql: "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
			args: [triggerName]
		})
	).rows;
	if (rows.length === 11 && triggers.length === 0) return 'pending';
	if (
		rows.length === 12 &&
		triggers.length === 1 &&
		normalizeSql(String(triggers[0].sql)) === normalizeSql(plan.sql)
	)
		return 'applied';
	throw new ProductionMigrationError('journal');
}
async function tableCounts(query: Query) {
	const tables = (
		await query.execute(
			"SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name"
		)
	).rows.map((row) => String(row.name));
	if (
		![
			'user',
			'verification',
			'oauth_client',
			'oauth_consent',
			'oauth_access_token',
			'oauth_refresh_token'
		].every((name) => tables.includes(name))
	)
		throw new ProductionMigrationError('schema');
	const counts: Record<string, number> = {};
	for (const name of tables) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new ProductionMigrationError('schema');
		counts[name] = Number((await query.execute(`SELECT COUNT(*) AS n FROM "${name}"`)).rows[0].n);
		if (!Number.isSafeInteger(counts[name])) throw new ProductionMigrationError('schema');
	}
	return counts;
}
export async function upgradeProduction0011({
	client,
	plan,
	confirm,
	log = () => {}
}: {
	client: Client;
	plan: ProductionMigrationPlan;
	confirm: () => Promise<string>;
	log?: (message: string) => void;
}) {
	try {
		if ((await state(client, plan)) === 'applied') {
			log('0011 déjà appliquée : journal et trigger vérifiés. Aucune écriture.');
			return 'already-applied' as const;
		}
		await tableCounts(client);
		log('Journal 0000–0010 vérifié. Mise à jour 0011 uniquement ; données existantes conservées.');
		if ((await confirm()) !== migrationConfirmation) throw new ProductionMigrationError('cancel');
		const tx = await client.transaction('write');
		try {
			if ((await state(tx, plan)) === 'applied') {
				await tx.rollback();
				log('0011 a déjà été appliquée : journal et trigger vérifiés. Aucune écriture.');
				return 'already-applied' as const;
			}
			const before = await tableCounts(tx);
			await tx.execute(plan.sql);
			const latest = plan.entries.at(-1)!;
			await tx.execute({
				sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
				args: [latest.hash, latest.createdAt]
			});
			if ((await state(tx, plan)) !== 'applied') throw new ProductionMigrationError('journal');
			if (JSON.stringify(await tableCounts(tx)) !== JSON.stringify(before))
				throw new ProductionMigrationError('data');
			await tx.commit();
			log(
				'0011 appliquée : douze empreintes et dates conformes, trigger vérifié, compteurs applicatifs inchangés.'
			);
			return 'applied' as const;
		} catch (error) {
			try {
				await tx.rollback();
			} catch {
				/* The commit response may have been lost. */
			}
			throw error;
		} finally {
			tx.close();
		}
	} catch (error) {
		throw error instanceof ProductionMigrationError
			? error
			: new ProductionMigrationError('remote');
	}
}
export function productionMigrationFetch(request: typeof fetch = fetch): typeof fetch {
	return async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : input);
		if (
			url.protocol !== 'https:' ||
			url.hostname !== new URL(migrationTarget).hostname ||
			url.port ||
			url.username ||
			url.password
		)
			throw new ProductionMigrationError('remote');
		return request(input, {
			...init,
			redirect: 'error',
			credentials: 'omit',
			signal: AbortSignal.timeout(30000)
		});
	};
}
async function answer(prompt: string, hidden = false) {
	const output = hidden
		? new Writable({
				write(_chunk, _encoding, done) {
					done();
				}
			})
		: process.stdout;
	const reader = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
	const abort = new AbortController();
	reader.on('SIGINT', () => abort.abort());
	try {
		if (hidden) process.stdout.write(prompt);
		return await reader.question(hidden ? '' : prompt, { signal: abort.signal });
	} finally {
		reader.close();
		if (hidden) process.stdout.write('\n');
	}
}
async function main() {
	if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY)
		throw new ProductionMigrationError('tty');
	const plan = loadProductionMigrationPlan();
	console.log('Cible unique : ' + migrationTarget);
	let client: Client;
	{
		const token = (await answer('Jeton Turso RW de cette base (saisie masquée) : ', true)).trim();
		if (!token) throw new ProductionMigrationError('cancel');
		client = createClient({
			url: migrationTarget,
			authToken: token,
			fetch: productionMigrationFetch()
		});
	}
	try {
		await upgradeProduction0011({
			client,
			plan,
			confirm: () =>
				answer('Pour appliquer uniquement 0011, taper ' + migrationConfirmation + ' : '),
			log: console.log
		});
	} finally {
		try {
			client.close();
		} catch {
			/* No SDK error details in operator logs. */
		}
	}
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error) => {
		console.error(migrationMessage(error));
		process.exitCode = 1;
	});
}
