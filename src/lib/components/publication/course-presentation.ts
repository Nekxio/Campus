import type { PublicationSnapshot } from '#lib/domain/publication.js';

type Deadline = PublicationSnapshot['deadlines'][number];

export function selectRailDeadline<T extends Deadline>(deadlines: readonly T[], renderedAt: number): T | null {
	const orderedDeadlines = [...deadlines].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
	return (
		orderedDeadlines.find((deadline) => Date.parse(deadline.dueAt) >= renderedAt) ?? orderedDeadlines.at(-1) ?? null
	);
}
