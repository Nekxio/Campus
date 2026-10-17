<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		defaults,
		setError,
		superForm,
		type FormPathLeavesWithErrors
	} from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { beforeNavigate, goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import {
		rubricUpdateSchema,
		type RubricAssessment,
		type RubricData
	} from '#lib/domain/grading.js';
	import { TeachingRequestError, saveTeaching } from '#lib/teaching/api.js';
	import {
		rubricEditorSchema,
		rubricInputPath,
		rubricToDomain,
		rubricToInput,
		savedDeadlineDates,
		syncRubricSections,
		type RubricEditorInput
	} from '#lib/grading/rubric-form.js';
	import { cn } from '#lib/utils.js';
	import RubricField from './RubricField.svelte';
	import RubricResults from './RubricResults.svelte';
	import RubricSummary from './RubricSummary.svelte';

	let { data }: { data: RubricData } = $props();
	// Route refreshes cannot replace the editable store. Only an explicit reload does so.
	const initial = untrack(() => data);
	let saved = $state.raw(initial);
	let dates = savedDeadlineDates(initial);
	const schema = rubricEditorSchema(() => dates);
	const form = superForm<RubricEditorInput, string>(
		defaults<RubricEditorInput, string>(rubricToInput(initial), zod4(schema)),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4Client(schema),
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false,
			validationMethod: 'submit-only',
			scrollToError: 'off',
			autoFocusOnError: false
		}
	);
	const { form: formData, errors, allErrors } = form;
	let assessmentId = $state(initial.assessments[0]?.id ?? '');
	let expandedDescriptions = $state<string[]>([]);
	let pending = $state(false);
	let errorMessage = $state('');
	let conflict = $state(false);
	let status = $state('');
	let summary = $state<HTMLDivElement | null>(null);
	let confirmOpen = $state(false);
	let confirmKind = $state<'leave' | 'reload'>('leave');
	let removalOpen = $state(false);
	let removalId = $state('');
	let destination = $state<ResolvedPathname>(resolve('/'));
	let allowNavigation = false;
	let baseline = $state(untrack(() => JSON.stringify($formData)));
	const dirty = $derived(JSON.stringify($formData) !== baseline);
	const assessments = $derived(
		$formData.assessments.map((assessment) => ({
			...assessment,
			groups: assessment.groups.map((group) => ({ ...group })),
			lines: assessment.lines.map((line) => ({ ...line }))
		}))
	);
	const removalAssessment = $derived(assessments.find((assessment) => assessment.id === removalId));
	const removalResults = $derived(
		$formData.results.filter(
			(result) =>
				result.assessmentIds.includes(removalId) ||
				result.components.some((component) => component.assessmentIds.includes(removalId))
		)
	);
	const errorEntries = $derived(
		$allErrors.map(({ path, messages }) => [path, messages[0]] as const)
	);
	const kindOptions = [
		{ value: 'quiz', label: 'Quiz' },
		{ value: 'project', label: 'Projet' },
		{ value: 'oral', label: 'Soutenance' },
		{ value: 'other', label: 'Autre évaluation' }
	];
	const purposeOptions = [
		{ value: 'graded', label: 'Notée · dans les résultats' },
		{ value: 'formative', label: 'Formative · hors résultats' }
	];
	function maximum(assessment: RubricAssessment, groupId?: string) {
		return assessment.lines.reduce(
			(sum, line) =>
				sum +
				((!groupId || line.groupId === groupId) && Number.isFinite(line.maxPoints)
					? line.maxPoints
					: 0),
			0
		);
	}
	async function revalidate() {
		formData.update(syncRubricSections);
		const checkedDraft = JSON.stringify($formData);
		const validated = await form.validateForm({ update: false, focusOnError: false });
		if (JSON.stringify($formData) === checkedDraft) form.errors.set(validated.errors);
	}
	function move<T>(items: T[], index: number, direction: number) {
		const next = [...items];
		const target = index + direction;
		if (target < 0 || target >= next.length) return next;
		[next[index], next[target]] = [next[target], next[index]];
		return next;
	}
	function updateAssessment(
		id: string,
		update: (assessment: RubricAssessment) => RubricAssessment
	) {
		formData.update((input) =>
			syncRubricSections({
				...input,
				assessments: input.assessments.map((assessment) =>
					assessment.id === id ? update(assessment) : assessment
				)
			})
		);
	}
	async function addAssessment() {
		const id = crypto.randomUUID();
		const groupId = crypto.randomUUID();
		formData.update((input) =>
			syncRubricSections({
				...input,
				assessments: [
					...input.assessments,
					{
						id,
						title: '',
						kind: 'other',
						purpose: 'graded',
						groups: [{ id: groupId, title: 'Critères' }],
						lines: [{ id: crypto.randomUUID(), groupId, label: '', description: '', maxPoints: 1 }]
					}
				]
			})
		);
		assessmentId = id;
		await tick();
		document.getElementById(`assessment-${id}-title`)?.focus();
	}
	function requestRemoveAssessment(id: string) {
		if (!saved.assessments.some((assessment) => assessment.id === id)) {
			removeAssessment(id);
			return;
		}
		removalId = id;
		removalOpen = true;
	}
	async function removeAssessment(id: string) {
		const wasSaved = saved.assessments.some((assessment) => assessment.id === id);
		const index = assessments.findIndex((assessment) => assessment.id === id);
		formData.update((input) => ({
			...input,
			assessments: input.assessments.filter((assessment) => assessment.id !== id),
			results: input.results.map((result) => ({
				...result,
				assessmentIds: result.assessmentIds.filter((value) => value !== id),
				components: result.components.map((component) => ({
					...component,
					assessmentIds: component.assessmentIds.filter((value) => value !== id)
				}))
			})),
			contexts: input.contexts.map((context) => ({
				...context,
				deadlines: context.deadlines.filter((deadline) => deadline.assessmentId !== id)
			}))
		}));
		assessmentId =
			$formData.assessments[Math.min(index, $formData.assessments.length - 1)]?.id ?? '';
		status = wasSaved
			? 'Évaluation retirée du brouillon. Vérifiez les résultats concernés, puis enregistrez le barème.'
			: 'Brouillon d’évaluation annulé.';
		void revalidate();
		await tick();
		document.getElementById(`assessment-${assessmentId}-title`)?.focus();
	}
	function reorderAssessment(index: number, direction: number) {
		formData.update((input) => ({
			...input,
			assessments: move(input.assessments, index, direction)
		}));
		revalidate();
	}
	async function addLine(id: string) {
		const lineId = crypto.randomUUID();
		updateAssessment(id, (assessment) => ({
			...assessment,
			lines: [
				...assessment.lines,
				{ id: lineId, groupId: assessment.groups[0].id, label: '', description: '', maxPoints: 1 }
			]
		}));
		await tick();
		document.getElementById(`line-${lineId}-label`)?.focus();
	}
	function removeLine(id: string, lineId: string) {
		updateAssessment(id, (assessment) => ({
			...assessment,
			lines: assessment.lines.filter((line) => line.id !== lineId)
		}));
		revalidate();
	}
	function reorderLine(id: string, index: number, direction: number) {
		updateAssessment(id, (assessment) => ({
			...assessment,
			lines: move(assessment.lines, index, direction)
		}));
		revalidate();
	}
	async function editDescription(lineId: string) {
		if (!expandedDescriptions.includes(lineId))
			expandedDescriptions = [...expandedDescriptions, lineId];
		await tick();
		document.getElementById(`line-${lineId}-description`)?.focus();
	}
	async function addGroup(id: string) {
		const groupId = crypto.randomUUID();
		updateAssessment(id, (assessment) => ({
			...assessment,
			groups: [...assessment.groups, { id: groupId, title: '' }]
		}));
		await tick();
		document.getElementById(`group-${groupId}-title`)?.focus();
	}
	function removeGroup(id: string, groupId: string) {
		updateAssessment(id, (assessment) => {
			const groups = assessment.groups.filter((group) => group.id !== groupId);
			if (!groups.length) return assessment;
			return {
				...assessment,
				groups,
				lines: assessment.lines.map((line) =>
					line.groupId === groupId ? { ...line, groupId: groups[0].id } : line
				)
			};
		});
		status = 'Groupe retiré ; ses critères ont rejoint le premier groupe.';
		revalidate();
	}
	function reorderGroup(id: string, index: number, direction: number) {
		updateAssessment(id, (assessment) => ({
			...assessment,
			groups: move(assessment.groups, index, direction)
		}));
		revalidate();
	}
	function addDeadline(contextId: string, id: string) {
		formData.update((input) => ({
			...input,
			contexts: input.contexts.map((context) =>
				context.id === contextId
					? {
							...context,
							deadlines: [
								...context.deadlines,
								{ assessmentId: id, dueAt: '', submissionInstructions: '' }
							]
						}
					: context
			)
		}));
	}
	function removeDeadline(contextId: string, id: string) {
		formData.update((input) => ({
			...input,
			contexts: input.contexts.map((context) =>
				context.id === contextId
					? {
							...context,
							deadlines: context.deadlines.filter((deadline) => deadline.assessmentId !== id)
						}
					: context
			)
		}));
		revalidate();
	}
	function applySaved(value: RubricData) {
		saved = value;
		dates = savedDeadlineDates(value);
		const input = rubricToInput(value);
		form.reset({ data: input, newState: input });
		baseline = JSON.stringify($formData);
		conflict = false;
		errorMessage = '';
		if (!value.assessments.some((assessment) => assessment.id === assessmentId))
			assessmentId = value.assessments[0]?.id ?? '';
	}
	function fieldLabel(path: string) {
		const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
		const labels: Record<string, string> = {
			title: 'Intitulé',
			label: 'Libellé',
			groupId: 'Groupe',
			description: 'Description',
			maxPoints: 'Maximum',
			kind: 'Règle ou type',
			purpose: 'Participation aux résultats',
			weight: 'Poids',
			assessmentIds: 'Évaluations du calcul',
			dueAt: 'Date de remise',
			submissionInstructions: 'Consignes de remise',
			lines: 'Critères',
			groups: 'Groupes',
			components: 'Composantes',
			expectedRevision: 'Version'
		};
		const subject =
			parts[0] === 'quizMaxima'
				? assessments.find(
						(item) => item.id === $formData.quizMaxima[Number(parts[1])]?.assessmentId
					)?.title || 'Section Quiz'
				: parts[0] === 'assessments'
					? assessments[Number(parts[1])]?.title || 'Évaluation'
					: parts[0] === 'results'
						? $formData.results[Number(parts[1])]?.title || 'Résultat'
						: parts[0] === 'contexts'
							? saved.contexts[Number(parts[1])]?.className || 'Classe'
							: 'Barème';
		return `${subject} · ${labels[parts.at(-1) ?? ''] || 'Champs à vérifier'}`;
	}
	async function showError(path: string) {
		const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
		if (parts[0] === 'assessments') {
			const assessment = assessments[Number(parts[1])];
			if (assessment) {
				assessmentId = assessment.id;
				if (parts[2] === 'lines' && parts[4] === 'description') {
					const line = assessment.lines[Number(parts[3])];
					if (line && !expandedDescriptions.includes(line.id))
						expandedDescriptions = [...expandedDescriptions, line.id];
				}
			}
		}
		await tick();
		const name = path.replace(/\._errors$/, '');
		const element = document.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
		if (element) {
			let parent = element.parentElement;
			while (parent) {
				if (parent instanceof HTMLDetailsElement) parent.open = true;
				parent = parent.parentElement;
			}
			element.focus();
		} else summary?.focus();
	}
	async function focusErrors() {
		await tick();
		summary?.focus();
	}
	function requestErrors(fields: Record<string, string>) {
		const snapshot = form.capture();
		for (const [rawPath, message] of Object.entries(fields)) {
			let path = rubricInputPath(rawPath).replace(/\.(\d+)(?=\.|$)/g, '[$1]');
			if (!/^(assessments|results|contexts|quizMaxima)(\.|\[|$)/.test(path)) path = '';
			else if (
				/^(assessments|results|contexts)$/.test(path) ||
				/\.(groups|lines|components|assessmentIds|deadlines)$/.test(path)
			)
				path += '._errors';
			setError(snapshot, path as FormPathLeavesWithErrors<RubricEditorInput> | '', message, {
				overwrite: true
			});
		}
		errors.set(snapshot.errors);
	}
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		pending = true;
		errorMessage = '';
		status = '';
		try {
			const validated = await form.validateForm({ update: true, focusOnError: false });
			if (!validated.valid) {
				errorMessage = 'Vérifiez les champs indiqués. Vos saisies sont conservées.';
				await focusErrors();
				return;
			}
			const payload = rubricUpdateSchema.parse({
				...rubricToDomain(validated.data, dates),
				expectedRevision: saved.module.revision
			});
			const value = await saveTeaching<RubricData>(
				`/api/teaching/modules/${saved.module.id}/rubric`,
				payload,
				'PATCH'
			);
			applySaved(value);
			status =
				'Barème enregistré. Les points sont conservés ; les évaluations touchées par une modification numérique sont à revoir.';
		} catch (error) {
			if (error instanceof TeachingRequestError) {
				conflict = error.status === 409;
				requestErrors(error.fields);
				errorMessage = conflict
					? 'Le barème ou le calendrier a changé depuis son ouverture. Votre brouillon est conservé. Comparez-le à la version actuelle avant de recharger.'
					: error.message;
			} else errorMessage = 'Enregistrement impossible. Vos saisies sont conservées ; réessayez.';
			await focusErrors();
		} finally {
			pending = false;
		}
	}
	beforeNavigate((navigation) => {
		if (allowNavigation || (!dirty && !pending)) return;
		navigation.cancel();
		if (navigation.willUnload) return;
		if (navigation.to) {
			destination = (navigation.to.url.pathname +
				navigation.to.url.search +
				navigation.to.url.hash) as ResolvedPathname;
			confirmKind = 'leave';
			confirmOpen = true;
		}
	});
	const returnToModule = $derived(page.url.searchParams.get('retour') === 'module');
	const returnContext = $derived(
		saved.contexts.find((context) => context.id === page.url.searchParams.get('contexte'))
	);
	const returnSection = $derived(
		['information', 'preparation', 'resources', 'planning'].includes(
			page.url.searchParams.get('section') ?? ''
		)
			? page.url.searchParams.get('section')
			: null
	);
	const returnPath = $derived(
		returnToModule
			? `${resolve('/enseignant/modules/[moduleId]', { moduleId: saved.module.id })}${returnContext || returnSection ? '?' + new URLSearchParams({ ...(returnContext ? { contexte: returnContext.id, ...(returnContext.classId ? { classe: returnContext.classId } : {}) } : {}), ...(returnSection ? { section: returnSection } : {}) }) : ''}`
			: `${resolve('/enseignant/notation')}?${new URLSearchParams({ module: saved.module.id, ...(returnContext ? { contexte: returnContext.id } : {}) })}`
	);
	async function returnToGrid() {
		try {
			const gridPath = returnPath as ResolvedPathname;
			await goto(gridPath);
		} catch {
			if (!confirmOpen) {
				errorMessage = 'Impossible d’ouvrir la page de retour. Vos saisies sont conservées.';
				await focusErrors();
			}
		}
	}
	async function confirmDiscard() {
		if (pending) return;
		confirmOpen = false;
		if (confirmKind === 'reload') {
			pending = true;
			try {
				await refreshAll();
				applySaved(data);
				status = 'Version actuelle rechargée.';
			} catch {
				errorMessage = 'Actualisation impossible. Vos saisies sont conservées ; réessayez.';
				await focusErrors();
			} finally {
				pending = false;
			}
		} else {
			allowNavigation = true;
			try {
				await goto(destination);
			} catch {
				errorMessage = 'Impossible d’ouvrir cette page. Vos saisies sont conservées.';
				await focusErrors();
			} finally {
				allowNavigation = false;
			}
		}
	}
