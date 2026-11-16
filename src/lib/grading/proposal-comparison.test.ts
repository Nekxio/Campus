import { describe, expect, it } from 'vitest';
import { proposedCommentDiffers, proposedPointsDiffer } from './proposal-comparison.js';

describe('Proposed points comparison', () => {
	it.each([
		{ recorded: 4, proposed: 5, different: true },
		{ recorded: 5, proposed: 5, different: false },
		{ recorded: 4, proposed: undefined, different: false },
		{ recorded: null, proposed: undefined, different: false },
		{ recorded: 0, proposed: undefined, different: false },
		{ recorded: null, proposed: null, different: false },
		{ recorded: 0, proposed: null, different: true },
		{ recorded: null, proposed: 0, different: true },
		{ recorded: 0, proposed: 0, different: false },
		{ recorded: 4, proposed: null, different: true },
		{ recorded: 1000000, proposed: 1000000, different: false },
		{ recorded: 1000000, proposed: 5, different: true }
	])('$recorded → $proposed: different=$different', ({ recorded, proposed, different }) => {
		expect(proposedPointsDiffer(recorded, proposed)).toBe(different);
	});

	it.each([
		{ recorded: 4, proposed: 5, initial: '5', retained: '3', different: true, adjusted: true },
		{ recorded: 5, proposed: 5, initial: '5', retained: '4', different: false, adjusted: true },
		{ recorded: 4, proposed: 5, initial: '5', retained: '5', different: true, adjusted: false },
		{ recorded: null, proposed: null, initial: '', retained: '', different: false, adjusted: false }
	])('is independent of retained edits: $recorded/$proposed/$retained', (values) => {
		const before = { ...values };
		expect(proposedPointsDiffer(values.recorded, values.proposed)).toBe(values.different);
		expect(values.retained !== values.initial).toBe(values.adjusted);
		expect(values).toEqual(before);
	});

	it('compares the current recorded value after a decision, not a frozen baseline', () => {
		expect(proposedPointsDiffer(4, 5)).toBe(true);
		expect(proposedPointsDiffer(5, 5)).toBe(false);
	});
});

describe('Proposed comment comparison', () => {
	it.each([
		{ recorded: '', proposed: undefined, different: false },
		{ recorded: 'Actuel', proposed: undefined, different: false },
		{ recorded: '', proposed: '', different: false },
		{ recorded: 'Actuel', proposed: 'Actuel', different: false },
		{ recorded: 'Actuel', proposed: '', different: true },
		{ recorded: '', proposed: 'Proposé', different: true },
		{ recorded: 'Actuel', proposed: 'Proposé', different: true },
		{ recorded: 'Texte', proposed: ' Texte ', different: true },
		{ recorded: 'Texte\n', proposed: 'Texte', different: true },
		{ recorded: ' ', proposed: '', different: true },
		{ recorded: '<b>Texte</b> 日本語 🧪', proposed: '<b>Texte</b> 日本語 🧪', different: false }
	])('compares verbatim: $recorded → $proposed', ({ recorded, proposed, different }) => {
		const before = { recorded, proposed };
		expect(proposedCommentDiffers(recorded, proposed)).toBe(different);
		expect({ recorded, proposed }).toEqual(before);
	});
});
