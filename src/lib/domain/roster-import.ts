import { studentNameSchema } from './teaching.js';
export type RosterPreview = {
	names: string[];
	duplicates: string[];
	errors: { line: number; message: string }[];
};
const nameKey = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
const headerKey = (value: string) =>
	value
		.trim()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[ _-]/g, '');

// Small RFC-style reader: quoted delimiters, doubled quotes, BOM and CRLF are supported.
function readRows(source: string, delimiter: string) {
	const rows: { values: string[]; line: number }[] = [];
	let values: string[] = [];
	let cell = '';
	let quoted = false;
	let afterQuote = false;
	let line = 1;
	let rowLine = 1;
	for (let index = 0; index <= source.length; index++) {
		const char = source[index];
		if (quoted) {
			if (char === undefined) throw new Error('Une cellule CSV contient des guillemets non refermés.');
			if (char === '"') {
				if (source[index + 1] === '"') {
					cell += '"';
					index++;
				} else {
					quoted = false;
					afterQuote = true;
				}
			} else {
				cell += char;
				if (char === '\n') line++;
			}
			continue;
		}
		if (char === '"' && cell === '' && !afterQuote) {
			quoted = true;
			continue;
		}
		if (char === delimiter || char === '\n' || char === undefined) {
			values.push(cell.replace(/\r$/, ''));
			cell = '';
			afterQuote = false;
			if (char !== delimiter) {
				if (values.some((v) => v.trim())) rows.push({ values, line: rowLine });
				values = [];
				line++;
				rowLine = line;
			}
		} else if (afterQuote && !/\s/.test(char))
			throw new Error('Séparateur CSV manquant après une cellule entre guillemets.');
		else if (!afterQuote) cell += char;
	}
	return rows;
}
export function previewRoster(source: string, existingNames: string[] = []): RosterPreview {
	const result: RosterPreview = { names: [], duplicates: [], errors: [] };
	if (source.length > 200000) return { ...result, errors: [{ line: 1, message: 'La liste est trop volumineuse.' }] };
	const clean = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
	const first = clean.split('\n').find((line) => line.trim()) ?? '';
	const delimiter = [';', '\t', ','].find((d) => first.includes(d)) ?? '\u0000';
	let rows: ReturnType<typeof readRows>;
	try {
		rows = readRows(clean, delimiter);
	} catch (cause) {
		return {
			...result,
			errors: [{ line: 1, message: cause instanceof Error ? cause.message : 'La liste ne peut pas être lue.' }]
		};
	}
	if (!rows.length) return { ...result, errors: [{ line: 1, message: 'Ajoutez au moins un nom.' }] };
	const headers = rows[0].values.map(headerKey);
	const full = headers.findIndex((h) => ['nomcomplet', 'fullname', 'name', 'etudiant'].includes(h));
	const last = headers.findIndex((h) => ['nom', 'lastname'].includes(h));
	const firstName = headers.findIndex((h) => ['prenom', 'firstname'].includes(h));
	const hasHeader = full >= 0 || (last >= 0 && firstName >= 0) || (headers.length === 1 && last === 0);
	if (hasHeader) rows.shift();
	if (rows.length > 1000)
		return {
			...result,
			errors: [{ line: 1, message: 'Importez au plus 1 000 lignes à la fois.' }]
		};
	if (!hasHeader && rows.some((r) => r.values.length !== 1))
		return {
			...result,
			errors: [
				{
					line: rows[0].line,
					message: 'Pour plusieurs colonnes, ajoutez un en-tête « nom complet » ou « prénom » et « nom ».'
				}
			]
		};
	const seen = new Set(existingNames.map(nameKey));
	for (const row of rows) {
		let name =
			full >= 0
				? row.values[full]
				: firstName >= 0 && last >= 0
					? `${row.values[firstName] ?? ''} ${row.values[last] ?? ''}`
					: row.values[0];
		if (hasHeader && row.values.length !== headers.length) {
			result.errors.push({ line: row.line, message: 'Nombre de colonnes incorrect.' });
			continue;
		}
		if (firstName >= 0 && last >= 0 && (!row.values[firstName]?.trim() || !row.values[last]?.trim())) name = '';
		const parsed = studentNameSchema.safeParse(name);
		if (!parsed.success) result.errors.push({ line: row.line, message: 'Le nom est vide ou dépasse 200 caractères.' });
		else if (seen.has(nameKey(parsed.data))) result.duplicates.push(parsed.data);
		else {
			seen.add(nameKey(parsed.data));
			result.names.push(parsed.data);
		}
	}
	return result;
}