</script>

<div class="rubric-editor flex min-w-0 flex-col gap-6">
	<div class="flex min-w-0 flex-wrap items-start justify-between gap-4">
		<div class="flex min-w-0 flex-col gap-2">
			<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Barème et calculs</h1>
			<p class="text-sm break-words text-muted-foreground">{saved.module.title}</p>
		</div>
		<div class="flex flex-wrap gap-3">
			<Button
				type="button"
				variant="outline"
				class="min-h-11"
				disabled={pending}
				onclick={returnToGrid}
				><ArrowLeftIcon data-icon="inline-start" />{returnToModule
					? 'Retour au module'
					: 'Retour à la grille'}</Button
			>
		</div>
	</div>
	{#if errorMessage || errorEntries.length}
		<Alert.Root
			variant="destructive"
			bind:ref={summary}
			tabindex={-1}
			class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		>
			<CircleAlertIcon aria-hidden="true" /><Alert.Title
				>{conflict ? 'Version à comparer' : 'Vérifiez le barème'}</Alert.Title
			>
			<Alert.Description
				><div class="flex flex-col gap-3">
					{#if errorMessage}<p>{errorMessage}</p>{/if}
					{#if errorEntries.length}<ul>
							{#each errorEntries as [path, message] (path)}<li>
									<Button
										type="button"
										variant="link"
										class="min-h-11 max-w-full justify-start px-0 text-left whitespace-normal"
										onclick={() => showError(path)}>{fieldLabel(path)} · {message}</Button
									>
								</li>{/each}
						</ul>{/if}
					{#if conflict}<div class="flex flex-wrap gap-3">
							<Button
								href={resolve('/enseignant/modules/[moduleId]/bareme', {
									moduleId: saved.module.id
								})}
								target="_blank"
								rel="noopener"
								variant="outline"
								class="min-h-11">Comparer dans un nouvel onglet</Button
							><Button
								type="button"
								variant="outline"
								class="min-h-11"
								disabled={pending}
								onclick={() => {
									confirmKind = 'reload';
									confirmOpen = true;
								}}>Recharger la version actuelle</Button
							>
						</div>{/if}
				</div></Alert.Description
			>
		</Alert.Root>
	{/if}
	<form id="rubric-form" novalidate onsubmit={save} aria-busy={pending}>
		<fieldset disabled={pending} class="min-w-0">
			<RubricSummary {form} />
			<Tabs.Root bind:value={assessmentId} class="flex min-w-0 flex-col gap-4">
				<div class="flex min-w-0 flex-wrap items-start gap-2 border-b pb-3">
					<Tabs.List
						aria-label="Sections du module"
						class="rubric-tabs h-auto max-w-full min-w-0 flex-wrap justify-start gap-1"
					>
						{#each assessments as assessment (assessment.id)}<Tabs.Trigger
								value={assessment.id}
								class="min-h-11 max-w-full min-w-0 whitespace-normal"
								><span class="min-w-0 break-words">{assessment.title || 'Nouvelle section'}</span
								>{#if assessment.kind !== 'quiz'}<span
										class="shrink-0 text-muted-foreground tabular-nums"
										>{maximum(assessment)} pts</span
									>{/if}</Tabs.Trigger
							>{/each}
					</Tabs.List>
					<Button
						type="button"
						variant="ghost"
						class="min-h-11"
						disabled={assessments.length >= 100}
						onclick={addAssessment}><PlusIcon data-icon="inline-start" />Ajouter une section</Button
					>
					<p class="basis-full text-sm text-muted-foreground">
						Brouillon conservé entre les sections.
					</p>
				</div>
				<div class="grid min-w-0 gap-8">
					<div class="min-w-0">
						{#each assessments as assessment, assessmentIndex (assessment.id)}
							<Tabs.Content value={assessment.id} class="min-w-0">
								<Form.Fieldset
									{form}
									name={`assessments[${assessmentIndex}]`}
									class="flex min-w-0 flex-col gap-5"
								>
									<Form.Legend class="sr-only"
										>{assessment.title || 'Nouvelle évaluation'}</Form.Legend
									>

									<Field.FieldGroup class="assessment-settings grid min-w-0 gap-3">
										<div class="assessment-title flex min-w-0 flex-wrap items-end gap-3">
											<div class="min-w-0 flex-1 basis-48">
												<RubricField
													{form}
													name={`assessments[${assessmentIndex}].title`}
													id={`assessment-${assessment.id}-title`}
													label="Nom de la section"
													maxlength={200}
												/>
											</div>
											<Button
												type="button"
												variant="outline"
												class="min-h-11 whitespace-normal"
												onclick={() => requestRemoveAssessment(assessment.id)}
												>{#if saved.assessments.some((item) => item.id === assessment.id)}
													<TrashIcon data-icon="inline-start" />Retirer l’évaluation
												{:else}
													<XIcon data-icon="inline-start" />Annuler le brouillon
												{/if}</Button
											>
										</div>
										<div class="assessment-purpose min-w-0">
											<RubricField
												{form}
												name={`assessments[${assessmentIndex}].purpose`}
												id={`assessment-${assessment.id}-purpose`}
												label="Participation aux résultats"
												options={purposeOptions}
												onvaluechange={revalidate}
											/>
										</div>
										<RubricField
											{form}
											name={`assessments[${assessmentIndex}].kind`}
											id={`assessment-${assessment.id}-kind`}
											label="Type de section"
											options={kindOptions}
											onvaluechange={revalidate}
										/>
										<div class="flex min-h-11 items-center gap-1 self-end">
											<output
												class="font-semibold tabular-nums"
												aria-label={`Total des maxima des lignes de ${assessment.title || 'la section'}`}
												>{maximum(assessment)}
												{assessment.kind === 'quiz' ? 'questions' : 'pts'}</output
											>{@render actionsMenu(
												'l’évaluation',
												assessmentIndex,
												assessments.length,
												() => reorderAssessment(assessmentIndex, -1),
												() => reorderAssessment(assessmentIndex, 1),
												() => requestRemoveAssessment(assessment.id)
											)}
										</div>
									</Field.FieldGroup>
									<div class="definition-wrap min-w-0">
										<Table.Root
											class="definition-table table-fixed"
											aria-label={`Critères de ${assessment.title || 'l’évaluation'}`}
										>
											<Table.Header
												><Table.Row
													><Table.Head class="w-[44%]">Libellé</Table.Head><Table.Head
														>Groupe</Table.Head
													><Table.Head class="w-24">Maximum</Table.Head><Table.Head class="w-14"
														><span class="sr-only">Actions</span></Table.Head
													></Table.Row
												></Table.Header
											>
											<Table.Body>
												{#each assessment.lines as line, lineIndex (line.id)}
													<Table.Row class="criterion-row">
														<Table.Cell class="criterion-label"
															><RubricField
																{form}
																name={`assessments[${assessmentIndex}].lines[${lineIndex}].label`}
																id={`line-${line.id}-label`}
																label={`${assessment.kind === 'quiz' ? 'Nom du quiz' : 'Libellé du critère'} ${lineIndex + 1}`}
																compact
																maxlength={200}
															/></Table.Cell
														>
														<Table.Cell
															><RubricField
																{form}
																name={`assessments[${assessmentIndex}].lines[${lineIndex}].groupId`}
																id={`line-${line.id}-group`}
																label={`Groupe du critère ${lineIndex + 1}`}
																compact
																options={assessment.groups.map((group) => ({
																	value: group.id,
																	label: group.title || 'Groupe sans nom'
																}))}
															/></Table.Cell
														>
														<Table.Cell
															><RubricField
																{form}
																name={`assessments[${assessmentIndex}].lines[${lineIndex}].maxPoints`}
																id={`line-${line.id}-max`}
																label={assessment.kind === 'quiz'
																	? `Nombre de questions du quiz ${lineIndex + 1}`
																	: `Maximum du critère ${lineIndex + 1} (pts)`}
																compact
																type="number"
																min={1}
																max={1000000}
																step={1}
																onvaluechange={revalidate}
															/></Table.Cell
														>
														<Table.Cell class="criterion-actions"
															>{@render actionsMenu(
																line.label || `le critère ${lineIndex + 1}`,
																lineIndex,
																assessment.lines.length,
																() => reorderLine(assessment.id, lineIndex, -1),
																() => reorderLine(assessment.id, lineIndex, 1),
																() => removeLine(assessment.id, line.id),
																() => editDescription(line.id),
																assessment.lines.length <= 1
															)}</Table.Cell
														>
													</Table.Row>
													{#if expandedDescriptions.includes(line.id)}<Table.Row
															class="description-row"
															><Table.Cell colspan={4}
																><RubricField
																	{form}
																	name={`assessments[${assessmentIndex}].lines[${lineIndex}].description`}
																	id={`line-${line.id}-description`}
																	label={`Description · ${line.label || `Critère ${lineIndex + 1}`}`}
																	multiline
																	maxlength={2000}
																/></Table.Cell
															></Table.Row
														>{/if}
												{/each}
											</Table.Body>
										</Table.Root>
									</div>
									<div class="flex flex-wrap items-center justify-between gap-3">
										<Button
											type="button"
											variant="ghost"
											class="min-h-11"
											disabled={assessment.lines.length >= 1000}
											onclick={() => addLine(assessment.id)}
											><PlusIcon data-icon="inline-start" />{assessment.kind === 'quiz'
												? 'Ajouter un quiz'
												: 'Ajouter une ligne'}</Button
										>
										<p class="text-sm text-muted-foreground">
											{assessment.kind === 'quiz'
												? 'Une ligne par quiz Wayground · 1 question = 1 point · chaque quiz a le même poids après conversion sur 20.'
												: 'Points entiers · maxima libres'}
										</p>
									</div>
									<Form.Fieldset
										{form}
										name={`assessments[${assessmentIndex}].groups`}
										class="flex min-w-0 flex-col gap-3"
									>
										<Form.Legend class="border-b pb-3 text-base">Groupes et maxima</Form.Legend>
										{#each assessment.groups as group, groupIndex (group.id)}<div
												class={cn('flex min-w-0 items-end gap-2', groupIndex === 0 && 'mt-4')}
											>
												<div class="min-w-0 flex-1">
													<RubricField
														{form}
														name={`assessments[${assessmentIndex}].groups[${groupIndex}].title`}
														id={`group-${group.id}-title`}
														label={`Nom du groupe ${groupIndex + 1}`}
														maxlength={200}
													/>
												</div>
												<output
													class="flex min-h-11 shrink-0 items-center text-sm font-medium tabular-nums"
													aria-label={`Maximum du groupe ${group.title || groupIndex + 1}`}
													>{maximum(assessment, group.id)} pts</output
												>{@render actionsMenu(
													group.title || `le groupe ${groupIndex + 1}`,
													groupIndex,
													assessment.groups.length,
													() => reorderGroup(assessment.id, groupIndex, -1),
													() => reorderGroup(assessment.id, groupIndex, 1),
													() => removeGroup(assessment.id, group.id),
													undefined,
													assessment.groups.length <= 1
												)}
											</div>{/each}
										<Form.Description
											>En retirant un groupe, ses critères rejoignent le premier groupe. Les totaux
											sont calculés à partir des lignes.</Form.Description
										>
										<Button
											type="button"
											variant="ghost"
											class="min-h-11 self-start"
											disabled={assessment.groups.length >= 100}
											onclick={() => addGroup(assessment.id)}
											><PlusIcon data-icon="inline-start" />Ajouter un groupe</Button
										><Form.FieldErrors />
									</Form.Fieldset>
									<Form.FieldErrors />
								</Form.Fieldset>
							</Tabs.Content>
						{:else}<Empty.Root class="border border-dashed py-12"
								><Empty.Header
									><Empty.Title>Définissez votre première section</Empty.Title><Empty.Description
										>Reprenez les critères et les points de votre grille : dossier, soutenance ou
										tout autre livrable.</Empty.Description
									></Empty.Header
								><Empty.Content
									><Button type="button" class="min-h-11" onclick={addAssessment}
										><PlusIcon data-icon="inline-start" />Ajouter une section</Button
									></Empty.Content
								></Empty.Root
							>{/each}
					</div>
				</div>
			</Tabs.Root>
			{#if $formData.calculationMode === 'custom'}
				<details class="mt-6 min-w-0 border-t pt-3">
					<summary class="min-h-11 cursor-pointer py-3 font-medium"
						>Configurer les résultats existants</summary
					><RubricResults {form} />
				</details>
			{/if}
			<Form.Fieldset
				{form}
				name="contexts"
				id="echeances"
				tabindex={-1}
				class="mt-8 flex min-w-0 flex-col gap-5 border-t pt-7"
			>
				<Form.Legend class="text-xl font-semibold tracking-tight"
					>Dates et consignes de remise</Form.Legend
				><Form.Description
					>Chaque classe garde son calendrier. Saisissez les dates à l’heure de Paris
					(Europe/Paris).</Form.Description
				>
				{#each $formData.contexts as context, contextIndex (context.id)}
					<Form.Fieldset
						{form}
						name={`contexts[${contextIndex}].deadlines`}
						id={`echeances-${context.id}`}
						tabindex={-1}
						class="flex min-w-0 flex-col gap-4"
					>
						<Form.Legend class="mb-2 text-muted-foreground">Classe associée</Form.Legend>
						<p class="text-base font-medium wrap-anywhere">
							{saved.contexts.find((value) => value.id === context.id)?.className || 'Classe'}
							· {saved.contexts.find((value) => value.id === context.id)?.academicYear}
						</p>
						{#each context.deadlines as deadline, deadlineIndex (deadline.assessmentId)}
							<div class="deadline-editor min-w-0 border-b pb-5">
								<h3 class="mb-3 font-medium break-words">
									{assessments.find((assessment) => assessment.id === deadline.assessmentId)
										?.title || 'Évaluation'}
								</h3>
								<Field.FieldGroup class="deadline-fields grid min-w-0 gap-4"
									><RubricField
										{form}
										name={`contexts[${contextIndex}].deadlines[${deadlineIndex}].dueAt`}
										id={`deadline-${context.id}-${deadline.assessmentId}-due`}
										label="Date et heure de remise"
										type="datetime-local"
									/><RubricField
										{form}
										name={`contexts[${contextIndex}].deadlines[${deadlineIndex}].submissionInstructions`}
										id={`deadline-${context.id}-${deadline.assessmentId}-instructions`}
										label="Consignes de remise"
										multiline
										maxlength={10000}
									/></Field.FieldGroup
								><Button
									type="button"
									variant="ghost"
									class="mt-2 min-h-11"
									onclick={() => removeDeadline(context.id, deadline.assessmentId)}
									><TrashIcon data-icon="inline-start" />Retirer la date de remise</Button
								>
							</div>
						{:else}<p class="text-sm text-muted-foreground">
								Aucune date de remise définie pour cette classe.
							</p>{/each}
						<div class="flex flex-wrap gap-2">
							{#each assessments.filter((assessment) => !context.deadlines.some((deadline) => deadline.assessmentId === assessment.id)) as assessment (assessment.id)}<Button
									type="button"
									variant="outline"
									class="min-h-11 max-w-full whitespace-normal"
									onclick={() => addDeadline(context.id, assessment.id)}
									><PlusIcon data-icon="inline-start" />Date · {assessment.title ||
										'Évaluation sans nom'}</Button
								>{/each}
						</div>
						<Form.FieldErrors />
					</Form.Fieldset>
				{:else}<p class="text-sm text-muted-foreground">
						Rattachez le module à une classe pour définir ses dates de remise.
					</p>{/each}<Form.FieldErrors />
			</Form.Fieldset>
		</fieldset>
	</form>
	<div class="editor-save-bar">
		<div role="status" aria-live="polite" class="min-h-5 text-sm text-muted-foreground">
			{pending
				? 'Enregistrement et recalcul en cours…'
				: dirty
					? status || 'Modifications non enregistrées.'
					: status || 'Toutes les modifications sont enregistrées.'}
		</div>
		<Button type="submit" form="rubric-form" disabled={pending}
			>{#if pending}<Spinner data-icon="inline-start" />{/if}{pending
				? 'Enregistrement…'
				: 'Enregistrer le barème'}</Button
		>
	</div>
</div>

{#snippet actionsMenu(
	label: string,
	index: number,
	count: number,
	up: () => void,
	down: () => void,
	remove: () => void,
	description?: () => void,
	preventRemove = false
)}
	<DropdownMenu.Root
		><DropdownMenu.Trigger
			class={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'min-h-11 min-w-11 shrink-0')}
			disabled={pending}
			aria-label={`Actions pour ${label}`}><EllipsisIcon aria-hidden="true" /></DropdownMenu.Trigger
		><DropdownMenu.Content align="end"
			><DropdownMenu.Group
				>{#if description}<DropdownMenu.Item
						class="min-h-11"
						disabled={pending}
						onSelect={description}
						><PencilIcon aria-hidden="true" />Modifier la description</DropdownMenu.Item
					>{/if}<DropdownMenu.Item class="min-h-11" disabled={pending || index === 0} onSelect={up}
					><ArrowUpIcon aria-hidden="true" />Monter</DropdownMenu.Item
				><DropdownMenu.Item
					class="min-h-11"
					disabled={pending || index === count - 1}
					onSelect={down}><ArrowDownIcon aria-hidden="true" />Descendre</DropdownMenu.Item
				><DropdownMenu.Item
					class="min-h-11"
					variant="destructive"
					disabled={pending || preventRemove}
					onSelect={remove}><TrashIcon aria-hidden="true" />Retirer</DropdownMenu.Item
				></DropdownMenu.Group
			></DropdownMenu.Content
		></DropdownMenu.Root
	>
{/snippet}

<AlertDialog.Root bind:open={confirmOpen}
	><AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
		><AlertDialog.Header
			><AlertDialog.Title
				>{confirmKind === 'reload'
					? 'Recharger le barème ?'
					: 'Quitter le barème ?'}</AlertDialog.Title
			><AlertDialog.Description
				>{confirmKind === 'reload'
					? 'La version actuelle remplacera votre brouillon. Les modifications non enregistrées seront perdues.'
					: 'Vos modifications ne sont pas enregistrées. En quittant cette page, vous les perdrez.'}</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel class="min-h-11">Continuer à modifier</AlertDialog.Cancel
			><AlertDialog.Action class="min-h-11" disabled={pending} onclick={confirmDiscard}
				>{confirmKind === 'reload'
					? 'Recharger et remplacer'
					: 'Quitter sans enregistrer'}</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<AlertDialog.Root bind:open={removalOpen}
	><AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
		><AlertDialog.Header
			><AlertDialog.Title
				>Retirer « {removalAssessment?.title || 'l’évaluation'} » ?</AlertDialog.Title
			><AlertDialog.Description>
				Cette évaluation sera retirée du barème actif, des calculs et des dates de remise lorsque
				vous cliquerez sur « Enregistrer le barème ». Les points déjà enregistrés seront conservés
				dans l’historique privé des corrections.
				{#if removalResults.length > 0}
					Résultats à vérifier : {removalResults
						.map((result) => result.title || 'Résultat sans nom')
						.join(', ')}.
				{/if}
			</AlertDialog.Description></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel class="min-h-11">Conserver l’évaluation</AlertDialog.Cancel
			><AlertDialog.Action
				class="min-h-11"
				disabled={pending}
				onclick={() => removeAssessment(removalId)}>Retirer du brouillon</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<style>
	.rubric-editor :global([data-slot='native-select']:not([data-size='sm'])) {
		min-height: 2.75rem;
	}
	.rubric-editor {
		container: rubric / inline-size;
	}
	.rubric-editor :global([data-slot='tabs-list'].rubric-tabs) {
		background: transparent;
		padding: 0;
		height: auto;
		min-height: 2.75rem;
		align-content: start;
	}
	.rubric-editor :global([data-slot='tabs-trigger']) {
		gap: 0.75rem;
		flex: initial;
	}
	.definition-wrap {
		container: criteria / inline-size;
	}
	.rubric-editor :global(.assessment-settings) {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.assessment-title,
	.assessment-purpose {
		grid-column: 1 / -1;
	}
	.definition-wrap :global([data-slot='table-container']) {
		min-width: 0;
	}
	.definition-wrap :global([data-slot='table-cell']) {
		padding: 0.75rem;
		vertical-align: middle;
		white-space: normal;
	}
	.definition-wrap :global([data-slot='table-head']) {
		white-space: normal;
	}
	.rubric-editor :global([data-fs-field-errors]:empty) {
		display: none;
	}
	@container rubric (min-width: 50rem) {
		.rubric-editor :global(.assessment-settings) {
			grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.7fr) auto;
		}
		.assessment-purpose {
			grid-column: auto;
		}
	}
	@container rubric (min-width: 40rem) {
		.rubric-editor :global(.deadline-fields) {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	@container criteria (max-width: 35rem) {
		.definition-wrap :global([data-slot='table-container']) {
			overflow: visible;
		}
		.definition-wrap :global(.definition-table),
		.definition-wrap :global(tbody) {
			display: block;
		}
		.definition-wrap :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}
		.definition-wrap :global(.criterion-row) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 56px;
			align-items: end;
			gap: 0.75rem;
			padding: 1.25rem 0;
		}
		.definition-wrap :global([data-slot='table-cell']) {
			padding: 0;
		}
		.definition-wrap :global(.criterion-label) {
			grid-column: 1 / -1;
		}
		.definition-wrap :global(.criterion-actions) {
			align-self: end;
		}
		.definition-wrap :global(.description-row),
		.definition-wrap :global(.description-row td) {
			display: block;
		}
		.rubric-editor :global(input),
		.rubric-editor :global(textarea),
		.rubric-editor :global(select) {
			font-size: 1rem;
		}
	}
	@media (pointer: coarse) {
		.rubric-editor :global(input),
		.rubric-editor :global(textarea),
		.rubric-editor :global(select) {
			font-size: 1rem;
		}
	}
</style>
