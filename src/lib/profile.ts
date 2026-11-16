export function getInitials(fullName: string): string {
	const parts = fullName.trim().split(/\s+/).filter(Boolean);
	const first = parts.at(0);
	const last = parts.at(-1);
	if (!first) return '?';
	const initial = (part: string) => Array.from(part.normalize('NFC').toLocaleUpperCase('fr-FR'))[0] ?? '';
	return initial(first) + (parts.length > 1 && last ? initial(last) : '');
}
