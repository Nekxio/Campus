import { externalLinkSchema } from '#lib/domain/contracts.js';

type CodeToken = {
	kind: 'plain' | 'tag' | 'keyword' | 'string' | 'comment' | 'number';
	text: string;
};

type InstructionPart =
	{ kind: 'text'; text: string } | { kind: 'code'; language: string; code: string; tokens: CodeToken[] };
type InlinePart = { kind: 'text' | 'code' | 'strong'; text: string } | { kind: 'link'; text: string; href: string };
export type CourseTable = {
	kind: 'table';
	columns: { text: string; align: 'start' | 'left' | 'center' | 'right' }[];
	rows: string[][];
};
type ProseBlock =
	| { kind: 'paragraph'; text: string }
	| { kind: 'heading'; level: number; text: string }
	| { kind: 'list'; ordered: boolean; start: number; items: string[] }
	| CourseTable;
type CourseBlock = ProseBlock | Extract<InstructionPart, { kind: 'code' }> | { kind: 'spacing'; text: string };

const tokenPattern =
	/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<\/?[a-zA-Z][\w.-]*|\/?>|\$(?:props|state|derived|effect|bindable|inspect)\b|\b(?:let|const|var|function|return|export|import|from|if|else|each|as|true|false|null|undefined|new|class|await|async)\b|\b\d+(?:\.\d+)?\b/g;
const keywordPattern =
	/^(?:\$(?:props|state|derived|effect|bindable|inspect)|let|const|var|function|return|export|import|from|if|else|each|as|true|false|null|undefined|new|class|await|async)$/;
const shellTokenPattern =
	/(?<!\S)#[^\n]*|"(?:\\.|[^"\\])*"|'[^']*'|\$\{[^}]*\}|\$[a-zA-Z_][\w]*|\b(?:if|then|else|elif|fi|for|in|do|done|case|esac|while|function|export|printf|echo|cd|pwd|ls|mkdir|cat|sed|grep|diff|wc|test|true|false)\b|\b\d+\b/g;
const shellLanguages = new Set(['bash', 'sh', 'shell']);
const supportedLanguages = new Set(['svelte', 'html', 'javascript', 'js', 'typescript', 'ts']);

