import { localModuleSchema } from '../../../domain/local-module.js';

// Fictional metadata only: no local credentials or existing course documents.
export function sampleLocalModule(classId: string) {
	return localModuleSchema.parse({
		title: 'Demo · MCP module',
		description: 'Fictional draft from a selected local folder.',
		objectives: ['Build a small web application'],
		preparation: {
			framing: 'Approved fictional framing',
			nextSteps: 'Review before publication',
			sourceLinks: []
		},
		resources: [
			{ key: 'slides', label: 'Slides', kind: 'course', url: 'https://example.test/slides.pdf' }
		],
		contexts: [
			{
				classId,
				lessons: [
					{
						key: 'intro',
						title: 'Introduction',
						startsAt: '2026-10-13T09:00:00+02:00',
						endsAt: '2026-10-13T12:00:00+02:00'
					}
				]
			}
		],
		rubric: {
			assessments: [
				{
					key: 'project',
					title: 'Project',
					kind: 'project',
					purpose: 'graded',
					groups: [{ key: 'features', title: 'Features' }],
					lines: [{ key: 'routing', groupKey: 'features', label: 'Routing', maxPoints: 10 }]
				}
			],
			results: [
				{
					key: 'final',
					title: 'Final result',
					rule: { kind: 'points_ratio', assessmentKeys: ['project'] }
				}
			],
			contexts: [
				{
					classId,
					deadlines: [
						{
							assessmentKey: 'project',
							dueAt: '2026-11-01T18:00:00+01:00',
							submissionInstructions: 'Submit the external repository link.'
						}
					]
				}
			]
		}
	});
}
