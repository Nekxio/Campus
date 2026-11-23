<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { page } from '$app/state';
	import GradeExport from './GradeExport.svelte';
	import ModulePageNavigation from '#lib/components/teaching/ModulePageNavigation.svelte';
	import StudentGradeSummary from './StudentGradeSummary.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import BookIcon from '@lucide/svelte/icons/book-open';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import UsersIcon from '@lucide/svelte/icons/users';

	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { gradingSelectionQuery, type GradeWorkspaceData } from '#lib/domain/grading-selection.js';
	import { calculateStudent, formatMark, type CalculatedGrade } from '#lib/domain/grade-calculation.js';
	let { data }: { data: GradeWorkspaceData } = $props();
	let search = $state('');
	let filter = $state('all');
	let contextExpanded = $state(false);
	let filtersOpen = $state(false);
	let overviewSelectionId = $state<string | null>(null);
	let rosterPosition: { contextId: string | null; studentId: string; x: number; y: number } | null = null;
	const filterLabels: Record<string, string> = {
		all: 'Tous les étudiants',
		pending: 'Résultats en attente',
		complete: 'Résultats complets',
		absence: 'Avec une absence'
	};
	const activeFilterCount = $derived(Number(Boolean(search)) + Number(filter !== 'all'));
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
		matchingClass && chosen.moduleId === (data.rubric?.module.id ?? '') && chosen.contextId === (data.contextId ?? '')
	);
	const classOptions = $derived(matchingYear ? data.classes : []);
	const moduleOptions = $derived(matchingClass ? data.modules : []);
	const rubric = $derived(!pending && matchingGrid ? data.rubric : null);
	const context = $derived(rubric?.contexts.find((item) => item.id === data.contextId));
	const completeContext = $derived(
		Boolean(matchingGrid && chosen.academicYear && chosen.classId && chosen.moduleId && chosen.contextId && data.rubric)
	);
	function normalized(value: string) {
		return value
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLocaleLowerCase('fr');
	}
	const calculatedStudents = $derived(
		(rubric ? data.students : []).map((student) => ({
			student,
			calculation: calculateStudent(rubric?.assessments ?? [], rubric?.results ?? [], student, context?.deadlines)
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
	const selected = $derived(
		filtered.find((item) => item.student.id === (selectedId ?? overviewSelectionId)) ?? filtered[0]
	);
	const returnSection = $derived.by(() => {
		const section = selectionUrl.searchParams.get('section');
		return section && ['information', 'preparation', 'resources', 'planning'].includes(section)
			? section
			: 'preparation';
	});
	const rubricLink = $derived.by(() => {
		if (!rubric) return resolve('/enseignant/notation');
		const query = gradingSelectionQuery({
			academicYear: data.academicYear,
			classId: data.classId,
			moduleId: rubric.module.id,
			contextId: data.contextId,
			studentId: selected?.student.id
		});
		query.set('section', returnSection);
		query.set('retour', 'notation');
		return `${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: rubric.module.id })}?${query}`;
	});
	const mobileDetailOpen = $derived(Boolean(selectedId && selected));
	const completeCount = $derived(calculatedStudents.filter((item) => item.calculation.complete).length);
	function resultLabel(grade: CalculatedGrade) {
		return grade.state === 'ready'
			? `${formatMark(grade.mark)} /20`
			: grade.state === 'invalid'
				? 'À corriger'
				: 'En attente';
	}
	const selectContext = async (next: ReturnType<typeof savedSelection>, cleared?: 'class' | 'module') => {
		const version = ++requestVersion;
		contextExpanded = true;
		chosen = next;
		pending = true;
		errorMessage = '';
		const query = new SvelteURLSearchParams({ annee: next.academicYear });
		if (next.classId) query.set('classe', next.classId);
		if (next.moduleId) query.set('module', next.moduleId);
		if (next.contextId) query.set('contexte', next.contextId);
		if (cleared === 'class') query.set('classe', '');
		if (cleared === 'module') query.set('module', '');
		const destination = (resolve('/enseignant/notation') + '?' + query) as ResolvedPathname;
		try {
			await goto(destination);
			if (version !== requestVersion) return;
			search = '';
			filter = 'all';
			overviewSelectionId = null;
			rosterPosition = null;
		} catch {
			if (version !== requestVersion) return;
			chosen = savedSelection();
			errorMessage = 'Impossible d’ouvrir cette grille. Réessayez.';
		} finally {
			if (version === requestVersion) pending = false;
		}
	};
	async function selectStudent(id: string) {
		const contextId = data.contextId;
		if (!window.matchMedia('(min-width: 64rem)').matches) {
			rosterPosition = { contextId, studentId: id, x: window.scrollX, y: window.scrollY };
		}
		const query = new SvelteURLSearchParams(selectionUrl.search);
		query.set('etudiant', id);
		await goto((resolve('/enseignant/notation') + '?' + query) as ResolvedPathname, {
			shallow: true,
			replace: true,
			state: page.state
		});
		if (!window.matchMedia('(min-width: 64rem)').matches) {
			await tick();
			if (pending || data.contextId !== contextId || selectedId !== id) return;
			const summary = document.getElementById('selected-student-summary');
			summary?.focus({ preventScroll: true });
			summary?.scrollIntoView({
				block: 'start',
				behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
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

	function focusStudentRow(id: string | undefined) {
		const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.grade-grid button[data-student-id]')).find(
			(item) => item.dataset.studentId === id && item.getClientRects().length > 0
		);
		button?.focus({ preventScroll: true });
		return button;
	}
	async function returnToClass() {
		if (!selected) return;
		const id = selected.student.id;
		const contextId = data.contextId;
		overviewSelectionId = id;
		const query = new SvelteURLSearchParams(selectionUrl.search);
		query.delete('etudiant');
		await goto((resolve('/enseignant/notation') + '?' + query) as ResolvedPathname, {
			shallow: true,
			replace: true,
			state: page.state
		});
		await tick();
		if (pending || data.contextId !== contextId || selectedId) return;
		const button = focusStudentRow(id);
		if (rosterPosition?.contextId === contextId && rosterPosition.studentId === id) {
			window.scrollTo({ left: rosterPosition.x, top: rosterPosition.y, behavior: 'instant' });
		} else {
			button?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
		}
	}
	async function toggleContext() {
		const controls = document.getElementById('grading-context-controls');
		const focusedControl = controls?.contains(document.activeElement);
		contextExpanded = !contextExpanded;
		await tick();
		if (!contextExpanded && focusedControl) {
			document.getElementById('grading-context-toggle')?.focus({ preventScroll: true });
		}
	}
	function resetFilters() {
		search = '';
		filter = 'all';
	}
	function closeFiltersFocus(event: Event) {
		if (window.matchMedia('(min-width: 64rem)').matches) {
			event.preventDefault();
			document.getElementById('grading-search')?.focus({ preventScroll: true });
		}
	}
	function trackResponsiveLayout(node: HTMLDivElement) {
		const desktop = window.matchMedia('(min-width: 64rem)');
		const table = window.matchMedia('(min-width: 80rem)');
		async function recoverFocus() {
			const active = document.activeElement;
			if (desktop.matches) filtersOpen = false;
			await tick();
			if (!(active instanceof HTMLElement) || !node.contains(active) || active.getClientRects().length) return;
			if (active.id === 'grading-context-toggle') {
				document.getElementById('grading-context')?.focus({ preventScroll: true });
			} else if (active.closest('#grading-context-controls')) {
				document.getElementById('grading-context-toggle')?.focus({ preventScroll: true });
			} else if (!desktop.matches && mobileDetailOpen) {
				document.getElementById('selected-student-summary')?.focus({ preventScroll: true });
			} else if (active.matches('[data-student-id]')) {
				focusStudentRow(active.dataset.studentId);
			} else if (!desktop.matches) {
				document.getElementById('grading-filter-trigger')?.focus({ preventScroll: true });
			} else {
				document.getElementById('grading-search')?.focus({ preventScroll: true });
			}
		}
		desktop.addEventListener('change', recoverFocus);
		table.addEventListener('change', recoverFocus);
		return () => {
			desktop.removeEventListener('change', recoverFocus);
			table.removeEventListener('change', recoverFocus);
		};
	}

	function correctionLink(studentId: string) {
		return resolve('/enseignant/notation/[contextId]/[studentId]', {
			contextId: data.contextId!,
			studentId
		});
	}
</script>

{#snippet filterControls(surface: 'desktop' | 'mobile')}
	<Field.FieldGroup class="search-filters control-toolbar min-w-0 gap-4">
		<Field.Field>
			<Field.FieldLabel for={surface === 'desktop' ? 'grading-search' : 'grading-search-mobile'}>
				Rechercher un étudiant
			</Field.FieldLabel>
			<Input
				id={surface === 'desktop' ? 'grading-search' : 'grading-search-mobile'}
				type="search"
				bind:value={search}
				class="min-h-11"
				placeholder="Nom de l’étudiant"
			/>
		</Field.Field>
		<Field.Field>
			<Field.FieldLabel for={surface === 'desktop' ? 'grading-filter' : 'grading-filter-mobile'}>
				Afficher
			</Field.FieldLabel>
			<NativeSelect.Root
				id={surface === 'desktop' ? 'grading-filter' : 'grading-filter-mobile'}
				bind:value={filter}
				class="w-full"
			>
				{#each Object.entries(filterLabels) as [value, label] (value)}
					<NativeSelect.Option {value}>{label}</NativeSelect.Option>
				{/each}
			</NativeSelect.Root>
		</Field.Field>
	</Field.FieldGroup>
{/snippet}

<div class="grade-grid page-sections" data-detail-open={mobileDetailOpen} {@attach trackResponsiveLayout}>
	{#snippet gridHeading()}
		<header class="grading-heading flex flex-wrap items-start justify-between gap-4">
			<div class="flex min-w-0 flex-col gap-2">
				<h1 class="page-title">Notation</h1>
				<p class="text-sm text-muted-foreground">Consultez les notes et ouvrez une correction.</p>
			</div>
			<Button
				variant="outline"
				href={(resolve('/enseignant/propositions') +
					(rubric && data.contextId ? `?contexte=${data.contextId}` : '')) as ResolvedPathname}
				>{rubric && data.contextId ? 'Propositions de ce module' : 'Propositions de correction'}</Button
			>
		</header>
	{/snippet}
	{#if rubric}
		<ModulePageNavigation
			moduleId={rubric.module.id}
			moduleTitle={rubric.module.title}
			currentPage="grading"
			classId={context?.classId}
			contextId={context?.id}
			academicYear={context?.academicYear}
			studentId={selected?.student.id}
			{returnSection}
			rubricReturn="notation"
		>
			{@render gridHeading()}
		</ModulePageNavigation>
	{:else}
		{@render gridHeading()}
	{/if}
	{#if completeContext}
		<div class="grading-identity flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
			<div class="min-w-0 flex-1">
				<p class="font-semibold wrap-anywhere">{data.rubric?.module.title}</p>
				<p class="text-sm wrap-anywhere text-muted-foreground">
					{context?.className}
				</p>
			</div>
			<Button
				id="grading-context-toggle"
				type="button"
				variant="ghost"
				class="mobile-control min-h-11 whitespace-normal"
				aria-label="Changer le contexte"
				aria-expanded={contextExpanded}
				aria-controls="grading-context-controls"
				onclick={toggleContext}
			>
				Changer<ChevronDownIcon data-icon="inline-end" />
			</Button>
		</div>
	{/if}
	{#if errorMessage}<Alert.Root variant="destructive"
			><CircleAlertIcon aria-hidden="true" /><Alert.Title>Grille indisponible</Alert.Title><Alert.Description
				>{errorMessage}</Alert.Description
			></Alert.Root
		>{/if}
	{#if data.selectionNotice}<p role="status" class="text-sm text-muted-foreground">
			{data.selectionNotice}
		</p>{/if}
	<div class="grading-workbench">
		{#if data.academicYear}
			<aside class="grading-scope" aria-label="Classe de travail et export">
				<section
					id="grading-context-controls"
					class="context-controls"
					aria-label="Contexte de notation"
					data-expanded={contextExpanded || !completeContext}
				>
					<Field.FieldGroup class="grid-filters control-toolbar min-w-0 gap-4">
						<Field.Field
							><Field.FieldLabel for="grading-context">Classe</Field.FieldLabel><NativeSelect.Root
								id="grading-context"
								value={chosen.classId}
								disabled={!chosen.academicYear || classOptions.length === 0}
								class="w-full"
								onchange={(event) =>
									selectContext(
										{
											...chosen,
											classId: event.currentTarget.value,
											moduleId: '',
											contextId: ''
										},
										event.currentTarget.value ? undefined : 'class'
									)}
								><NativeSelect.Option value="">Choisir une classe</NativeSelect.Option
								>{#each classOptions as item (item.id)}<NativeSelect.Option value={item.id}
										>{item.name}</NativeSelect.Option
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
									selectContext(
										{
											...chosen,
											moduleId: event.currentTarget.value,
											contextId: data.contexts.find((item) => item.moduleId === event.currentTarget.value)?.id ?? ''
										},
										event.currentTarget.value ? undefined : 'module'
									)}
								><NativeSelect.Option value="">Choisir un module</NativeSelect.Option
								>{#each moduleOptions as item (item.id)}<NativeSelect.Option value={item.id}
										>{item.title}</NativeSelect.Option
									>{/each}</NativeSelect.Root
							></Field.Field
						>
					</Field.FieldGroup>
				</section>
				{#if rubric && data.contextId}{#key data.contextId}<GradeExport {data} compact />{/key}{/if}
			</aside>
		{/if}
		<div class="grading-register">
			{#if pending && chosen.academicYear && chosen.classId && chosen.moduleId && chosen.contextId}
				<p role="status" class="py-6 text-sm text-muted-foreground">Chargement de la grille…</p>
			{:else if pending}
				<p role="status" class="py-6 text-sm text-muted-foreground">
					{!chosen.classId ? 'Choisissez une classe.' : 'Choisissez un module.'}
				</p>
			{:else if !data.academicYear}
				<Empty.Root variant="surface"
					><Empty.Header>
						<Empty.Media variant="icon"><UsersIcon aria-hidden="true" /></Empty.Media>
						<Empty.Title>Aucune classe disponible</Empty.Title>
						<Empty.Description>Créez une classe pour commencer la notation.</Empty.Description>
					</Empty.Header><Empty.Content
						><Button href={resolve('/enseignant/classes')} variant="outline">Voir les classes</Button></Empty.Content
					></Empty.Root
				>
			{:else if !data.classId}
				<Empty.Root variant="surface"
					><Empty.Header>
						<Empty.Media variant="icon"><UsersIcon aria-hidden="true" /></Empty.Media>
						<Empty.Title>Aucune classe sélectionnée</Empty.Title>
						<Empty.Description>Choisissez une classe pour retrouver ses modules et ses étudiants.</Empty.Description>
					</Empty.Header></Empty.Root
				>
			{:else if !rubric}
				<Empty.Root variant="surface"
					><Empty.Header
						><Empty.Media variant="icon"><BookIcon aria-hidden="true" /></Empty.Media><Empty.Title
							>{data.modules.length ? 'Choisissez un module' : 'Aucun module pour cette classe'}</Empty.Title
						><Empty.Description
							>{data.modules.length
								? 'Sélectionnez le module dont vous souhaitez consulter les résultats.'
								: 'Rattachez un module à cette classe pour commencer la notation.'}</Empty.Description
						></Empty.Header
					><Empty.Content
						><Button href={resolve('/enseignant/modules')} variant="outline" class="min-h-11">Voir les modules</Button
						></Empty.Content
					></Empty.Root
				>
			{:else if !data.contextId}
				<Empty.Root variant="surface"
					><Empty.Header
						><Empty.Media variant="icon"><UsersIcon aria-hidden="true" /></Empty.Media><Empty.Title
							>Aucune classe sélectionnée</Empty.Title
						><Empty.Description
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
				<Empty.Root variant="surface"
					><Empty.Header
						><Empty.Media variant="icon"><ListChecksIcon aria-hidden="true" /></Empty.Media><Empty.Title
							>Le barème est à préparer</Empty.Title
						><Empty.Description>Ajoutez les évaluations, les groupes et les critères du module.</Empty.Description
						></Empty.Header
					><Empty.Content><Button href={rubricLink} class="min-h-11">Préparer le barème</Button></Empty.Content
					></Empty.Root
				>
			{:else if data.students.length === 0}
				<Empty.Root variant="surface"
					><Empty.Header
						><Empty.Media variant="icon"><UsersIcon aria-hidden="true" /></Empty.Media><Empty.Title
							>Aucun étudiant dans cette classe</Empty.Title
						><Empty.Description>Ajoutez les étudiants à la classe pour ouvrir leurs corrections.</Empty.Description
						></Empty.Header
					><Empty.Content
						><Button href={resolve('/enseignant/classes')} variant="outline" class="min-h-11">Voir les classes</Button
						></Empty.Content
					></Empty.Root
				>
			{:else}
				<div class="class-tools flex min-w-0 flex-col gap-3">
					<div class="desktop-filters">{@render filterControls('desktop')}</div>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex min-w-0 flex-col gap-1">
							<h2 id="student-list-title" tabindex="-1" class="text-lg font-semibold tracking-tight">Étudiants</h2>
							<p class="text-sm text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
								{filtered.length} / {data.students.length} étudiant{data.students.length > 1 ? 's' : ''} ·
								{completeCount}
								résultat{completeCount > 1 ? 's complets' : ' complet'}
							</p>
						</div>
						<Sheet.Root bind:open={filtersOpen}>
							<Sheet.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										id="grading-filter-trigger"
										variant="outline"
										class="mobile-control min-h-11"
										aria-label="Filtrer les étudiants"
									>
										<SlidersHorizontalIcon data-icon="inline-start" />Filtrer{activeFilterCount
											? ` (${activeFilterCount})`
											: ''}
									</Button>
								{/snippet}
							</Sheet.Trigger>
							<Sheet.Content
								side="bottom"
								class="grade-filter-sheet max-h-dvh min-h-0 motion-reduce:animate-none motion-reduce:transition-none"
								onCloseAutoFocus={closeFiltersFocus}
							>
								<Sheet.Header class="shrink-0 pr-16">
									<Sheet.Title>Filtrer les étudiants</Sheet.Title>
									<Sheet.Description>Les résultats se mettent à jour pendant la saisie.</Sheet.Description>
								</Sheet.Header>
								<div class="min-h-0 overflow-y-auto overscroll-contain px-6 py-2">
									{@render filterControls('mobile')}
								</div>
								<Sheet.Footer class="shrink-0">
									<p class="text-sm text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">
										{filtered.length} / {data.students.length} étudiants
									</p>
									<Sheet.Close>
										{#snippet child({ props })}
											<Button {...props} class="min-h-11">Voir les résultats</Button>
										{/snippet}
									</Sheet.Close>
								</Sheet.Footer>
							</Sheet.Content>
						</Sheet.Root>
					</div>
					{#if activeFilterCount}
						<div class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
							<p class="min-w-0 text-sm wrap-anywhere text-muted-foreground">
								{search ? `Recherche : « ${search} »` : ''}{search && filter !== 'all' ? ' · ' : ''}{filter !== 'all'
									? filterLabels[filter]
									: ''}
							</p>
							{#if filtered.length > 0}
								<Button type="button" variant="ghost" class="min-h-11 whitespace-normal" onclick={resetFilters}
									>Réinitialiser les filtres</Button
								>
							{/if}
						</div>
					{/if}
				</div>
				<div class="results-layout">
					<section class="roster-pane min-w-0" aria-labelledby="student-list-title">
						{#if filtered.length === 0}<Empty.Root
								><Empty.Header
									><Empty.Title>Aucun étudiant trouvé</Empty.Title><Empty.Description
										>Modifiez la recherche ou le filtre pour retrouver un étudiant.</Empty.Description
									></Empty.Header
								><Empty.Content
									><Button type="button" variant="outline" class="min-h-11" onclick={resetFilters}
										>Réinitialiser les filtres</Button
									></Empty.Content
								></Empty.Root
							>
						{:else}
							<div class="desktop-grid overflow-hidden">
								<Table.Root
									><Table.Caption class="sr-only"
										>Résultats du module. Sélectionnez un étudiant pour afficher son bilan.</Table.Caption
									><Table.Header
										><Table.Row
											><Table.Head>Étudiant</Table.Head>{#each rubric.results as result (result.id)}<Table.Head
													>{result.title}</Table.Head
												>{/each}<Table.Head>État</Table.Head></Table.Row
										></Table.Header
									><Table.Body
										>{#each filtered as item (item.student.id)}<Table.Row
												class="cursor-pointer focus-within:bg-muted"
												data-selected={selected?.student.id === item.student.id}
												onclick={(event) => selectStudentFromRow(event, item.student.id)}
												><Table.Cell
													><Button
														type="button"
														variant="ghost"
														class="min-h-11 max-w-full justify-start text-left whitespace-normal"
														aria-pressed={selected?.student.id === item.student.id}
														aria-controls="selected-student-summary"
														data-student-id={item.student.id}
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
							<div class="mobile-grid flex flex-col">
								{#each filtered as item (item.student.id)}
									<!-- The named button remains the keyboard control; the row adds a larger pointer target. -->
									<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
									<div
										class="student-row flex min-w-0 cursor-pointer flex-col gap-1 border-b py-2 focus-within:bg-muted hover:bg-muted"
										data-selected={selected?.student.id === item.student.id}
										onclick={(event) => selectStudentFromRow(event, item.student.id)}
									>
										<div class="flex min-w-0 items-center gap-1 pr-2">
											<Button
												type="button"
												variant="ghost"
												class="h-auto min-h-11 min-w-0 flex-1 justify-start text-left whitespace-normal"
												aria-pressed={selected?.student.id === item.student.id}
												aria-controls="selected-student-summary"
												data-student-id={item.student.id}
												onclick={() => selectStudent(item.student.id)}
												><span class="min-w-0 wrap-anywhere">{item.student.name}</span><ChevronRightIcon
													data-icon="inline-end"
												/></Button
											>
											<Badge variant={item.calculation.complete ? 'outline' : 'secondary'}>
												{item.calculation.complete ? 'Complet' : 'En attente'}
											</Badge>
										</div>
										<dl class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 px-3 pb-1">
											{#each rubric.results as result (result.id)}<div
													class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1"
												>
													<dt class="min-w-0 text-sm wrap-anywhere text-muted-foreground">
														{result.title}
													</dt>
													<dd class="text-sm tabular-nums">
														{resultLabel(item.calculation.results[result.id])}
													</dd>
												</div>{/each}
										</dl>
									</div>{/each}
							</div>
						{/if}
						{#if rubric.results.length === 0}<p class="mt-3 text-sm text-muted-foreground">
								Aucun résultat de module défini. Consultez les évaluations dans le bilan de chaque étudiant.
							</p>{/if}
					</section>
					{#if selected}<aside
							id="selected-student-summary"
							tabindex="-1"
							class="student-summary flex min-w-0 flex-col gap-5"
							aria-label={`Bilan de ${selected.student.name}`}
						>
							<Button type="button" variant="ghost" class="mobile-control min-h-11 self-start" onclick={returnToClass}>
								<ArrowLeftIcon data-icon="inline-start" />Retour à la classe
							</Button>

							<StudentGradeSummary
								{rubric}
								student={selected.student}
								calculation={selected.calculation}
								contextId={data.contextId}
								correctionHref={correctionLink(selected.student.id)}
								{resultLabel}
							/>
						</aside>{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.grading-workbench {
		display: grid;
		min-width: 0;
		gap: 1.5rem;
	}
	.grading-scope {
		min-width: 0;
		background: var(--muted);
		border-radius: var(--radius);
	}
	.grading-register {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}
	.grading-scope :global(.grade-export) {
		padding: 0.75rem 1.25rem;
	}

	.grading-identity {
		padding: 1rem 1.25rem;
		border-radius: var(--radius);
		background: var(--card);
	}
	.context-controls {
		padding: 1.25rem;
	}
	.class-tools {
		padding-top: 0.75rem;
	}
	.roster-pane {
		border-radius: var(--radius);
		background: var(--card);
		overflow: hidden;
	}
	.student-summary {
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--card);
	}

	.student-row {
		padding-inline: 0.25rem;
	}
	@media (max-width: 39.99rem) {
		.grading-scope :global(.grade-export) {
			padding-inline: 1rem;
		}
		.context-controls,
		.grading-identity,
		.student-summary {
			padding: 1rem;
		}
	}

	.grade-grid :global([data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.grade-grid :global(.grid-filters),
	.grade-grid :global(.search-filters),
	:global(.grade-filter-sheet .search-filters) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 64rem) {
		.grade-grid :global(.grid-filters) {
			grid-template-columns: minmax(15rem, 1fr) minmax(0, 1.4fr);
		}
	}
	.results-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
	}
	.desktop-grid {
		display: none;
	}
	.mobile-grid {
		display: flex;
	}
	.student-summary {
		scroll-margin-top: 4rem;
	}
	.student-summary :global([data-slot='button']) {
		min-height: 2.75rem;
	}
	.desktop-filters {
		display: none;
	}
	.grade-grid :global([data-slot='button']),
	.student-row,
	:global(.grade-filter-sheet [data-slot='button']) {
		touch-action: manipulation;
	}
	:global(.grade-filter-sheet) {
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-inline: env(safe-area-inset-left, 0px) env(safe-area-inset-right, 0px);
	}
	:global(.grade-filter-sheet [data-slot='sheet-header']) {
		padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
	}
	:global(.grade-filter-sheet [data-slot='sheet-footer']) {
		padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
	}
	:global(.grade-filter-sheet [data-slot='input']),
	:global(.grade-filter-sheet [data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	@media (max-width: 63.99rem) {
		.grade-grid[data-detail-open='true'] .grading-heading p,
		.context-controls[data-expanded='false'],
		.grade-grid[data-detail-open='true'] .class-tools,
		.grade-grid[data-detail-open='true'] .roster-pane,
		.grade-grid[data-detail-open='false'] .student-summary {
			display: none;
		}
		.grade-grid :global([data-slot='input']) {
			font-size: 1rem;
		}
	}
	.student-row[data-selected='true'] {
		background: var(--accent);
	}
	.student-row[data-selected='true'] dt,
	.student-row[data-selected='true'] :global([data-slot='button'][aria-pressed='true']) {
		color: var(--accent-foreground);
	}
	@media (min-width: 64rem) {
		.grading-identity,
		.grade-grid :global(.mobile-control) {
			display: none;
		}
		.desktop-filters {
			display: block;
		}

		.grade-grid :global(.search-filters) {
			grid-template-columns: minmax(0, 1fr) minmax(13rem, 0.5fr);
		}
		.results-layout {
			grid-template-columns: minmax(0, 1fr) minmax(16rem, 0.75fr);
			gap: 1.5rem;
			align-items: start;
		}
		.student-summary {
			padding: 1.25rem;
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
			background: var(--accent);
		}
		.desktop-grid :global([data-slot='table-row'][data-selected='true'] [data-slot='button'][aria-pressed='true']) {
			color: var(--accent-foreground);
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
