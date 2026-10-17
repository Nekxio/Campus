<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { page } from '$app/state';
	import GradeExport from './GradeExport.svelte';
	import StudentGradeExport from './StudentGradeExport.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { assessmentStatusLabels } from '#lib/domain/grading.js';
	import type { GradeWorkspaceData } from '#lib/domain/grading-selection.js';
	import {
		calculateStudent,
		formatMark,
		type CalculatedGrade
	} from '#lib/domain/grade-calculation.js';
	let { data }: { data: GradeWorkspaceData } = $props();
	let search = $state('');
	let filter = $state('all');
	// Kit 3 keeps page.url on the loaded page during shallow student selection.
	const selectionUrl = $derived(page.shallow?.url ?? page.url);
	const selectedId = $derived(selectionUrl.searchParams.get('etudiant'));
	let pending = $state(false);
	let errorMessage = $state('');
	let requestVersion = 0;
	function savedSelection() {
		return {
			academicYear: data.academicYear ?? '',
			classId: data.classId ?? '',
			moduleId: data.rubric?.module.id ?? '',
			contextId: data.contextId ?? ''
		};
	}
	let chosen = $derived(savedSelection());
	const matchingYear = $derived(chosen.academicYear === (data.academicYear ?? ''));
	const matchingClass = $derived(matchingYear && chosen.classId === (data.classId ?? ''));
	const matchingGrid = $derived(
		matchingClass &&
			chosen.moduleId === (data.rubric?.module.id ?? '') &&
			chosen.contextId === (data.contextId ?? '')
	);
	const classOptions = $derived(matchingYear ? data.classes : []);
	const moduleOptions = $derived(matchingClass ? data.modules : []);
	const rubric = $derived(!pending && matchingGrid ? data.rubric : null);
	const context = $derived(rubric?.contexts.find((item) => item.id === data.contextId));
	function normalized(value: string) {
		return value
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLocaleLowerCase('fr');
	}
	const calculatedStudents = $derived(
		(rubric ? data.students : []).map((student) => ({
			student,
			calculation: calculateStudent(
				rubric?.assessments ?? [],
				rubric?.results ?? [],
				student,
				context?.deadlines
			)
		}))
	);
	const filtered = $derived(
		calculatedStudents.filter(
			(item) =>
				normalized(item.student.name).includes(normalized(search)) &&
				(filter === 'all' ||
					(filter === 'complete'
						? item.calculation.complete
						: filter === 'pending'
							? !item.calculation.complete
							: item.student.corrections.some((record) => record.status.startsWith('absent_'))))
		)
	);
	const selected = $derived(filtered.find((item) => item.student.id === selectedId) ?? filtered[0]);
	const completeCount = $derived(
		calculatedStudents.filter((item) => item.calculation.complete).length
	);
	function resultLabel(grade: CalculatedGrade) {
		return grade.state === 'ready'
			? `${formatMark(grade.mark)} /20`
			: grade.state === 'invalid'
				? 'À corriger'
				: 'En attente';
	}
	async function selectContext(next: ReturnType<typeof savedSelection>) {
		const version = ++requestVersion;
		chosen = next;
		pending = true;
		errorMessage = '';
		const query = new SvelteURLSearchParams({ annee: next.academicYear });
		if (next.classId) query.set('classe', next.classId);
		if (next.moduleId) query.set('module', next.moduleId);
		if (next.contextId) query.set('contexte', next.contextId);
		const destination = (resolve('/enseignant/notation') + '?' + query) as ResolvedPathname;
		try {
			await goto(destination);
			if (version !== requestVersion) return;
			search = '';
			filter = 'all';
		} catch {
			if (version !== requestVersion) return;
			chosen = savedSelection();
			errorMessage = 'Impossible d’ouvrir cette grille. Réessayez.';
		} finally {
			if (version === requestVersion) pending = false;
		}
	}
	async function selectStudent(id: string) {
		const contextId = data.contextId;
		const query = new SvelteURLSearchParams(selectionUrl.search);
		query.set('etudiant', id);
		await goto((resolve('/enseignant/notation') + '?' + query) as ResolvedPathname, {
			shallow: true,
			replace: true,
			state: page.state
		});
		if (window.matchMedia('(max-width: 63.99rem)').matches) {
			await tick();
			if (pending || data.contextId !== contextId || selectedId !== id) return;
			const summary = document.getElementById('selected-student-summary');
			summary?.focus({ preventScroll: true });
			summary?.scrollIntoView({
				block: 'start',
				behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
					? 'instant'
					: 'smooth'
			});
		}
	}
	function selectStudentFromRow(event: MouseEvent, id: string) {
		if (
			event.defaultPrevented ||
			!(event.target instanceof Element) ||
			event.target.closest(
				'a, button, input, select, textarea, label, [role="button"], [role="link"], [contenteditable]'
			)
		)
			return;
		void selectStudent(id);
	}

	function correctionLink(studentId: string) {
		return resolve('/enseignant/notation/[contextId]/[studentId]', {
			contextId: data.contextId!,
			studentId
		});
	}
