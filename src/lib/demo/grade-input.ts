import { z } from 'zod';

export function gradeInputSchema(maximum: number) {
	return z
		.string()
		.trim()
		.pipe(
			z.union(
				[
					z.literal('').transform(() => null),
					z
						.string()
						.regex(/^\d+$/, 'Entrez une note entière, sans virgule.')
						.transform(Number)
						.pipe(z.int().min(0).max(maximum, `La note doit être comprise entre 0 et ${maximum}.`))
				],
				{ error: `Saisissez une note entière entre 0 et ${maximum}.` }
			)
		);
}

const demoGradeSchema = gradeInputSchema(20);

export function demoGradeError(value: string, absent: boolean): string | undefined {
	if (absent) return undefined;
	const result = demoGradeSchema.safeParse(value);
	return result.success ? undefined : result.error.issues[0]?.message;
}
