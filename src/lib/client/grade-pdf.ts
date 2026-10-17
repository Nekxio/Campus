import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { FinalGradeExport } from '../domain/grade-export.js';
import { formatMark } from '../domain/grade-calculation.js';

export function gradePdfFilename(document: FinalGradeExport) {
	const slug = [document.moduleTitle, document.className, document.academicYear]
		.join('-')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase()
		.slice(0, 140);
	return `notes-${slug || 'module'}-${document.exportedAt.slice(0, 10)}.pdf`;
}

export function gradePdfDefinition(document: FinalGradeExport): TDocumentDefinitions {
	const content: Content[] = [];
	const headers = [
		...(document.sections ?? []).map((section) => `${section.title} /20\n${section.weight}`),
		...document.results.map((title) => `${title} /20`)
	];
	// Repeat the full roster for each group of columns rather than shrink 100 results to illegibility.
	const columnsPerTable = 5;
	for (let start = 0; start < headers.length; start += columnsPerTable) {
		const titles = headers.slice(start, start + columnsPerTable);
		content.push(
			{
				text: document.moduleTitle,
				fontSize: 18,
				bold: true,
				margin: [0, 0, 0, 6],
				...(start ? { pageBreak: 'before' as const } : {})
			},
			{
				text: `${document.className} · ${document.academicYear}`,
				fontSize: 11,
				margin: [0, 0, 0, 4]
			},
			{
				text: `Grille complète · ${document.students.length} étudiants`,
				color: '#525252',
				margin: [0, 0, 0, 16]
			},
			{
				table: {
					headerRows: 1,
					dontBreakRows: true,
					widths: [180, ...titles.map(() => '*')],
					body: [
						[
							{ text: 'Étudiant', bold: true },
							...titles.map((title) => ({
								text: title,
								bold: true,
								alignment: 'right' as const
							}))
						],
						...document.students.map((student) => [
							{ text: student.name },
							...[...(student.sectionMarks ?? []), ...student.marks]
								.slice(start, start + columnsPerTable)
								.map((mark) => ({
									text: mark === null ? 'En attente' : formatMark(mark),
									alignment: 'right' as const
								}))
						])
					]
				},
				layout: {
					hLineWidth: () => 0.5,
					vLineWidth: () => 0,
					hLineColor: () => '#d4d4d4',
					fillColor: (row) => (row === 0 ? '#f5f5f5' : null),
					paddingTop: () => 8,
					paddingBottom: () => 8,
					paddingLeft: () => 8,
					paddingRight: () => 8
				}
			}
		);
	}
	return {
		pageSize: 'A4',
		pageOrientation: 'landscape',
		pageMargins: [32, 40, 32, 40],
		defaultStyle: { font: 'Roboto', fontSize: 10, color: '#171717' },
		info: { title: `${document.moduleTitle} — Grille de résultats`, creator: 'Coursely' },
		content,
		header: {
			text: `${document.moduleTitle} · ${document.className} · ${document.academicYear}`,
			margin: [32, 16, 32, 0],
			fontSize: 8,
			color: '#525252'
		},
		footer: (page, pages) => ({
			text: `Coursely · Page ${page} / ${pages}`,
			alignment: 'right',
			margin: [32, 12, 32, 0],
			fontSize: 8,
			color: '#525252'
		})
	};
}

export async function downloadGradePdf(document: FinalGradeExport) {
	// Loaded only after a teacher asks for an export; fonts are local bundled assets, no remote fetch.
	const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
		import('pdfmake/build/pdfmake.js'),
		import('pdfmake/build/vfs_fonts.js')
	]);
	pdfMake.addVirtualFileSystem(fonts);
	await pdfMake.createPdf(gradePdfDefinition(document)).download(gradePdfFilename(document));
}
