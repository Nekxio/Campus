<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { assessmentStatusLabels, type RubricData, type StudentGrading } from '#lib/domain/grading.js';
	import { formatMark, type CalculatedGrade, type calculateStudent } from '#lib/domain/grade-calculation.js';
	import type { ResolvedPathname } from '$app/types';
	import StudentGradeExport from './StudentGradeExport.svelte';
	let {
		rubric,
		student,
		calculation,
		contextId,
		correctionHref,
		resultLabel
	}: {
		rubric: RubricData;
		student: StudentGrading;
		calculation: ReturnType<typeof calculateStudent>;
		contextId: string;
		correctionHref: ResolvedPathname;
		resultLabel: (grade: CalculatedGrade) => string;
	} = $props();
</script>

<div class="flex flex-col gap-2">
	<h2 class="panel-title">
		{student.name}
	</h2>
	<Badge variant={calculation.complete ? 'outline' : 'secondary'} class="self-start"
		>{calculation.complete ? 'Résultats complets' : 'Résultats en attente'}</Badge
	>
</div>
<Button href={correctionHref} class="h-auto min-h-11 w-full whitespace-normal">
	Ouvrir la correction détaillée<ChevronRightIcon data-icon="inline-end" />
</Button>
{#if rubric.results.length}<section class="module-results flex flex-col gap-3" aria-label="Résultats du module">
		{#each rubric.results as result (result.id)}
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h3 class="text-sm font-medium wrap-anywhere">{result.title}</h3>
				<p class="numeric-result">
					{resultLabel(calculation.results[result.id])}
				</p>
			</div>
		{/each}
	</section>{/if}
{#if rubric && contextId}{#key `${contextId}:${student.id}`}<StudentGradeExport
			{rubric}
			{contextId}
			{student}
		/>{/key}{/if}
<section class="flex flex-col gap-3" aria-label="Évaluations">
	<h3 class="text-sm font-semibold">Évaluations</h3>
	{#each rubric.assessments as assessment (assessment.id)}{@const record = student.corrections.find(
			(item) => item.assessmentId === assessment.id
		)}{@const grade = calculation.assessments[assessment.id]}
		<div class="flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h3 class="text-sm font-medium wrap-anywhere">{assessment.title}</h3>
				<p class="text-sm tabular-nums">{resultLabel(grade)}</p>
			</div>
			<p class="text-xs text-muted-foreground">
				{assessmentStatusLabels[record?.status ?? 'to_evaluate']}{assessment.purpose === 'formative'
					? ' · Formatif'
					: ''}
			</p>
			{#if grade.penalty > 0}<p class="text-xs text-muted-foreground tabular-nums">
					{formatMark(grade.rawMark)} brut · {grade.latenessDays} jour{grade.latenessDays > 1 ? 's' : ''} · −{formatMark(
						grade.penalty
					)} /20
				</p>{:else if record?.latenessDecision === 'exempt' && assessment.kind === 'project'}<p
					class="text-xs text-muted-foreground"
				>
					Exception de retard accordée
				</p>{:else if record?.latenessDecision === 'refused' && assessment.kind === 'project'}<p
					class="text-xs text-muted-foreground"
				>
					Production refusée
				</p>{/if}{#if grade.state !== 'ready' && grade.issues.length}<p
					class="text-xs wrap-anywhere text-muted-foreground"
				>
					{grade.state === 'invalid'
						? 'Points incompatibles avec le barème actuel.'
						: assessment.kind === 'project' &&
							  record?.status === 'graded' &&
							  !record.submittedAt &&
							  record.latenessDecision === 'automatic'
							? 'Date de remise à renseigner.'
							: 'Évaluation à compléter.'}
				</p>{/if}
		</div>{/each}
</section>

<style>
	.module-results {
		padding: 1rem;
		border-radius: var(--radius);
		background: var(--accent);
	}
</style>
