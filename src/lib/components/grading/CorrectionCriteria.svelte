<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import type { RubricAssessment } from '#lib/domain/grading.js';
	import type { AssessmentInput, CorrectionDraft } from '#lib/grading/correction-form.js';
	import { scoreDraftSummary } from '#lib/grading/score-draft.js';
	import CriterionScore from './CriterionScore.svelte';

	let {
		form,
		assessment,
		assessmentIndex,
		current,
		pending,
		activeGroup,
		onGroupChange
	}: {
		form: SuperForm<CorrectionDraft, string>;
		assessment: RubricAssessment;
		assessmentIndex: number;
		current: AssessmentInput;
		pending: boolean;
		activeGroup: string;
		onGroupChange: (value: string) => void;
	} = $props();
	const absent = $derived(current.status === 'absent_justified' || current.status === 'absent_unjustified');
</script>

<div class="work-area mt-4">
	<Tabs.Root orientation="vertical" value={activeGroup} onValueChange={onGroupChange} class="min-w-0 flex-col gap-2">
		<div class="criteria-heading flex flex-wrap items-center justify-between gap-3">
			<div class="criteria-title flex flex-wrap items-center gap-3">
				<h2 id="correction-entry" tabindex="-1" class="correction-jump-target panel-title">
					{assessment.groups.find((group) => group.id === activeGroup)?.title}
				</h2>
				<output class="text-sm font-medium tabular-nums" aria-label="Total du groupe"
					>{scoreDraftSummary(assessment, current, activeGroup)}</output
				>
			</div>
			<Tabs.List
				aria-label="Groupes de critères"
				class="criteria-index h-auto max-w-full flex-wrap justify-start gap-1 p-0"
				>{#each assessment.groups as group (group.id)}<Tabs.Trigger value={group.id} class="min-h-11 whitespace-normal"
						>{group.title}</Tabs.Trigger
					>{/each}</Tabs.List
			>
		</div>
		<p class="text-sm text-muted-foreground">
			Points entiers. Un champ vide reste non noté.{absent
				? ' Les points saisis sont conservés pendant l’absence et exclus du calcul.'
				: ''}
		</p>
		{#each assessment.groups as group (group.id)}<Tabs.Content value={group.id} class="min-w-0">
				<div class="criteria-scroll" role="region" aria-label={`Critères de ${group.title}`} tabindex="-1">
					<Form.Field
						{form}
						name={`assessments[${assessmentIndex}].scores`}
						class="criterion-list flex flex-col gap-0 border-t"
					>
						{#each assessment.lines as line, lineIndex (line.id)}{#if line.groupId === group.id}<CriterionScore
									{form}
									{assessmentIndex}
									scoreIndex={lineIndex}
									{line}
									{absent}
									required={current.status === 'graded' &&
										!(assessment.kind === 'project' && current.latenessDecision === 'refused')}
									disabled={absent || pending}
								/>{/if}{/each}
					</Form.Field>
				</div>
			</Tabs.Content>{/each}
	</Tabs.Root>
</div>

<style>
	@media (min-width: 80rem) {
		.work-area :global([data-slot='tabs']) {
			display: grid;
			grid-template-columns: 10rem minmax(0, 1fr);
			grid-template-areas: 'index title' 'index guidance' 'index criteria';
			column-gap: 1.5rem;
		}
		.criteria-heading {
			display: contents;
		}
		.criteria-title {
			grid-area: title;
		}
		.work-area :global(.criteria-index) {
			grid-area: index;
			display: flex;
			flex-direction: column;
			align-items: stretch;
			align-self: start;
			background: transparent;
		}
		.work-area :global(.criteria-index [data-slot='tabs-trigger']) {
			justify-content: start;
			text-align: left;
			min-width: 0;
		}
		.work-area :global([data-slot='tabs'] > p) {
			grid-area: guidance;
		}
		.work-area :global([data-slot='tabs-content']) {
			grid-area: criteria;
		}
	}
	.criteria-scroll {
		padding: 0.5rem;
		outline-offset: 0.25rem;
	}
	.criteria-scroll:focus-visible {
		outline: 2px solid var(--ring);
	}
	@media (max-width: 47.99rem) {
		.work-area {
			margin-top: 0.5rem;
		}
	}
	@media (min-width: 80rem) {
		.work-area {
			margin-top: 0.5rem;
		}
		.work-area :global([data-slot='tabs']) {
			gap: 0.25rem;
		}
	}
	.correction-jump-target {
		scroll-margin-block: 0.75rem;
	}
	.correction-jump-target:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
</style>