export const parseInlineExerciseText = (text: string): InlinePart[] => {
	const parts: InlinePart[] = [];
	let position = 0;
	const markup = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<!!)\[([^\n[\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g;
	for (const match of text.matchAll(markup)) {
		if (match.index > position) parts.push({ kind: 'text', text: text.slice(position, match.index) });
		const [, code, emphasis, label, target] = match;
		if (label !== undefined) {
			const link = externalLinkSchema.safeParse(target);
			parts.push(link.success ? { kind: 'link', text: label, href: link.data } : { kind: 'text', text: label });
		} else {
			parts.push(code === undefined ? { kind: 'strong', text: emphasis } : { kind: 'code', text: code });
		}
		position = match.index + match[0].length;
	}
	if (position < text.length || parts.length === 0) {
		parts.push({ kind: 'text', text: text.slice(position) });
	}
	return parts;
};

const tableCells = (line: string) => {
	const trimmed = line.trim();
	if (!trimmed.includes('|')) return [];
	const cells: string[] = [];
	let cell = '';
	let separator = false;
	for (let index = 0; index < trimmed.length; index++) {
		const character = trimmed[index];
		const next = trimmed[index + 1];
		separator = character === '|';
		if (character === '\\' && (next === '|' || next === '\\')) {
			cell += next;
			index++;
		} else if (separator) {
			if (index !== 0) cells.push(cell.trim());
			cell = '';
		} else {
			cell += character;
		}
	}
	if (!separator) cells.push(cell.trim());
	return cells;
};

const tableHeader = (header: string, next: string | undefined): CourseTable | undefined => {
	if (!next?.includes('-') || !header.includes('|')) return;
	const markers = tableCells(next);
	const headings = tableCells(header);
	if (!markers.length || headings.length !== markers.length || markers.some((marker) => !/^:?-+:?$/.test(marker)))
		return;
	const columns = headings.map((text, index): CourseTable['columns'][number] => {
		const marker = markers[index];
		if (marker.startsWith(':')) return { text, align: marker.endsWith(':') ? 'center' : 'left' };
		return { text, align: marker.endsWith(':') ? 'right' : 'start' };
	});
	return { kind: 'table', columns, rows: [] };
};

export const parseExerciseProse = (text: string): ProseBlock[] => {
	const blocks: ProseBlock[] = [];
	let current: ProseBlock | undefined;
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!line.trim()) {
			current = undefined;
			continue;
		}
		const table = tableHeader(line, lines[index + 1]);
		if (table) {
			blocks.push(table);
			index++;
			while (index + 1 < lines.length) {
				const row = tableCells(lines[index + 1]);
				if (row.length !== table.columns.length) break;
				table.rows.push(row);
				index++;
			}
			current = undefined;
			continue;
		}
		const heading = /^(#{1,6})[ \t]+(.+)$/.exec(line);
		const item = /^(?:[-*+]|(\d{1,9})[.)])[ \t]+(.+)$/.exec(line);
		if (heading) {
			blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
			current = undefined;
		} else if (item) {
			const ordered = item[1] !== undefined;
			if (current?.kind !== 'list' || current.ordered !== ordered) {
				current = { kind: 'list', ordered, start: ordered ? Number(item[1]) : 1, items: [] };
				blocks.push(current);
			}
			current.items.push(item[2]);
		} else if (current?.kind === 'paragraph') {
			current.text += `\n${line}`;
		} else {
			current = { kind: 'paragraph', text: line };
			blocks.push(current);
		}
	}
	return blocks;
};

const highlightCode = (code: string, language: string): CodeToken[] => {
	const shell = shellLanguages.has(language.toLowerCase());
	if (!shell && !supportedLanguages.has(language.toLowerCase())) return [{ kind: 'plain', text: code }];
	const tokens: CodeToken[] = [];
	let position = 0;
	for (const match of code.matchAll(shell ? shellTokenPattern : tokenPattern)) {
		if (match.index > position) tokens.push({ kind: 'plain', text: code.slice(position, match.index) });
		const text = match[0];
		const kind: CodeToken['kind'] =
			(shell && text.startsWith('#')) || text.startsWith('<!--') || text.startsWith('/*') || text.startsWith('//')
				? 'comment'
				: text.startsWith('"') || text.startsWith("'")
					? 'string'
					: keywordPattern.test(text) || (shell && !/^\d/.test(text))
						? 'keyword'
						: /^\d/.test(text)
							? 'number'
							: 'tag';
		tokens.push({ kind, text });
		position = match.index + text.length;
	}
	if (position < code.length) tokens.push({ kind: 'plain', text: code.slice(position) });
	return tokens;
};

export const parseExerciseInstructions = (instructions: string): InstructionPart[] => {
	const parts: InstructionPart[] = [];
	const fences = /^```([\w+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
	let position = 0;
	for (const match of instructions.matchAll(fences)) {
		if (match.index > position) parts.push({ kind: 'text', text: instructions.slice(position, match.index) });
		const language = match[1] ?? '';
		const code = match[2] ?? '';
		parts.push({ kind: 'code', language, code, tokens: highlightCode(code, language) });
		position = match.index + match[0].length;
	}
	if (position < instructions.length || parts.length === 0) {
		parts.push({ kind: 'text', text: instructions.slice(position) });
	}
	return parts;
};

export const parseCourseMarkdown = (text: string): CourseBlock[] =>
	parseExerciseInstructions(text).flatMap((part): CourseBlock[] => {
		if (part.kind === 'code') return [part];
		return part.text
			.split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/)
			.flatMap((chunk, index): CourseBlock[] =>
				index % 2 === 0 ? parseExerciseProse(chunk) : [{ kind: 'spacing', text: chunk }]
			);
	});
