import { describe, expect, it } from 'vitest';
import {
	publicationContextSchema,
	publicationSelectionSchema,
	publicationReviewDataSchema,
	publicationSnapshotSchema,
	type PublicationContext,
	type PublicationSelection,
	type PublicationReviewData
} from './publication.js';

const moduleId = '00000000-0000-4000-8000-000000000001';
const contextId = '00000000-0000-4000-8000-000000000002';
const classId = '00000000-0000-4000-8000-000000000003';
const durableId = '00000000-0000-4000-8000-000000000004';
const context: PublicationContext = {
	id: contextId,
	classId,
	className: 'B3 Demo',
	academicYear: '2026-2027',
	archived: false
};
const snapshot = publicationSnapshotSchema.parse({
	version: 2,
	title: 'Fictional publication',
	description: '',
	className: context.className,
	academicYear: context.academicYear,
	objectives: [],
	resources: [],
	deadlines: [],
	recap: '',
	toDo: '',
	lessonNotes: []
});
const teachingSnapshot = {
	...snapshot,
	rubric: [
		{
			title: 'Project',
			kind: 'project' as const,
			groups: [
				{
					title: 'Implementation',
					lines: [{ label: 'Correct behavior', description: 'Handle the documented cases.', maxPoints: 5 }]
				}
			]
		}
	],
	lessonNotes: [
		{
			id: durableId,
			label: 'Workshop',
			startsAt: '2026-10-27T12:00:00+01:00',
			recap: 'Review the examples.',
			toDo: 'Complete the practice exercise.'
		}
	]
};
const selection: PublicationSelection = {
	context,
	moduleRevision: 1,
	contextRevision: 1,
	classRevision: 1,
	publicationRevision: 0,
	draft: snapshot,
	published: null,
	status: 'draft',
	publishedAt: null,
	unpublishedAt: null,
	changed: true,
	publicPath: '/modules/' + contextId,
	classPath: '/classes/' + classId
};
const review: PublicationReviewData = {
	module: { id: moduleId, title: snapshot.title },
	contexts: [context],
	selected: selection
};
const without = (value: object, key: string) => {
	const copy: Record<string, unknown> = { ...value };
	delete copy[key];
	return copy;
};

