import { publicationSections } from '#lib/domain/publication.js';

export type PublicationSectionId = (typeof publicationSections)[number]['id'] | 'objectives';

export const publicationSectionFromHash = (hash: string, idPrefix: string): PublicationSectionId | null =>
	hash === `#${idPrefix}-objectives`
		? 'objectives'
		: (publicationSections.find((section) => hash === `#${idPrefix}-${section.id}`)?.id ?? null);
