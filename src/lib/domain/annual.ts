import { z } from 'zod';
import { academicYearSchema, idSchema } from './contracts.js';
import type { GradeGridData } from './grading.js';
import type { Preparation } from './contracts.js';

export const annualActionSchema = z
	.strictObject({
		academicYear: academicYearSchema,
		action: z.enum(['archive', 'reopen', 'purge']),
		reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
		requestId: idSchema,
		typedYear: z.string().max(9),
		pdfsKept: z.boolean()
	})
	.superRefine((value, ctx) => {
		if (value.action !== 'purge') return;
		if (value.typedYear !== value.academicYear)
			ctx.addIssue({
				code: 'custom',
				path: ['typedYear'],
				message: 'Recopiez exactement l’année choisie.'
			});
		if (!value.pdfsKept)
			ctx.addIssue({
				code: 'custom',
				path: ['pdfsKept'],
				message: 'Confirmez la conservation des PDF nécessaires.'
			});
	});
export type AnnualAction = z.infer<typeof annualActionSchema>;
export type AnnualCounts = {
	classes: number;
	students: number;
	corrections: number;
	scores: number;
	comments: number;
	proposals: number;
	decisions: number;
};
export type AnnualReceipt = {
	version: 1;
	requestId: string;
	academicYear: string;
	action: AnnualAction['action'];
	completedAt: string;
	removed: AnnualCounts;
};
export type AnnualPreview = {
	academicYear: string;
	status: 'active' | 'archived' | 'purged';
	reviewToken: string;
	classes: { id: string; name: string; studentCount: number }[];
	removed: AnnualCounts;
	preserved: {
		modules: number;
		contexts: number;
		lessons: number;
		deadlines: number;
		publications: number;
	};
	contexts: {
		id: string;
		moduleId: string;
		moduleTitle: string;
		className: string;
		archived: boolean;
		rosterRetained: boolean;
		pdf: { ready: boolean; reason: string; complete: number; total: number };
	}[];
};
export type AnnualPageData = { years: string[]; selected: AnnualPreview | null };
export type AnnualHistory = {
	academicYear: string;
	className: string;
	moduleTitle: string;
	preparation: Preparation;
	lessons: {
		id: string;
		title: string;
		startsAt: string;
		endsAt: string;
		recap: string;
		toDo: string;
	}[];
	deadlines: { id: string; title: string; dueAt: string; submissionInstructions: string }[];
	grid: GradeGridData | null;
};
