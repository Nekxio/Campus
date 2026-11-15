type CodeToken = {
	kind: 'plain' | 'tag' | 'keyword' | 'string' | 'comment' | 'number';
	text: string;
};

type InstructionPart = { kind: 'text'; text: string } | { kind: 'code'; language: string; tokens: CodeToken[] };

const tokenPattern =
	/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<\/?[a-zA-Z][\w.-]*|\/?>|\$props\b|\b(?:let|const|var|function|return|export|import|from|if|else|each|as|true|false|null|undefined|new|class|await|async)\b|\b\d+(?:\.\d+)?\b/g;
const keywordPattern =
	/^(?:\$props|let|const|var|function|return|export|import|from|if|else|each|as|true|false|null|undefined|new|class|await|async)$/;
const supportedLanguages = new Set(['svelte', 'html', 'javascript', 'js', 'typescript', 'ts']);

export const parseInlineExerciseText = (text: string): { kind: 'text' | 'code'; text: string }[] => {
	const parts: { kind: 'text' | 'code'; text: string }[] = [];
	let position = 0;
	for (const match of text.matchAll(/`([^`\n]+)`/g)) {
		if (match.index > position) parts.push({ kind: 'text', text: text.slice(position, match.index) });
		parts.push({ kind: 'code', text: match[1] });
		position = match.index + match[0].length;
	}
	if (position < text.length || parts.length === 0) {
		parts.push({ kind: 'text', text: text.slice(position) });
	}
	return parts;
};

const highlightCode = (code: string, language: string): CodeToken[] => {
	if (!supportedLanguages.has(language.toLowerCase())) return [{ kind: 'plain', text: code }];
	const tokens: CodeToken[] = [];
	let position = 0;
	for (const match of code.matchAll(tokenPattern)) {
		if (match.index > position) tokens.push({ kind: 'plain', text: code.slice(position, match.index) });
		const text = match[0];
		const kind: CodeToken['kind'] =
			text.startsWith('<!--') || text.startsWith('/*') || text.startsWith('//')
				? 'comment'
				: text.startsWith('"') || text.startsWith("'")
					? 'string'
					: keywordPattern.test(text)
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
		parts.push({ kind: 'code', language, tokens: highlightCode(match[2] ?? '', language) });
		position = match.index + match[0].length;
	}
	if (position < instructions.length || parts.length === 0) {
		parts.push({ kind: 'text', text: instructions.slice(position) });
	}
	return parts;
};
