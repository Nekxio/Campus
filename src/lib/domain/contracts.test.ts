import { describe, expect, it } from 'vitest';
import {
	academicYearSchema,
	externalLinkSchema,
	correctionProposalSchema,
	modulePublicationSchema,
	resultRuleSchema
} from './contracts.js';
import { moduleDraftSchema } from './teaching.js';
import { emptyModule } from '../teaching/types.js';

const id = '00000000-0000-4000-8000-000000000001';
const proposal = {
	version: 1,
	contextId: id,
	studentId: id,
	assessmentId: id,
	rubricRevision: 1,
	correctionRevision: 1,
	scores: [{ lineId: id, points: 8 }]
};
const publication = {
	version: 1,
	title: 'Student materials',
	description: '',
	resources: [],
	deadlines: [],
	recap: '',
	toDo: ''
};

describe('Foundation contracts', () => {
	it.each(['', '   ', 'not a URL', 'https://', '/relative', 'https://example.test:invalid'])(
		'reports invalid external links without throwing (%j), including in module drafts',
		(url) => {
			expect(() => externalLinkSchema.safeParse(url)).not.toThrow();
			expect(externalLinkSchema.safeParse(url).success).toBe(false);
			const draft = {
				...emptyModule(),
				title: 'Fictional URL validation',
				resources: [{ id, label: 'Fictional support', url, kind: 'resource' }]
			};
			expect(() => moduleDraftSchema.safeParse(draft)).not.toThrow();
			expect(moduleDraftSchema.safeParse(draft).success).toBe(false);
		}
	);
	it('requires consecutive years and HTTPS links without credentials', () => {
		expect(academicYearSchema.safeParse('2026-2027').success).toBe(true);
		expect(academicYearSchema.safeParse('2026-2028').success).toBe(false);
		expect(externalLinkSchema.safeParse('https://drive.google.com/file/d/demo/view').success).toBe(true);
		for (const url of ['javascript:alert(1)', 'http://example.test', 'https://user:password@example.test'])
			expect(externalLinkSchema.safeParse(url).success).toBe(false);
	});
	it('rejects fractional points, duplicate lines and executable formula strings', () => {
		expect(correctionProposalSchema.safeParse(proposal).success).toBe(true);
		expect(correctionProposalSchema.safeParse({ ...proposal, scores: [{ lineId: id, points: 8.5 }] }).success).toBe(
			false
		);
		expect(
			correctionProposalSchema.safeParse({
				...proposal,
				scores: [...proposal.scores, ...proposal.scores]
			}).success
		).toBe(false);
		expect(resultRuleSchema.safeParse('evaluate(quiz + project)').success).toBe(false);
		expect(resultRuleSchema.safeParse({ kind: 'points_ratio', assessmentIds: [id] }).success).toBe(true);
	});
	it('rejects private fields in the public publication projection', () => {
		expect(modulePublicationSchema.safeParse(publication).success).toBe(true);
		for (const key of ['students', 'scores', 'semesterComment', 'preparation'])
			expect(modulePublicationSchema.safeParse({ ...publication, [key]: 'Private' }).success).toBe(false);
	});
});