</script>

<div class="grade-grid flex min-w-0 flex-col gap-6">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="flex flex-col gap-2">
			<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Notation</h1>
			<p class="text-sm text-muted-foreground">
				Retrouvez les résultats du module et les évaluations à compléter.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button
				href={resolve('/enseignant/propositions') +
					(rubric && data.contextId ? `?contexte=${data.contextId}` : '')}
				variant="outline"
				class="min-h-11">Propositions</Button
			>
			{#if rubric}<Button
					href={`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: rubric.module.id })}?retour=notation${data.contextId ? '&contexte=' + data.contextId : ''}`}
					variant="outline"
					class="min-h-11">Modifier le barème</Button
				>{/if}
		</div>
	</div>
	{#if errorMessage}<Alert.Root variant="destructive"
			><CircleAlertIcon aria-hidden="true" /><Alert.Title>Grille indisponible</Alert.Title
			><Alert.Description>{errorMessage}</Alert.Description></Alert.Root
		>{/if}
	<Field.Field class="max-w-xs">
		<Field.FieldLabel for="grading-year">Année de travail</Field.FieldLabel>
		<NativeSelect.Root
			id="grading-year"
			value={chosen.academicYear}
			disabled={data.academicYears.length === 0}
			class="w-full"
			onchange={(event) =>
				selectContext({
					academicYear: event.currentTarget.value,
					classId: '',
					moduleId: '',
					contextId: ''
				})}
		>
			<NativeSelect.Option value="">Choisir une année</NativeSelect.Option>
			{#each data.academicYears as year (year)}
				<NativeSelect.Option value={year}>{year}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
	</Field.Field>
	<Field.FieldGroup class="grid-filters min-w-0 gap-4">
		<Field.Field
			><Field.FieldLabel for="grading-context">Classe et année</Field.FieldLabel><NativeSelect.Root
				id="grading-context"
				value={chosen.classId}
				disabled={!chosen.academicYear || classOptions.length === 0}
				class="w-full"
				onchange={(event) =>
					selectContext({
						...chosen,
						classId: event.currentTarget.value,
						moduleId: '',
						contextId: ''
					})}
				><NativeSelect.Option value="">Choisir une classe</NativeSelect.Option
				>{#each classOptions as item (item.id)}<NativeSelect.Option value={item.id}
						>{item.name} · {item.academicYear}</NativeSelect.Option
					>{/each}</NativeSelect.Root
			></Field.Field
		>
		<Field.Field
			><Field.FieldLabel for="grading-module">Module</Field.FieldLabel><NativeSelect.Root
				id="grading-module"
				value={chosen.moduleId}
				disabled={!chosen.classId || moduleOptions.length === 0}
				class="w-full"
				onchange={(event) =>
					selectContext({
						...chosen,
						moduleId: event.currentTarget.value,
						contextId:
							data.contexts.find((item) => item.moduleId === event.currentTarget.value)?.id ?? ''
					})}
				><NativeSelect.Option value="">Choisir un module</NativeSelect.Option
				>{#each moduleOptions as item (item.id)}<NativeSelect.Option value={item.id}
						>{item.title}</NativeSelect.Option
					>{/each}</NativeSelect.Root
			></Field.Field
		>
	</Field.FieldGroup>
	{#if rubric && data.contextId}{#key data.contextId}<GradeExport {data} />{/key}{/if}
	{#if pending}
		<p role="status" class="py-6 text-sm text-muted-foreground">Chargement de la grille…</p>
	{:else if !data.academicYear}
		<Empty.Root
			><Empty.Header>
				<Empty.Title
					>{data.academicYears.length
						? 'Choisissez l’année de travail'
						: 'Aucune année disponible'}</Empty.Title
				>
				<Empty.Description
					>{data.academicYears.length
						? 'Sélectionnez une année ouverte pour retrouver ses classes.'
						: 'Créez une classe pour commencer la notation.'}</Empty.Description
				>
			</Empty.Header><Empty.Content
				><Button href={resolve('/enseignant/classes')} variant="outline">Voir les classes</Button
				></Empty.Content
			></Empty.Root
		>
	{:else if !data.classId}
		<Empty.Root
			><Empty.Header>
				<Empty.Title>Aucune classe sélectionnée</Empty.Title>
				<Empty.Description
					>Choisissez une classe pour retrouver ses modules et ses étudiants.</Empty.Description
				>
			</Empty.Header></Empty.Root
		>
	{:else if !rubric}
		<Empty.Root
			><Empty.Header
				><Empty.Title
					>{data.modules.length
						? 'Choisissez un module'
						: 'Aucun module pour cette classe'}</Empty.Title
				><Empty.Description
					>{data.modules.length
						? 'Sélectionnez le module dont vous souhaitez consulter les résultats.'
						: 'Rattachez un module à cette classe pour commencer la notation.'}</Empty.Description
				></Empty.Header
			><Empty.Content
				><Button href={resolve('/')} variant="outline" class="min-h-11">Voir les modules</Button
				></Empty.Content
			></Empty.Root
		>
	{:else if !data.contextId}
		<Empty.Root
			><Empty.Header
				><Empty.Title>Aucune classe sélectionnée</Empty.Title><Empty.Description
					>Rattachez une classe à ce module, puis sélectionnez-la pour commencer.</Empty.Description
				></Empty.Header
			><Empty.Content
				><Button
					href={resolve('/enseignant/modules/[moduleId]', { moduleId: rubric.module.id })}
					variant="outline"
					class="min-h-11">Ouvrir le module</Button
				></Empty.Content
			></Empty.Root
		>
	{:else if rubric.assessments.length === 0}
		<Empty.Root
			><Empty.Header
				><Empty.Title>Le barème est à préparer</Empty.Title><Empty.Description
					>Ajoutez les évaluations, les groupes et les critères du module.</Empty.Description
				></Empty.Header
			><Empty.Content
				><Button
					href={`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: rubric.module.id })}?retour=notation${data.contextId ? '&contexte=' + data.contextId : ''}`}
					class="min-h-11">Préparer le barème</Button
				></Empty.Content
			></Empty.Root
		>
	{:else if data.students.length === 0}
		<Empty.Root
			><Empty.Header
				><Empty.Title>Aucun étudiant dans cette classe</Empty.Title><Empty.Description
					>Ajoutez les étudiants à la classe pour ouvrir leurs corrections.</Empty.Description
				></Empty.Header
			><Empty.Content
				><Button href={resolve('/enseignant/classes')} variant="outline" class="min-h-11"
					>Voir les classes</Button
				></Empty.Content
			></Empty.Root
		>
	{:else}
		<Field.FieldGroup class="search-filters min-w-0 gap-4"
			><Field.Field
				><Field.FieldLabel for="grading-search">Rechercher un étudiant</Field.FieldLabel><Input
					id="grading-search"
					type="search"
					bind:value={search}
					class="min-h-11"
					placeholder="Nom de l’étudiant"
				/></Field.Field
			><Field.Field
				><Field.FieldLabel for="grading-filter">Afficher</Field.FieldLabel><NativeSelect.Root
					id="grading-filter"
					bind:value={filter}
					class="w-full"
					><NativeSelect.Option value="all">Tous les étudiants</NativeSelect.Option
					><NativeSelect.Option value="pending">Résultats en attente</NativeSelect.Option
					><NativeSelect.Option value="complete">Résultats complets</NativeSelect.Option
					><NativeSelect.Option value="absence">Avec une absence</NativeSelect.Option
					></NativeSelect.Root
				></Field.Field
			></Field.FieldGroup
		>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 id="student-list-title" class="text-xl font-semibold tracking-tight">
				{context?.className} · {context?.academicYear}
			</h2>
			<p class="text-sm text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
				{filtered.length} / {data.students.length} étudiant{data.students.length > 1 ? 's' : ''} · {completeCount}
				résultat{completeCount > 1 ? 's complets' : ' complet'}
			</p>
		</div>
		<div class="results-layout">
			<section class="min-w-0" aria-labelledby="student-list-title">
				{#if filtered.length === 0}<Empty.Root
						><Empty.Header
							><Empty.Title>Aucun étudiant trouvé</Empty.Title><Empty.Description
								>Modifiez la recherche ou le filtre pour retrouver un étudiant.</Empty.Description
							></Empty.Header
						><Empty.Content
							><Button
								type="button"
								variant="outline"
								class="min-h-11"
								onclick={() => {
									search = '';
									filter = 'all';
								}}>Réinitialiser les filtres</Button
							></Empty.Content
						></Empty.Root
					>
				{:else}
					<div class="desktop-grid overflow-hidden rounded-xl border">
						<Table.Root
							><Table.Caption class="sr-only"
								>Résultats du module. Sélectionnez un étudiant pour afficher son bilan.</Table.Caption
							><Table.Header
								><Table.Row
									><Table.Head>Étudiant</Table.Head
									>{#each rubric.results as result (result.id)}<Table.Head
											>{result.title}</Table.Head
										>{/each}<Table.Head>État</Table.Head></Table.Row
								></Table.Header
							><Table.Body
								>{#each filtered as item (item.student.id)}<Table.Row
										class="cursor-pointer focus-within:bg-muted/50"
										data-selected={selected?.student.id === item.student.id}
										onclick={(event) => selectStudentFromRow(event, item.student.id)}
										><Table.Cell
											><Button
												type="button"
												variant="ghost"
												class="min-h-11 max-w-full justify-start text-left whitespace-normal"
												aria-pressed={selected?.student.id === item.student.id}
												aria-controls="selected-student-summary"
												onclick={() => selectStudent(item.student.id)}>{item.student.name}</Button
											></Table.Cell
										>{#each rubric.results as result (result.id)}<Table.Cell class="tabular-nums"
												>{resultLabel(item.calculation.results[result.id])}</Table.Cell
											>{/each}<Table.Cell
											><Badge variant={item.calculation.complete ? 'outline' : 'secondary'}
												>{item.calculation.complete ? 'Complet' : 'En attente'}</Badge
											></Table.Cell
										></Table.Row
									>{/each}</Table.Body
							></Table.Root
						>
					</div>
					<div class="mobile-grid flex flex-col border-t">
						{#each filtered as item (item.student.id)}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (The named button remains the keyboard control; the row adds a larger pointer target.) -->
							<div
								class="student-row flex cursor-pointer flex-col gap-2 border-b py-4 focus-within:bg-muted/50 hover:bg-muted/50"
								data-selected={selected?.student.id === item.student.id}
								onclick={(event) => selectStudentFromRow(event, item.student.id)}
							>
								<Button
									type="button"
									variant="ghost"
									class="min-h-11 max-w-full justify-start text-left whitespace-normal"
									aria-pressed={selected?.student.id === item.student.id}
									aria-controls="selected-student-summary"
									onclick={() => selectStudent(item.student.id)}
									>{item.student.name}<ChevronRightIcon data-icon="inline-end" /></Button
								>
								<dl class="flex flex-col gap-2 px-3">
									{#each rubric.results as result (result.id)}<div
											class="flex flex-wrap justify-between gap-x-4 gap-y-1"
										>
											<dt class="text-sm wrap-anywhere text-muted-foreground">{result.title}</dt>
											<dd class="text-sm tabular-nums">
												{resultLabel(item.calculation.results[result.id])}
											</dd>
										</div>{/each}
								</dl>
								<Badge
									variant={item.calculation.complete ? 'outline' : 'secondary'}
									class="ml-3 self-start"
									>{item.calculation.complete ? 'Complet' : 'En attente'}</Badge
								>
							</div>{/each}
					</div>
				{/if}
				{#if rubric.results.length === 0}<p class="mt-3 text-sm text-muted-foreground">
						Aucun résultat de module défini. Consultez les évaluations dans le bilan de chaque
						étudiant.
					</p>{/if}
			</section>
			{#if selected}<aside
					id="selected-student-summary"
					tabindex="-1"
					class="student-summary flex min-w-0 flex-col gap-5"
					aria-label={`Bilan de ${selected.student.name}`}
				>
					<div class="flex flex-col gap-2">
						<h2 class="text-xl font-semibold tracking-tight wrap-anywhere">
							{selected.student.name}
						</h2>
						<Badge
							variant={selected.calculation.complete ? 'outline' : 'secondary'}
							class="self-start"
							>{selected.calculation.complete
								? 'Résultats complets'
								: 'Résultats en attente'}</Badge
						>
					</div>
					<section class="flex flex-col gap-3" aria-label="Évaluations">
						{#if rubric && data.contextId}{#key `${data.contextId}:${selected.student.id}`}<StudentGradeExport
									{rubric}
									contextId={data.contextId}
									student={selected.student}
								/>{/key}{/if}
						{#each rubric.assessments as assessment (assessment.id)}{@const record =
								selected.student.corrections.find(
									(item) => item.assessmentId === assessment.id
								)}{@const grade = selected.calculation.assessments[assessment.id]}
							<div class="flex flex-col gap-1 border-b pb-3">
								<div class="flex flex-wrap items-baseline justify-between gap-2">
									<h3 class="text-sm font-medium wrap-anywhere">{assessment.title}</h3>
									<p class="text-sm tabular-nums">{resultLabel(grade)}</p>
								</div>
								<p class="text-xs text-muted-foreground">
									{assessmentStatusLabels[record?.status ?? 'to_evaluate']}{assessment.purpose ===
									'formative'
										? ' · Formatif'
										: ''}
								</p>
								{#if grade.penalty > 0}<p class="text-xs text-muted-foreground tabular-nums">
										{formatMark(grade.rawMark)} brut · {grade.latenessDays} jour{grade.latenessDays >
										1
											? 's'
											: ''} · −{formatMark(grade.penalty)} /20
									</p>{:else if record?.latenessDecision === 'exempt' && assessment.kind === 'project'}<p
										class="text-xs text-muted-foreground"
									>
										Exception de retard accordée
									</p>{:else if record?.latenessDecision === 'refused' && assessment.kind === 'project'}<p
										class="text-xs text-muted-foreground"
									>
										Production refusée
									</p>{/if}{#if grade.issues.length}<p
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
					{#if rubric.results.length}<section
							class="flex flex-col gap-3"
							aria-label="Résultats du module"
						>
							{#each rubric.results as result (result.id)}<div
									class="flex flex-wrap items-baseline justify-between gap-2"
								>
									<h3 class="text-sm font-medium wrap-anywhere">{result.title}</h3>
									<p class="font-medium tabular-nums">
										{resultLabel(selected.calculation.results[result.id])}
									</p>
								</div>{/each}
						</section>{/if}
					<Button
						href={correctionLink(selected.student.id)}
						class="min-h-11 w-full whitespace-normal"
						>Ouvrir la correction détaillée<ChevronRightIcon data-icon="inline-end" /></Button
					>
					<a
						href="#student-list-title"
						class="inline-flex min-h-11 items-center text-sm underline underline-offset-4 lg:hidden"
						>Retour à la liste des étudiants</a
					>
				</aside>{/if}
		</div>
	{/if}
</div>

<style>
	.grade-grid :global([data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.grade-grid :global(.grid-filters),
	.grade-grid :global(.search-filters) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.results-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2rem;
	}
	.desktop-grid {
		display: none;
	}
	.mobile-grid {
		display: flex;
	}
	.student-summary {
		border-top: 1px solid var(--border);
		padding-top: 1.5rem;
	}
	.student-row[data-selected='true'] {
		background: var(--muted);
	}
	@media (min-width: 40rem) {
		.grade-grid :global(.search-filters) {
			grid-template-columns: minmax(0, 1fr) minmax(13rem, 0.5fr);
		}
	}
	@media (min-width: 64rem) {
		.grade-grid :global(.grid-filters) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.results-layout {
			grid-template-columns: minmax(0, 1fr) minmax(16rem, 19rem);
			gap: 1.5rem;
			align-items: start;
		}
		.student-summary {
			border-top: 0;
			border-left: 1px solid var(--border);
			padding-top: 0;
			padding-left: 1.5rem;
			position: sticky;
			top: 5rem;
		}
	}
	@media (min-width: 80rem) {
		.desktop-grid {
			display: block;
		}
		.mobile-grid {
			display: none;
		}
		.desktop-grid :global([data-slot='table-row'][data-selected='true']) {
			background: var(--muted);
		}
		.desktop-grid :global([data-slot='table-head']),
		.desktop-grid :global([data-slot='table-cell']) {
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.grade-grid :global([data-slot='native-select']) {
			font-size: 0.875rem;
		}
	}
	@media (pointer: coarse) {
		.grade-grid :global([data-slot='native-select']),
		.grade-grid :global([data-slot='input']) {
			font-size: 1rem;
		}
	}
</style>
