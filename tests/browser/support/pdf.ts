import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function readPdfText(path: string) {
	const task = getDocument({ data: new Uint8Array(await readFile(path)) });
	try {
		const document = await task.promise;
		const pages: string[] = [];
		for (let number = 1; number <= document.numPages; number++) {
			const page = await document.getPage(number);
			const content = await page.getTextContent();
			pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
		}
		return pages.join(' ').replace(/\s+/g, ' ');
	} finally {
		await task.destroy();
	}
}
