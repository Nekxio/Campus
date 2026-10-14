import { describe, expect, it } from 'vitest';
import { previewRoster } from './roster-import.js';
describe('Roster import', () => {
	it('normalizes names and reports existing names and repeated lines', () => {
		const result = previewRoster('  Élodie   Martin\r\nJean Pierre Dupont\r\nÉlodie Martin', [
			'Jean Pierre Dupont'
		]);
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
		expect(
			previewRoster(Array.from({ length: 30 }, (_, i) => `Étudiant ${i}`).join('\n')).names
		).toHaveLength(30);
		expect(previewRoster('王 小明\nأحمد علي').names).toEqual(['王 小明', 'أحمد علي']);
	});
});
