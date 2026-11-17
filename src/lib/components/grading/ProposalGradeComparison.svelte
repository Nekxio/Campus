<script lang="ts">
	import * as Table from '#lib/components/ui/table/index.js';
	import type { RubricData, RubricAssessment } from '#lib/domain/grading.js';
	import { formatMark, type calculateStudent, type CalculatedGrade } from '#lib/domain/grade-calculation.js';
	import { assessmentWeights } from '#lib/grading/correction-form.js';
	import { resultRuleLabel } from '#lib/grading/grade-labels.js';

	let {
		rubric,
		assessment,
		recorded,
		proposed,
		retained
	}: {
		rubric: RubricData;
		assessment: RubricAssessment;
		recorded: ReturnType<typeof calculateStudent>;
		proposed: ReturnType<typeof calculateStudent>;
		retained: ReturnType<typeof calculateStudent>;
	} = $props();
	const gradeLabel = (grade: CalculatedGrade, withPoints = false) => {
		const mark =
			grade.state === 'ready'
				? `${formatMark(grade.mark)} /20`
				: grade.state === 'invalid'
					? 'À corriger'
					: 'En attente';
		return withPoints ? `${grade.rawPoints ?? 'N/D'} / ${grade.maxPoints} · ${mark}` : mark;
	};
</script>

<div class="result-summary flex min-w-0 flex-col gap-1">
	<h2 class="item-title">Bilan des évaluations</h2>
	<div class="desktop-results">
		<Table.Root class="table-fixed"
			><Table.Caption class="sr-only">Comparaison des résultats enregistrés, proposés et retenus</Table.Caption
			><Table.Header
				><Table.Row
					><Table.Head>Résultat</Table.Head><Table.Head>Enregistré</Table.Head><Table.Head>Proposé</Table.Head
					><Table.Head>Retenu</Table.Head></Table.Row
				></Table.Header
			><Table.Body>
				<Table.Row
					><Table.Cell>{assessment.title} · {assessmentWeights(assessment, rubric)}</Table.Cell><Table.Cell
						>{gradeLabel(recorded.assessments[assessment.id], true)}</Table.Cell
					><Table.Cell>{gradeLabel(proposed.assessments[assessment.id], true)}</Table.Cell><Table.Cell
						>{gradeLabel(retained.assessments[assessment.id], true)}</Table.Cell
					></Table.Row
				>
				{#each rubric.results as result (result.id)}<Table.Row
						><Table.Cell>{result.title}</Table.Cell><Table.Cell>{gradeLabel(recorded.results[result.id])}</Table.Cell
						><Table.Cell>{gradeLabel(proposed.results[result.id])}</Table.Cell><Table.Cell
							>{gradeLabel(retained.results[result.id])}</Table.Cell
						></Table.Row
					>{/each}
			</Table.Body></Table.Root
		>
	</div>
	<div class="mobile-results flex flex-col gap-3">
		{#each [{ id: assessment.id, title: assessment.title, withPoints: true }, ...rubric.results.map( (result) => ({ id: result.id, title: result.title, withPoints: false }) )] as item (item.id)}<div
				class="flex flex-col gap-1"
			>
				<h3 class="text-sm font-medium wrap-anywhere">{item.title}</h3>
				<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm tabular-nums">
					<dt class="text-muted-foreground">Enregistré</dt>
					<dd>
						{gradeLabel(item.withPoints ? recorded.assessments[item.id] : recorded.results[item.id], item.withPoints)}
					</dd>
					<dt class="text-muted-foreground">Proposé</dt>
					<dd>
						{gradeLabel(item.withPoints ? proposed.assessments[item.id] : proposed.results[item.id], item.withPoints)}
					</dd>
					<dt class="text-muted-foreground">Retenu</dt>
					<dd>
						{gradeLabel(item.withPoints ? retained.assessments[item.id] : retained.results[item.id], item.withPoints)}
					</dd>
				</dl>
			</div>{/each}
	</div>
	<p class="text-xs wrap-anywhere text-muted-foreground">
		{rubric.assessments
			.filter((item) => item.id !== assessment.id)
			.map(
				(item) =>
					`${item.title} · ${gradeLabel(recorded.assessments[item.id], true)} · ${assessmentWeights(item, rubric)}`
			)
			.join(' ; ')}
	</p>
	{#if !rubric.results.length}<p class="text-xs text-muted-foreground">
			Aucun résultat de module défini. Les évaluations restent indépendantes.
		</p>{:else}<p class="text-xs text-muted-foreground">
			{rubric.results
				.map(
					(result) =>
						`${rubric.results.length > 1 ? result.title + ' : ' : ''}${resultRuleLabel(result, rubric.assessments)}`
				)
				.join(' · ')}. Les évaluations formatives sont exclues des résultats.
		</p>{/if}
</div>

<style>
	.result-summary {
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border);
	}
	.desktop-results {
		display: none;
	}
	.mobile-results {
		display: flex;
	}
	@media (min-width: 64rem) {
		.desktop-results {
			display: block;
		}
		.mobile-results {
			display: none;
		}
		.desktop-results :global([data-slot='table-container']) {
			overflow: visible;
		}
		.desktop-results :global([data-slot='table-head']),
		.desktop-results :global([data-slot='table-cell']) {
			height: auto;
			padding: 0.25rem 0.5rem;
			font-size: 0.75rem;
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.desktop-results :global([data-slot='table-head']:first-child),
		.desktop-results :global([data-slot='table-cell']:first-child) {
			padding-left: 0;
		}
		.desktop-results :global([data-slot='table-cell']:last-child),
		.desktop-results :global([data-slot='table-head']:last-child) {
			background: var(--muted);
		}
	}
</style>
