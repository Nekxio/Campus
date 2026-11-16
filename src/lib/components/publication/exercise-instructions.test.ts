import { describe, expect, it } from 'vitest';
import { parseExerciseInstructions, parseInlineExerciseText } from './exercise-instructions.js';

describe('exercise instructions', () => {
	it('separates inline code and preserves unmatched backticks as text', () => {
		expect(parseInlineExerciseText('Use `count` and `double`, then keep `unfinished.')).toEqual([
			{ kind: 'text', text: 'Use ' },
			{ kind: 'code', text: 'count' },
			{ kind: 'text', text: ' and ' },
			{ kind: 'code', text: 'double' },
			{ kind: 'text', text: ', then keep `unfinished.' }
		]);
	});
	it('keeps ordinary instructions unchanged when there is no complete code block', () => {
		const text = 'Read this example:\n```svelte\n<script>\n';
		expect(parseExerciseInstructions(text)).toEqual([{ kind: 'text', text }]);
	});

	it('separates multiple fenced examples from the surrounding text', () => {
		const parts = parseExerciseInstructions(
			'Before\n\n```svelte\n<script>\n  let name = "Ada";\n</script>\n```\n\nBetween\n\n```text\n<safe>\n```\n\nAfter'
		);
		expect(parts.map((part) => part.kind)).toEqual(['text', 'code', 'text', 'code', 'text']);
		expect(parts[0]).toEqual({ kind: 'text', text: 'Before\n\n' });
		expect(parts[2]).toEqual({ kind: 'text', text: '\n\nBetween\n\n' });
		expect(parts[4]).toEqual({ kind: 'text', text: '\n\nAfter' });
		const first = parts[1];
		if (first?.kind !== 'code') throw new Error('Expected a code block');
		expect(first.language).toBe('svelte');
		expect(first.tokens.map((token) => token.text).join('')).toBe('<script>\n  let name = "Ada";\n</script>');
		expect(first.tokens).toContainEqual({ kind: 'keyword', text: 'let' });
		expect(first.tokens).toContainEqual({ kind: 'string', text: '"Ada"' });
		const second = parts[3];
		if (second?.kind !== 'code') throw new Error('Expected a code block');
		expect(second.tokens).toEqual([{ kind: 'plain', text: '<safe>' }]);
	});

	it('preserves multiline comments and does not interpret code as HTML', () => {
		const parts = parseExerciseInstructions('```svelte\n<!-- first\nsecond -->\n<img src=x onerror=alert(1)>\n```');
		const code = parts[0];
		if (code?.kind !== 'code') throw new Error('Expected a code block');
		expect(code.tokens[0]).toEqual({ kind: 'comment', text: '<!-- first\nsecond -->' });
		expect(code.tokens.map((token) => token.text).join('')).toContain('<img src=x onerror=alert(1)>');
	});
});
