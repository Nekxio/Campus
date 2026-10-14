<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { AnnualHistory } from '#lib/domain/annual.js';
	import { assessmentStatusLabels } from '#lib/domain/grading.js';
	import {
		calculateStudent,
		formatMark,
		type CalculatedGrade
	} from '#lib/domain/grade-calculation.js';

	let { data }: { data: AnnualHistory } = $props();
	let expandedStudent = $state<string | null>(null);
	const grid = $derived(data.grid);
	const rubric = $derived(grid?.rubric);
	const context = $derived(rubric?.contexts.find((item) => item.id === grid?.contextId));
	const students = $derived(
		(grid?.students ?? []).map((student) => ({
			student,
			calculation: calculateStudent(
				rubric?.assessments ?? [],
				rubric?.results ?? [],
				student,
				context?.deadlines
			)
		}))
	);
	function date(value: string) {
		return new Intl.DateTimeFormat('fr-FR', {
			timeZone: 'Europe/Paris',
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
	function mark(grade: CalculatedGrade) {
		return grade.state === 'ready'
			? `${formatMark(grade.mark)} /20`
			: grade.state === 'invalid'
				? 'À corriger'
				: 'En attente';
	}
</script>

<div class="annual-history flex min-w-0 flex-col gap-6 border-t pt-5">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h3 class="min-w-0 text-base font-semibold wrap-anywhere">
			Historique · {data.moduleTitle} · {data.className} · {data.academicYear}
		</h3>
		<Badge variant="secondary">Lecture seule</Badge>
	</div>
	<section aria-label="Préparation conservée" class="flex min-w-0 flex-col gap-3">
		<h4 class="text-sm font-semibold">Préparation</h4>
		{#if data.preparation.framing.trim() || data.preparation.nextSteps.trim() || data.preparation.sourceLinks.length}
			{#if data.preparation.framing.trim()}<div>
					<h5 class="text-sm font-medium">Cadrage</h5>
					<p class="mt-1 max-w-prose text-sm wrap-anywhere whitespace-pre-wrap">
						{data.preparation.framing}
					</p>
				</div>{/if}
			{#if data.preparation.nextSteps.trim()}<div>
					<h5 class="text-sm font-medium">Suite à préparer</h5>
					<p class="mt-1 max-w-prose text-sm wrap-anywhere whitespace-pre-wrap">
						{data.preparation.nextSteps}
					</p>
				</div>{/if}
			{#if data.preparation.sourceLinks.length}<ul class="flex flex-col gap-1">
					{#each data.preparation.sourceLinks as source, index (index + source.url + source.label)}<li
							class="min-w-0"
						>
							<Button
								href={source.url}
								target="_blank"
								rel="noopener noreferrer"
								variant="link"
								class="min-h-11 max-w-full"
								><span class="min-w-0 wrap-anywhere whitespace-normal">{source.label}</span
								><ExternalLinkIcon data-icon="inline-end" /></Button
							>
						</li>{/each}
				</ul>{/if}
		{:else}<p class="text-sm text-muted-foreground">Aucune préparation enregistrée.</p>{/if}
	</section>
	<section aria-label="Calendrier conservé" class="flex min-w-0 flex-col gap-3">
		<h4 class="text-sm font-semibold">Calendrier · {data.lessons.length} séances</h4>
		{#if data.lessons.length}
			<ul class="divide-y border-y">
				{#each data.lessons as lesson (lesson.id)}
					<li class="flex min-w-0 flex-col gap-2 py-3">
						<div class="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
							<h5 class="min-w-0 text-sm font-medium wrap-anywhere">{lesson.title}</h5>
							<p class="text-sm text-muted-foreground">
								{date(lesson.startsAt)} – {date(lesson.endsAt)}
							</p>
						</div>
						{#if lesson.recap.trim()}<p
								class="max-w-prose text-sm wrap-anywhere whitespace-pre-wrap"
							>
								<span class="font-medium">Bilan : </span>{lesson.recap}
							</p>{/if}
						{#if lesson.toDo.trim()}<p
								class="max-w-prose text-sm wrap-anywhere whitespace-pre-wrap"
							>
								<span class="font-medium">À faire : </span>{lesson.toDo}
							</p>{/if}
					</li>
				{/each}
			</ul>
		{:else}<p class="text-sm text-muted-foreground">Aucune séance enregistrée.</p>{/if}
	</section>
	<section aria-label="Échéances conservées" class="flex min-w-0 flex-col gap-3">
		<h4 class="text-sm font-semibold">Échéances · {data.deadlines.length}</h4>
		{#if data.deadlines.length}<ul class="divide-y border-y">
				{#each data.deadlines as deadline (deadline.id)}<li
						class="flex min-w-0 flex-col gap-2 py-3"
					>
						<div class="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
							<h5 class="min-w-0 text-sm font-medium wrap-anywhere">{deadline.title}</h5>
							<p class="text-sm text-muted-foreground">{date(deadline.dueAt)}</p>
						</div>
						{#if deadline.submissionInstructions.trim()}<p
								class="max-w-prose text-sm wrap-anywhere whitespace-pre-wrap"
							>
								{deadline.submissionInstructions}
							</p>{/if}
					</li>{/each}
			</ul>{:else}<p class="text-sm text-muted-foreground">Aucune échéance enregistrée.</p>{/if}
	</section>
	<section aria-label="Résultats enregistrés" class="flex min-w-0 flex-col gap-3">
		<h4 class="text-sm font-semibold">Résultats et corrections</h4>
		{#if grid === null}
			<p class="text-sm text-muted-foreground">
				Les données étudiantes ont été purgées. Le calendrier et la préparation restent
				consultables.
			</p>
		{:else if !students.length}
			<Empty.Root
				><Empty.Header
					><Empty.Title>Aucun étudiant enregistré</Empty.Title><Empty.Description
						>Ce contexte ne contient pas de données étudiantes à consulter.</Empty.Description
					></Empty.Header
				></Empty.Root
			>
		{:else}
			<p class="max-w-prose text-sm text-muted-foreground">
				La grille reprend les données enregistrées. Les résultats utilisent le barème conservé ; les
				points bruts et les commentaires restent consultables ci-dessous.
			</p>
			{#if rubric?.results.length}
				<Table.Root>
					<Table.Caption
						>Résultats de {data.className}, {data.academicYear} · lecture seule</Table.Caption
					>
					<Table.Header
						><Table.Row
							><Table.Head>Étudiant</Table.Head
							>{#each rubric.results as result (result.id)}<Table.Head
									class="max-w-64 text-right whitespace-normal">{result.title}</Table.Head
								>{/each}</Table.Row
						></Table.Header
					>
					<Table.Body
						>{#each students as item (item.student.id)}<Table.Row
								><Table.Cell class="max-w-64 min-w-40 wrap-anywhere whitespace-normal"
									>{item.student.name}</Table.Cell
								>{#each rubric.results as result (result.id)}<Table.Cell
										class="text-right tabular-nums"
										>{mark(item.calculation.results[result.id])}</Table.Cell
									>{/each}</Table.Row
							>{/each}</Table.Body
					>
				</Table.Root>
			{:else}<p class="text-sm text-muted-foreground">Aucun résultat défini dans le barème.</p>{/if}
			<div class="divide-y border-y">
				{#each students as item (item.student.id)}
					<details class="min-w-0 py-1" open={expandedStudent === item.student.id}>
						<summary
							onclick={(event) => {
								event.preventDefault();
								expandedStudent = expandedStudent === item.student.id ? null : item.student.id;
							}}
							class="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
							><span class="min-w-0 wrap-anywhere">{item.student.name} · détails enregistrés</span
							><ChevronDownIcon class="size-4 shrink-0" aria-hidden="true" /></summary
						>
						{#if expandedStudent === item.student.id}<div
								class="flex min-w-0 flex-col gap-5 px-2 pt-2 pb-4"
							>
								{#each rubric?.assessments ?? [] as assessment (assessment.id)}
									{@const record = item.student.corrections.find(
										(correction) => correction.assessmentId === assessment.id
									)}
									{@const grade = item.calculation.assessments[assessment.id]}
									<div class="flex min-w-0 flex-col gap-2">
										<div class="flex flex-wrap justify-between gap-2">
											<h5 class="min-w-0 text-sm font-semibold wrap-anywhere">
												{assessment.title}
											</h5>
											<p class="text-sm">{mark(grade)}</p>
										</div>
										<p class="text-sm text-muted-foreground">
											{assessmentStatusLabels[
												record?.status ?? 'to_evaluate'
											]}{assessment.purpose === 'formative'
												? ' · Formatif, exclu des résultats'
												: ''}
										</p>
										{#if record?.submittedAt}<p class="text-sm text-muted-foreground">
												Remis le {date(record.submittedAt)}
											</p>{/if}
										{#if record?.submissionUrl}<Button
												href={record.submissionUrl}
												target="_blank"
												rel="noopener noreferrer"
												variant="link"
												class="min-h-11 self-start"
												>Consulter la remise<ExternalLinkIcon data-icon="inline-end" /></Button
											>{/if}
										{#if assessment.kind === 'project' && record}<p
												class="text-sm text-muted-foreground"
											>
												{record.latenessDecision === 'exempt'
													? 'Exception de retard accordée.'
													: record.latenessDecision === 'refused'
														? 'Production refusée.'
														: `${grade.latenessDays} jours de retard · pénalité de ${grade.penalty} points sur 20.`}
											</p>{/if}
										<Table.Root
											><Table.Caption>Points bruts enregistrés · {assessment.title}</Table.Caption
											><Table.Header
												><Table.Row
													><Table.Head>Critère</Table.Head><Table.Head class="text-right"
														>Points</Table.Head
													><Table.Head class="text-right">Maximum</Table.Head></Table.Row
												></Table.Header
											><Table.Body
												>{#each assessment.lines as line (line.id)}<Table.Row
														><Table.Cell class="max-w-96 wrap-anywhere whitespace-normal"
															>{line.label}</Table.Cell
														><Table.Cell class="text-right tabular-nums"
															>{record?.scores.find((score) => score.lineId === line.id)?.points ??
																'Non saisi'}</Table.Cell
														><Table.Cell class="text-right tabular-nums"
															>{line.maxPoints}</Table.Cell
														></Table.Row
													>{/each}</Table.Body
											></Table.Root
										>
										{#if grade.issues.length}<ul
												class="flex flex-col gap-1 text-sm text-muted-foreground"
											>
												{#each [...new Set(grade.issues)] as issue (issue)}<li>{issue}</li>{/each}
											</ul>{/if}
									</div>
								{/each}
								{#if item.student.retiredScores.length}<div>
										<h5 class="text-sm font-semibold">Critères retirés du barème</h5>
										<ul class="mt-2 flex flex-col gap-2 text-sm">
											{#each item.student.retiredScores as score, index (index + score.assessmentTitle + score.label)}<li
													class="wrap-anywhere"
												>
													{score.assessmentTitle} · {score.label} :
													<span class="tabular-nums"
														>{score.points ?? 'Non saisi'} / {score.maxPoints}</span
													>
												</li>{/each}
										</ul>
									</div>{/if}
								<div>
									<h5 class="text-sm font-semibold">Commentaire privé de semestre</h5>
									<p class="mt-2 max-w-prose text-sm wrap-anywhere whitespace-pre-wrap">
										{item.student.comment.content.trim()
											? item.student.comment.content
											: 'Aucun commentaire enregistré.'}
									</p>
								</div>
							</div>{/if}
					</details>
				{/each}
			</div>
		{/if}
	</section>
</div>
