import { describe, expect, it } from 'vitest';
import type { PublicationSnapshot } from '#lib/domain/publication.js';
import { selectRailDeadline } from './course-presentation.js';

type Deadline = PublicationSnapshot['deadlines'][number];
const renderedAt = Date.parse('2026-10-27T12:00:00Z');
const earlier: Deadline = {
	label: 'Première remise',
	dueAt: '2026-10-25T12:00:00Z',
	submissionInstructions: 'Déposer le premier livrable.'
};
const past: Deadline = {
	label: 'Dernière remise passée',
	dueAt: '2026-10-26T12:00:00Z',
	submissionInstructions: ''
};
const equal: Deadline = {
	label: 'Remise à l’heure de référence',
	dueAt: '2026-10-27T12:00:00Z',
	submissionInstructions: 'Utiliser le lien des consignes.'
};
const future: Deadline = {
	label: 'Prochaine remise',
	dueAt: '2026-10-28T12:00:00Z',
	submissionInstructions: 'Déposer le projet.'
};
const later: Deadline = {
	label: 'Dernière remise à venir',
	dueAt: '2026-10-29T12:00:00Z',
	submissionInstructions: 'Déposer le second livrable.'
};

describe('selectRailDeadline', () => {
	it('returns null for an empty list', () => {
		expect(selectRailDeadline([], renderedAt)).toBeNull();
	});

	it('selects the earliest future deadline from unsorted input', () => {
		expect(selectRailDeadline([later, past, earlier, future], renderedAt)).toBe(future);
	});

	it('includes a deadline exactly at the supplied clock', () => {
		expect(selectRailDeadline([future, past, equal], renderedAt)).toBe(equal);
	});

	it('falls back to the latest past deadline when none is upcoming', () => {
		expect(selectRailDeadline([past, earlier], renderedAt)).toBe(past);
	});

	it('compares instants rather than local timestamp strings across the Paris clock change', () => {
		const beforeChange = { ...past, dueAt: '2026-10-25T02:45:00+02:00' };
		const afterChange = { ...future, dueAt: '2026-10-25T02:15:00+01:00' };
		const clock = Date.parse('2026-10-25T01:00:00Z');
		expect(selectRailDeadline([afterChange, beforeChange], clock)).toBe(afterChange);
		expect(selectRailDeadline([afterChange, beforeChange], clock + 60 * 60 * 1000)).toBe(afterChange);
	});

	it('keeps the first upcoming entry on equal instants, including different UTC offsets', () => {
		const first = { ...equal, dueAt: '2026-10-27T13:00:00+01:00', submissionInstructions: 'A' };
		const second = { ...equal, submissionInstructions: 'B' };
		expect(selectRailDeadline([later, first, second, past], renderedAt)).toBe(first);
		expect(selectRailDeadline([second, first, later, past], renderedAt)).toBe(second);
	});

	it('keeps the last past entry on equal instants without merging its instructions', () => {
		const first = { ...past, submissionInstructions: 'Premières modalités.' };
		const second = { ...past, submissionInstructions: 'Autres modalités.' };
		expect(selectRailDeadline([first, earlier, second], renderedAt)).toBe(second);
		expect(selectRailDeadline([second, earlier, first], renderedAt)).toBe(first);
	});

	it('sorts a copy and preserves every entry, field, timestamp and object identity', () => {
		const first = Object.freeze({
			...equal,
			submissionInstructions: 'Modalités longues.\n'.repeat(200)
		});
		const second = Object.freeze({ ...equal, submissionInstructions: '', futureField: 'retained' });
		const deadlines = Object.freeze([Object.freeze({ ...later }), first, second, Object.freeze({ ...past })]);
		const before = JSON.stringify(deadlines);
		expect(selectRailDeadline(deadlines, renderedAt)).toBe(first);
		expect(selectRailDeadline(deadlines, renderedAt + 1)).toBe(deadlines[0]);
		expect(selectRailDeadline([second], renderedAt)?.futureField).toBe('retained');
		expect(selectRailDeadline([first], renderedAt)).toBe(first);
		expect(JSON.stringify(deadlines)).toBe(before);
		expect(deadlines).toHaveLength(4);
		expect(deadlines[1]).toBe(first);
		expect(deadlines[2]).toBe(second);
	});

	it('matches the previous renderer selection for fixed clocks and input orders', () => {
		const entries = [earlier, past, equal, future, later, { ...equal, submissionInstructions: 'Distinct' }];
		const orders = [entries, [...entries].reverse(), [future, equal, earlier, later, entries[5], past]];
		const clocks = [Date.parse('2026-10-24T00:00:00Z'), renderedAt, renderedAt + 1, Date.parse('2026-10-30T00:00:00Z')];
		for (const deadlines of orders) {
			for (const clock of clocks) {
				const ordered = [...deadlines].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
				const upcoming = ordered.find((deadline) => Date.parse(deadline.dueAt) >= clock) ?? null;
				expect(selectRailDeadline(deadlines, clock)).toBe(upcoming ?? ordered.at(-1) ?? null);
			}
		}
	});
});
