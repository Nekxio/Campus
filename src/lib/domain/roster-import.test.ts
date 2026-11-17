import { describe, expect, it } from 'vitest';
import { previewRoster } from './roster-import.js';
describe('Roster import', () => {
	it('normalizes names and reports existing names and repeated lines', () => {
		const result = previewRoster('  Élodie   Martin\r\nJean Pierre Dupont\r\nÉlodie Martin', ['Jean Pierre Dupont']);
		expect(result.names).toEqual(['Élodie Martin']);
		expect(result.duplicates).toEqual(['Jean Pierre Dupont', 'Élodie Martin']);
		expect(result.errors).toEqual([]);
	});
	it('reads BOM, accented headers, extra columns, CSV quoting and escaped quotes', () => {
		const result = previewRoster(
			'\uFEFFPrénom;Nom;Email\nÉlodie;Martin;a@example.test\n"Jean; Pierre";"Du""pont";b@example.test'
		);
		expect(result.names).toEqual(['Élodie Martin', 'Jean; Pierre Du"pont']);
		expect(result.errors).toEqual([]);
	});
	it('reads a single full name column and tab-delimited first/last names', () => {
		expect(previewRoster('nom complet\n"Martin, Élodie"').names).toEqual(['Martin, Élodie']);
		expect(previewRoster('prénom\tnom\nLéo\tHilaire').names).toEqual(['Léo Hilaire']);
	});
	it('blocks malformed and ambiguous multi-column inputs instead of guessing', () => {
		expect(previewRoster('Alice,Martin\nBenoît,Petit').errors).toHaveLength(1);
		expect(previewRoster('nom complet\n"Alice').errors).toHaveLength(1);
		expect(previewRoster('prénom;nom\nAlice;').errors).toHaveLength(1);
		expect(previewRoster('prénom;nom\nAlice;Martin;extra').errors).toHaveLength(1);
	});
	it('supports more than twelve students and preserves non-Latin names', () => {
		expect(previewRoster(Array.from({ length: 30 }, (_, i) => `Étudiant ${i}`).join('\n')).names).toHaveLength(30);
		expect(previewRoster('王 小明\nأحمد علي').names).toEqual(['王 小明', 'أحمد علي']);
	});
	it.each(['', ' \r\n \r\n'])('reports an empty pasted list: %j', (source) => {
		expect(previewRoster(source)).toEqual({
			names: [],
			duplicates: [],
			errors: [{ line: 1, message: expect.stringMatching(/\S/) }]
		});
	});
	it('deduplicates equivalent Unicode names independently of case and spacing', () => {
		const result = previewRoster('E\u0301lodie Martin\nALICE DURAND\nAlice   Durand', [' ÉLODIE   MARTIN ']);
		expect(result.names).toEqual(['ALICE DURAND']);
		expect(result.duplicates).toHaveLength(2);
		expect(result.errors).toEqual([]);
	});
	it.each([
		['Jean Pierre', 'JeanPierre'],
		['Straße', 'Strasse']
	])('preserves distinct student names %s and %s', (first, second) => {
		expect(previewRoster(`${first}\n${second}`)).toEqual({
			names: [first, second],
			duplicates: [],
			errors: []
		});
	});
	it.each([' Nom_complet ', 'full-name', 'Name', 'Étudiant'])(
		'finds the %j column among unrelated CSV columns',
		(header) => {
			expect(previewRoster(`Email;${header};Group\na@example.test;Alice Martin;B2`)).toEqual({
				names: ['Alice Martin'],
				duplicates: [],
				errors: []
			});
		}
	);
	it('reads English first and last name headers in either column order', () => {
		expect(previewRoster('last_name,first-name\nMartin,Alice').names).toEqual(['Alice Martin']);
		expect(previewRoster('first-name,last_name\nAlice,Martin').names).toEqual(['Alice Martin']);
	});
	it('reports the physical row after a quoted multiline name', () => {
		const result = previewRoster('prénom;nom\n"Alice\nAnne";Martin\nBob;');
		expect(result.names).toEqual(['Alice Anne Martin']);
		expect(result.errors).toEqual([{ line: 4, message: expect.stringMatching(/\S/) }]);
	});
	it('accepts whitespace after a quoted cell but rejects missing separators', () => {
		expect(previewRoster('nom complet\n"Alice Martin"  \n')).toEqual({
			names: ['Alice Martin'],
			duplicates: [],
			errors: []
		});
		const malformed = previewRoster('nom complet\n"Alice"Martin');
		expect(malformed.names).toEqual([]);
		expect(malformed.errors).toEqual([expect.objectContaining({ message: expect.stringMatching(/\S/) })]);
	});
	it.each(['', 'nom complet\n'])(
		'accepts a thousand students and rejects an additional student atomically with header %j',
		(header) => {
			const names = Array.from({ length: 1000 }, (_, index) => `Student ${index}`);
			const source = `${header}${names.join('\n')}`;
			expect(previewRoster(source)).toEqual({ names, duplicates: [], errors: [] });
			const oversized = previewRoster(`${source}\nStudent 1000`);
			expect(oversized).toEqual({
				names: [],
				duplicates: [],
				errors: [{ line: 1, message: expect.stringMatching(/\S/) }]
			});
		}
	);
	it.each(['', 'nom complet\n'])('counts imported rows before deduplicating names with header %j', (header) => {
		const names = Array.from({ length: 1000 }, (_, index) => `Student ${index}`);
		const source = `${header}${[...names, 'Student 0'].join('\n')}`;
		expect(previewRoster(source, ['Student 1'])).toEqual({
			names: [],
			duplicates: [],
			errors: [{ line: 1, message: expect.stringMatching(/\S/) }]
		});
	});
	it('enforces the pasted-text size limit without rejecting its exact boundary', () => {
		const names = Array.from({ length: 1000 }, (_, index) => `Student ${index} `.padEnd(199, 'a'));
		const source = `${names.join('\n')}\n`;
		expect(previewRoster(source)).toEqual({ names, duplicates: [], errors: [] });
		const oversized = previewRoster(`${source}\n`);
		expect(oversized.names).toEqual([]);
		expect(oversized.errors).toEqual([{ line: 1, message: expect.stringMatching(/\S/) }]);
	});
});
