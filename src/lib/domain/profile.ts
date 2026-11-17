import { z } from 'zod';

export const profileSchema = z.strictObject({
	name: z
		.string()
		.trim()
		.min(1, 'Indiquez votre nom et prénom.')
		.max(100, 'Le nom ne peut pas dépasser 100 caractères.')
		.refine((name) => !/[\r\n]/.test(name), 'Le nom doit tenir sur une ligne.')
});

export type ProfileInput = z.infer<typeof profileSchema>;
