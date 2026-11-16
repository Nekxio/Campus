import { describe, expect, it } from 'vitest';
import { emptyModule, type ModuleDetail } from '#lib/teaching/types.js';
import {
	createModuleEditorSchema,
	moduleEditorFingerprint,
	savedModuleDates,
	toModuleDraft,
	toModuleEditorInput
} from './module-editor-input.js';

const savedModule = (): ModuleDetail => ({
	...emptyModule(),
	id: crypto.randomUUID(),
	revision: 1,
	title: 'Fictional module',
	preparation: {
		framing: '',
		nextSteps: '',
		sourceLinks: [{ label: 'Reference', url: 'https://example.com/reference' }]
	},
	contexts: [
		{
			id: crypto.randomUUID(),
			classId: crypto.randomUUID(),
			expectedRevision: 1,
			lessons: [
				{
					id: crypto.randomUUID(),
					title: 'Fictional lesson',
					startsAt: '2026-10-25T00:30:27.123Z',
					endsAt: '2026-10-25T01:45:55.987Z',
					recap: '',
					toDo: ''
				}
			]
		}
	]
});

describe('Module editor input', () => {
	it('keeps saved UTC instants, including seconds, when ambiguous Paris times are unchanged', () => {
		const module = savedModule();
		const dates = savedModuleDates(module);
		const input = toModuleEditorInput(module);
		expect(input.contexts[0].lessons[0].startsAt).toBe('2026-10-25T02:30');
		expect(toModuleDraft(input, dates)).toEqual(expect.objectContaining({ contexts: module.contexts }));
		expect(createModuleEditorSchema(() => dates).safeParse(input).success).toBe(true);
	});

	it.each(['2026-10-25T02:31', '2026-03-29T02:30'])(
		'rejects a newly entered ambiguous or nonexistent Paris time (%s) with one field error',
		(startsAt) => {
			const module = savedModule();
			const input = toModuleEditorInput(module);
			input.contexts[0].lessons[0].startsAt = startsAt;
			const parsed = createModuleEditorSchema(() => savedModuleDates(module)).safeParse(input);
			expect(parsed.success).toBe(false);
			if (parsed.success) throw new Error('Expected a calendar validation error.');
			const issues = parsed.error.issues.filter((issue) => issue.path.join('.') === 'contexts.0.lessons.0.startsAt');
			expect(issues).toHaveLength(1);
			expect(issues[0].message).toContain('n’existe pas ou est ambiguë');
		}
	);

	it('validates against the latest saved dates after a reload without rebuilding the form schema', () => {
		const module = savedModule();
		let dates = savedModuleDates(module);
		const schema = createModuleEditorSchema(() => dates);
		module.contexts[0].lessons[0].startsAt = '2026-10-25T00:32:19.456Z';
		dates = savedModuleDates(module);
		const input = toModuleEditorInput(module);
		expect(schema.safeParse(input).success).toBe(true);
		expect(toModuleDraft(input, dates).contexts[0].lessons[0].startsAt).toBe('2026-10-25T00:32:19.456Z');
	});

	it('ignores regenerated private reference keys when detecting a dirty draft but keeps content edits', () => {
		const input = toModuleEditorInput(savedModule());
		const baseline = moduleEditorFingerprint(input);
		input.preparation.sourceLinks[0].id = 'regenerated-ui-key';
		expect(moduleEditorFingerprint(input)).toBe(baseline);
		input.preparation.sourceLinks[0].label = 'Updated reference';
		expect(moduleEditorFingerprint(input)).not.toBe(baseline);
	});

	it('keeps local edits separate from saved data and preserves a new module’s originating class', () => {
		const module = savedModule();
		const input = toModuleEditorInput(module);
		input.contexts[0].lessons[0].title = 'Unsaved lesson';
		input.preparation.sourceLinks[0].label = 'Unsaved reference';
		input.studentContent.instructions = 'Unsaved instructions';
		expect(module.contexts[0].lessons[0].title).toBe('Fictional lesson');
		expect(module.preparation.sourceLinks[0].label).toBe('Reference');
		expect(module.studentContent?.instructions).toBe('');
		expect(toModuleEditorInput(null, 'origin-class').addClassId).toBe('origin-class');
		expect(toModuleEditorInput(module, 'origin-class').addClassId).toBe('');
	});
});
