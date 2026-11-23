import { describe, expect, it } from 'vitest';
import type { PublicationSnapshot } from '#lib/domain/publication.js';
import {
	buildCourseSupports,
	courseSupportFilters,
	pageCourseSupports,
	selectRailDeadline
} from './course-presentation.js';

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

describe('published course supports', () => {
	const exercise = (id: string, semester?: 'S1' | 'S2', title = id) => ({
		id,
		title,
		semester,
		instructions: '',
		solution: '',
		code: ''
	});
	const lesson = (id: string, startsAt: string, exerciseIds: string[], label = id) => ({
		id,
		label,
		startsAt,
		exerciseIds,
		recap: '',
		toDo: ''
	});
	const documents = [
		{ id: 'slides', label: 'Diaporama du module', kind: 'course' as const, url: 'https://example.org/slides' }
	];
	const exercises = [
		exercise('practice', 'S2'),
		exercise('afternoon', 'S1'),
		exercise('plan', 'S1'),
		exercise('trial', 'S1'),
		exercise('legacy')
	];
	const lessons = [
		lesson('later', '2027-03-04T14:00:00Z', ['practice']),
		lesson('pm', '2026-12-03T13:00:00Z', ['afternoon']),
		lesson('am', '2026-12-03T09:00:00Z', ['trial', 'plan'])
	];

	it('leads with the document, then orders workshops by semester and lesson with author order within a lesson', () => {
		const supports = buildCourseSupports(documents, exercises, lessons);
		expect(supports.map((item) => item.id)).toEqual(['slides', 'plan', 'trial', 'afternoon', 'practice', 'legacy']);
		expect(supports[1]).toMatchObject({ kind: 'workshop', semester: 'S1', lesson: lessons[2] });
		expect(courseSupportFilters(supports)).toEqual({
			hasTypes: true,
			semesters: ['S1', 'S2'],
			lessons: [...lessons].reverse()
		});
	});

	it('paginates 14 legacy workshops in author order without inferring semesters or lessons from their titles', () => {
		const legacy = Array.from({ length: 14 }, (_, index) =>
			exercise(
				`A${String(index + 1).padStart(2, '0')}`,
				undefined,
				`S1 · Séance 1 · A${String(index + 1).padStart(2, '0')}`
			)
		);
		const supports = buildCourseSupports(documents, legacy, []);
		expect(courseSupportFilters(supports)).toEqual({ hasTypes: true, semesters: [], lessons: [] });
		expect(pageCourseSupports(supports, { query: '', scope: 'all', page: 2 })).toMatchObject({
			page: 2,
			pageCount: 3,
			first: 7,
			last: 12,
			total: 15,
			items: supports.slice(6, 12)
		});
		expect(
			pageCourseSupports(supports, { query: 'a06', scope: 'workshops', page: 1 }).items.map((item) => item.id)
		).toEqual(['A06']);
		expect(pageCourseSupports(supports, { query: '', scope: 'S1', page: 1 }).total).toBe(0);
	});

	it('keeps six items per page across 60 supports and combines accent-insensitive search with scope', () => {
		const workshops = Array.from({ length: 59 }, (_, index) =>
			exercise(`A${index + 1}`, index < 29 ? 'S1' : 'S2', index === 29 ? 'Équipe projet' : `Atelier ${index + 1}`)
		);
		const firstLesson = lesson('team', '2026-12-03T09:00:00Z', ['A1', 'A2'], 'Travail en équipe');
		const supports = buildCourseSupports(documents, workshops, [firstLesson]);
		const lastPage = pageCourseSupports(supports, { query: '', scope: 'all', page: 11 });
		expect(lastPage).toMatchObject({ page: 10, pageCount: 10, first: 55, last: 60, total: 60 });
		expect(lastPage.items.map((item) => item.id)).toEqual(['A54', 'A55', 'A56', 'A57', 'A58', 'A59']);
		expect(
			pageCourseSupports(supports, { query: '  EQUIPE  ', scope: 'all', page: 1 }).items.map((item) => item.id)
		).toEqual(['A1', 'A2', 'A30']);
		expect(
			pageCourseSupports(supports, { query: 'equipe', scope: 'S2', page: 1 }).items.map((item) => item.id)
		).toEqual(['A30']);
		expect(
			pageCourseSupports(supports, { query: 'atelier 2', scope: 'lesson:team', page: 1 }).items.map((item) => item.id)
		).toEqual(['A2']);
		expect(
			pageCourseSupports(supports, { query: '', scope: 'documents', page: 1 }).items.map((item) => item.id)
		).toEqual(['slides']);
		expect(pageCourseSupports(supports, { query: 'equipe', scope: 'documents', page: 1 })).toMatchObject({
			items: [],
			page: 1,
			first: 0,
			last: 0,
			total: 0
		});
	});
});

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
