import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { StudentGradeExport } from '../domain/student-export.js';
import { assessmentStatusLabels } from '../domain/grading.js';
import { formatMark } from '../domain/grade-calculation.js';

export function studentGradePdfDefinition(document: StudentGradeExport): TDocumentDefinitions {
	const content: Content[] = [
		{ text: document.moduleTitle, fontSize: 18, bold: true, margin: [0, 0, 0, 8] },
		{ text: document.name, fontSize: 14, bold: true },
		{ text: `${document.className} · ${document.academicYear}`, margin: [0, 4, 0, 18] }
	];
	for (const section of document.sections) {
		content.push(
			{ text: section.title, fontSize: 14, bold: true, margin: [0, 16, 0, 5] },
			{
				text: `${assessmentStatusLabels[section.status]} · ${section.weight}`,
				margin: [0, 0, 0, 6]
			}
		);
		if (section.status.startsWith('absent_'))
			content.push({
				text: 'Les points conservés sont exclus du calcul pendant cette absence.',
				margin: [0, 0, 0, 6]
			});
		for (const group of section.groups) {
			content.push(
				{ text: group.title, bold: true, margin: [0, 8, 0, 4] },
				{
					table: {
						headerRows: 1,
						widths: ['*', 65, 65],
						body: [
							[
								{ text: 'Critère', bold: true },
								{ text: 'Obtenu', bold: true },
								{ text: 'Maximum', bold: true }
							],
							...group.lines.map((line) => [
								line.label,
								line.points === null ? 'En attente' : String(line.points),
								String(line.maximum)
							])
						]
					},
					layout: 'lightHorizontalLines'
				}
			);
			const complete = group.lines.every((line) => line.points !== null);
			const subtotal =
				section.kind === 'quiz'
					? `Moyenne des quiz : ${complete && group.lines.length ? formatMark(group.lines.reduce((sum, line) => sum + (20 * line.points!) / line.maximum, 0) / group.lines.length) + ' /20' : 'En attente'}`
					: `Sous-total : ${group.lines.reduce((sum, line) => sum + (line.points ?? 0), 0)} / ${group.lines.reduce((sum, line) => sum + line.maximum, 0)} points${complete ? '' : ' · incomplet'}`;
			content.push({ text: subtotal, margin: [0, 4, 0, 6] });
		}
		const summary: Content[] = [
			{
				text: `${section.title} · section sur 20 : ${section.mark === null ? 'En attente' : formatMark(section.mark) + ' /20'}`,
				bold: true,
				margin: [0, 6, 0, 4]
			}
		];
		if (section.kind === 'project')
			summary.push({
				text:
					section.latenessDecision === 'exempt'
						? 'Exception de retard accordée'
						: section.latenessDecision === 'refused'
							? 'Production explicitement non remise ou refusée : zéro'
							: `${section.latenessDays} jour(s) de retard · ${section.latenessDays > 5 ? 'plus de cinq jours : projet à zéro' : 'pénalité : −' + formatMark(section.penalty) + ' /20'}`,
				margin: [0, 0, 0, 4]
			});
		for (const contribution of section.contributions)
			summary.push({
				text: `${contribution.title} : poids ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(contribution.weight)} % · contribution ${formatMark(contribution.mark)} point(s) /20`,
				margin: [0, 0, 0, 3]
			});
		content.push({ stack: summary, unbreakable: true });
	}
	content.push(
		{ text: 'Résultats du module', fontSize: 14, bold: true, margin: [0, 18, 0, 8] },
		...document.results.map((result) => ({
			text: `${result.title} : ${formatMark(result.mark)} /20`,
			bold: true,
			margin: [0, 0, 0, 5] as [number, number, number, number]
		}))
	);
	return {
		pageSize: 'A4',
		pageMargins: [36, 36, 36, 40],
		defaultStyle: { font: 'Roboto', fontSize: 10 },
		content,
		footer: (page, pages) => ({
			text: `Campus · Page ${page} / ${pages}`,
			alignment: 'right',
			margin: [36, 12, 36, 0],
			fontSize: 8
		})
	};
}
export async function downloadStudentGradePdf(document: StudentGradeExport) {
	const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
		import('pdfmake/build/pdfmake.js'),
		import('pdfmake/build/vfs_fonts.js')
	]);
	pdfMake.addVirtualFileSystem(fonts);
	const filename =
		`bilan-${document.name}-${document.moduleTitle}`
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.replace(/[^a-zA-Z0-9]+/g, '-')
			.slice(0, 140)
			.toLowerCase() + '.pdf';
	await pdfMake.createPdf(studentGradePdfDefinition(document)).download(filename);
}