describe('Strict private publication review contracts', () => {
	it.each(['quiz', 'project', 'oral', 'other'] as const)(
		'preserves a public %s rubric and lesson notes with offset-aware dates',
		(kind) => {
			const published = { ...teachingSnapshot, rubric: [{ ...teachingSnapshot.rubric[0], kind }] };
			expect(publicationSnapshotSchema.parse(published)).toEqual(published);
			expect(publicationSelectionSchema.parse({ ...selection, draft: published }).draft).toEqual(published);
		}
	);
	it('rejects an overlong public criterion description without truncating it', () => {
		const invalid = structuredClone(teachingSnapshot);
		invalid.rubric[0].groups[0].lines[0].description = 'x'.repeat(2001);
		expect(publicationSnapshotSchema.safeParse(invalid).success).toBe(false);
	});
	it.each([0, 1.5])('rejects a public criterion maximum of %s', (maxPoints) => {
		const invalid = structuredClone(teachingSnapshot);
		invalid.rubric[0].groups[0].lines[0].maxPoints = maxPoints;
		expect(publicationSnapshotSchema.safeParse(invalid).success).toBe(false);
	});
	it.each(['criterion', 'group', 'lesson'] as const)('rejects private fields nested in a public %s', (level) => {
		const invalid = structuredClone(teachingSnapshot);
		const target =
			level === 'criterion'
				? invalid.rubric[0].groups[0].lines[0]
				: level === 'group'
					? invalid.rubric[0].groups[0]
					: invalid.lessonNotes[0];
		Object.assign(target, { studentName: 'Private student' });
		expect(publicationSnapshotSchema.safeParse(invalid).success).toBe(false);
	});
	it('accepts a complete typed review and an unassigned module without a selection', () => {
		expect(publicationContextSchema.parse(context)).toEqual(context);
		expect(publicationSelectionSchema.parse(selection)).toEqual(selection);
		expect(publicationReviewDataSchema.parse(review)).toEqual(review);
		expect(publicationReviewDataSchema.parse({ ...review, contexts: [], selected: null })).toEqual({
			...review,
			contexts: [],
			selected: null
		});
	});
	it('accepts the second of two distinct contexts as the selected publication', () => {
		const secondContext: PublicationContext = {
			...context,
			id: durableId,
			classId: '00000000-0000-4000-8000-000000000005',
			className: 'B2 Demo',
			academicYear: '2027-2028'
		};
		const data: PublicationReviewData = {
			...review,
			contexts: [{ ...context, archived: true }, secondContext],
			selected: {
				...selection,
				context: secondContext,
				draft: {
					...snapshot,
					className: secondContext.className,
					academicYear: secondContext.academicYear
				},
				publicPath: '/modules/' + secondContext.id,
				classPath: '/classes/' + secondContext.classId
			}
		};
		expect(publicationReviewDataSchema.parse(data)).toEqual(data);
	});
	it('allows durable public identities and a retained snapshot from the previous annual context', () => {
		const annual = {
			...review,
			selected: {
				...selection,
				publicPath: '/modules/' + durableId,
				classPath: '/classes/' + durableId,
				published: { ...snapshot, academicYear: '2025-2026', className: 'Previous class' },
				status: 'published',
				publishedAt: '2025-10-27T12:00:00+01:00'
			}
		};
		expect(publicationReviewDataSchema.parse(annual)).toEqual(annual);
	});
	it('allows archived classless contexts with class revision zero and no draft or class link', () => {
		const archived = { ...context, classId: null, archived: true };
		const data = {
			...review,
			contexts: [archived],
			selected: { ...selection, context: archived, classRevision: 0, draft: null, classPath: null }
		};
		expect(publicationReviewDataSchema.parse(data)).toEqual(data);
	});
	it('allows a legacy status only as metadata, without a legacy snapshot body', () => {
		expect(
			publicationReviewDataSchema.safeParse({
				...review,
				selected: { ...selection, status: 'legacy', published: null }
			}).success
		).toBe(true);
	});
	it('retains the reviewed snapshot and decision dates after unpublishing', () => {
		const unpublished: PublicationSelection = {
			...selection,
			published: teachingSnapshot,
			status: 'unpublished',
			publishedAt: '2026-10-27T12:00:00+01:00',
			unpublishedAt: '2026-10-28T12:00:00+01:00'
		};
		expect(publicationSelectionSchema.parse(unpublished)).toEqual(unpublished);
	});
	it.each(['actor', 'user', 'session', 'roster', 'students', 'corrections', 'preparation'])(
		'rejects unknown %s fields rather than silently stripping them',
		(key) => {
			expect(publicationReviewDataSchema.safeParse({ ...review, [key]: [] }).success).toBe(false);
			expect(publicationContextSchema.safeParse({ ...context, [key]: [] }).success).toBe(false);
			expect(publicationSelectionSchema.safeParse({ ...selection, [key]: [] }).success).toBe(false);
			expect(
				publicationReviewDataSchema.safeParse({
					...review,
					module: { ...review.module, [key]: [] }
				}).success
			).toBe(false);
		}
	);
	it('requires every DTO field, including nullable fields, without root or selection defaults', () => {
		for (const key of Object.keys(context))
			expect(publicationContextSchema.safeParse(without(context, key)).success, key).toBe(false);
		for (const key of Object.keys(selection))
			expect(publicationSelectionSchema.safeParse(without(selection, key)).success, key).toBe(false);
		for (const key of Object.keys(review))
			expect(publicationReviewDataSchema.safeParse(without(review, key)).success, key).toBe(false);
		for (const key of Object.keys(review.module))
			expect(
				publicationReviewDataSchema.safeParse({ ...review, module: without(review.module, key) }).success,
				key
			).toBe(false);
		for (const value of [null, [], { review }, { ...review, contexts: null }])
			expect(publicationReviewDataSchema.safeParse(value).success).toBe(false);
	});
	it('validates UUID identities, labels, years and booleans without coercion', () => {
		for (const key of ['id', 'classId'])
			for (const value of ['', 'not-a-uuid', 1])
				expect(publicationContextSchema.safeParse({ ...context, [key]: value }).success).toBe(false);
		for (const value of ['', ' ', 'x'.repeat(201)]) {
			expect(publicationContextSchema.safeParse({ ...context, className: value }).success).toBe(false);
			expect(publicationReviewDataSchema.safeParse({ ...review, module: { id: moduleId, title: value } }).success).toBe(
				false
			);
		}
		expect(publicationReviewDataSchema.safeParse({ ...review, module: { id: 'bad', title: 'Demo' } }).success).toBe(
			false
		);
		expect(publicationContextSchema.safeParse({ ...context, academicYear: '2026-2028' }).success).toBe(false);
		expect(publicationContextSchema.safeParse({ ...context, archived: 'false' }).success).toBe(false);
		expect(publicationSelectionSchema.safeParse({ ...selection, changed: 1 }).success).toBe(false);
		expect(publicationSelectionSchema.safeParse({ ...selection, status: 'unknown' }).success).toBe(false);
	});
	it.each(['moduleRevision', 'contextRevision', 'classRevision', 'publicationRevision'] as const)(
		'requires strict integer %s baselines',
		(key) => {
			for (const value of [-1, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
				expect(publicationSelectionSchema.safeParse({ ...selection, [key]: value }).success).toBe(false);
			expect(publicationSelectionSchema.safeParse({ ...selection, [key]: 0 }).success).toBe(
				key === 'classRevision' || key === 'publicationRevision'
			);
		}
	);
	it.each(['publishedAt', 'unpublishedAt'] as const)('validates %s as a nullable ISO instant', (key) => {
		for (const value of ['', '2026-10-27', '2026-10-27T12:00:00', '2026-02-30T12:00:00Z', 0])
			expect(publicationSelectionSchema.safeParse({ ...selection, [key]: value }).success).toBe(false);
		for (const value of [null, '2026-10-27T12:00:00.000Z', '2026-10-27T12:00:00+01:00'])
			expect(publicationSelectionSchema.safeParse({ ...selection, [key]: value }).success).toBe(true);
	});
	it.each([
		['publicPath', '/modules/'],
		['classPath', '/classes/']
	] as const)('restricts %s to its exact relative UUID path', (key, prefix) => {
		const path = prefix + durableId;
		for (const value of [
			'',
			prefix,
			prefix + 'bad',
			'https://example.test' + path,
			'//example.test' + path,
			path + '?contexte=' + contextId,
			path + '#section',
			path + '/',
			path + '/extra',
			'/other/' + durableId,
			prefix + '../' + durableId,
			prefix + '%30' + durableId.slice(1)
		])
			expect(publicationSelectionSchema.safeParse({ ...selection, [key]: value }).success, value).toBe(false);
		expect(publicationSelectionSchema.safeParse({ ...selection, [key]: path }).success).toBe(true);
	});
	it.each(['draft', 'published'] as const)('rejects legacy, malformed or private fields in %s snapshots', (key) => {
		for (const value of [
			{ ...snapshot, version: 1 },
			without(snapshot, 'version'),
			without(snapshot, 'lessonNotes'),
			{ ...snapshot, roster: [] },
			{
				...snapshot,
				lessonNotes: [{ id: contextId, label: 'Demo', startsAt: 'bad', recap: '', toDo: '' }]
			}
		])
			expect(publicationSelectionSchema.safeParse({ ...selection, [key]: value }).success).toBe(false);
	});
	it('requires a unique context list and an exactly matching selected context', () => {
		for (const value of [
			{ ...review, contexts: [context, context] },
			{ ...review, contexts: [context, { ...context, className: 'Other' }] },
			{ ...review, contexts: [] },
			{ ...review, selected: null }
		])
			expect(publicationReviewDataSchema.safeParse(value).success).toBe(false);
		for (const patch of [
			{ id: durableId },
			{ classId: durableId },
			{ className: 'Other' },
			{ academicYear: '2027-2028' },
			{ archived: true }
		])
			expect(
				publicationReviewDataSchema.safeParse({
					...review,
					selected: { ...selection, context: { ...context, ...patch } }
				}).success
			).toBe(false);
	});
});
