const parisYearMonth = new Intl.DateTimeFormat('fr-FR', {
	timeZone: 'Europe/Paris',
	year: 'numeric',
	month: 'numeric'
});

export function currentAcademicYear(at = new Date()): string {
	const parts = parisYearMonth.formatToParts(at);
	const year = Number(parts.find((part) => part.type === 'year')?.value);
	const month = Number(parts.find((part) => part.type === 'month')?.value);
	const start = month >= 9 ? year : year - 1;
	return `${start}-${start + 1}`;
}
