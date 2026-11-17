<script lang="ts">
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { currentAcademicYear } from '#lib/domain/academic-year.js';
	import ModulePageNavigation from '#lib/components/teaching/ModulePageNavigation.svelte';
	import { tick, untrack } from 'svelte';
	import { defaults, setError, superForm, type FormPathLeavesWithErrors } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { beforeNavigate, goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { rubricUpdateSchema, rubricSaveReviewSchema, type RubricData } from '#lib/domain/grading.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { rubricResponse } from '#lib/teaching/action-responses.js';
	import { completeGradingSelection, gradingSelectionQuery } from '#lib/domain/grading-selection.js';
	import {
		rubricEditorSchema,
		rubricInputPath,
		rubricToDomain,
		rubricToInput,
		savedDeadlineDates,
		moveRubricItem,
		rubricMaximumLabel as maximum,
		syncRubricSections,
		type RubricEditorInput
	} from '#lib/grading/rubric-form.js';
	import RubricField from './RubricField.svelte';
	import RubricAssessmentEditor from './RubricAssessmentEditor.svelte';
	import RubricSectionIndex from './RubricSectionIndex.svelte';
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
			id: 'module-rubric',
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
	const actionTransport = createFormActionTransport(form);
	const actionPath = resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: initial.module.id }) + '?/saveRubric';
	const { form: formData, errors, allErrors } = form;
	let assessmentId = $state(initial.assessments[0]?.id ?? '');
	let expandedDescriptions = $state<string[]>([]);
	let pending = $state(false);
	let saveUnconfirmed = $state(false);
	let errorMessage = $state('');
	let conflict = $state(false);
	let status = $state('');
	let statusKind = $state<'success' | 'info'>('info');
	let summary = $state<HTMLDivElement | null>(null);
	let confirmOpen = $state(false);
	let confirmKind = $state<'leave' | 'reload'>('leave');
	let removalOpen = $state(false);
	let removalId = $state('');
	let destination = $state<ResolvedPathname>(resolve('/'));
	let allowNavigation = false;
	let baseline = $state(untrack(() => JSON.stringify($formData)));
	const dirty = $derived(JSON.stringify($formData) !== baseline);
	const canSave = $derived(dirty || saveUnconfirmed);
	const invalid = $derived(!schema.safeParse($formData).success);
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
	const errorEntries = $derived($allErrors.map(({ path, messages }) => [path, messages[0]] as const));
	async function revalidate() {
		formData.update(syncRubricSections);
		const checkedDraft = JSON.stringify($formData);
		const validated = await form.validateForm({ update: false, focusOnError: false });
		if (JSON.stringify($formData) === checkedDraft) form.errors.set(validated.errors);
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
		removalOpen = false;
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
		assessmentId = $formData.assessments[Math.min(index, $formData.assessments.length - 1)]?.id ?? '';
		statusKind = 'info';
		status = wasSaved
			? 'Section retirée du brouillon. Vérifiez les résultats concernés, puis enregistrez le barème.'
			: 'Brouillon de section annulé.';
		void revalidate();
		await tick();
		document.getElementById(`assessment-${assessmentId}-title`)?.focus();
	}
	function reorderAssessment(index: number, direction: number) {
		formData.update((input) => ({
			...input,
			assessments: moveRubricItem(input.assessments, index, direction)
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
							deadlines: [...context.deadlines, { assessmentId: id, dueAt: '', submissionInstructions: '' }]
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
		saveUnconfirmed = false;
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
			assessmentIds: 'Sections du calcul',
			dueAt: 'Date de remise',
			submissionInstructions: 'Consignes de remise',
			lines: 'Critères',
			groups: 'Groupes',
			components: 'Composantes',
			expectedRevision: 'Version'
		};
		const subject =
			parts[0] === 'quizMaxima'
				? assessments.find((item) => item.id === $formData.quizMaxima[Number(parts[1])]?.assessmentId)?.title ||
					'Section Quiz'
				: parts[0] === 'assessments'
					? assessments[Number(parts[1])]?.title || 'Section'
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
		notify(errorMessage || 'Vérifiez les champs indiqués. Vos saisies sont conservées.', 'error');
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
		if (pending || !canSave) return;
		pending = true;
		errorMessage = '';
		status = '';
		try {
			const validated = await form.validateForm({ update: true, focusOnError: false });
			if (!validated.valid) {
				await focusErrors();
				return;
			}
			const payload = rubricUpdateSchema.parse({
				...rubricToDomain(validated.data, dates),
				expectedRevision: saved.module.revision
			});
			const value = await actionTransport.submit(actionPath, payload, (payload) => ({
				...rubricResponse(saved.module.id)(payload),
				...rubricSaveReviewSchema.parse(payload)
			}));
			applySaved(value);
			statusKind = 'success';
			status =
				value.reviewRequiredCorrections > 0
					? 'Barème enregistré. Les points sont conservés ; les sections touchées par une modification numérique sont à revoir.'
					: 'Barème enregistré.';
		} catch (error) {
			if (!(error instanceof TeachingRequestError) || !error.decodedServerError) saveUnconfirmed = true;
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
		if (allowNavigation || (!canSave && !pending)) return;
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
	const returnSection = $derived(
		['information', 'preparation', 'resources', 'planning'].includes(page.url.searchParams.get('section') ?? '')
			? page.url.searchParams.get('section')
			: null
	);
	const navigationSelection = $derived(
		completeGradingSelection(
			{
				academicYear: page.url.searchParams.get('annee'),
				classId: page.url.searchParams.get('classe'),
				moduleId: saved.module.id,
				contextId: page.url.searchParams.get('contexte'),
				section: returnSection,
				studentId: page.url.searchParams.get('etudiant')
			},
			saved.contexts
		)
	);
	const returnPath = $derived(`${resolve('/enseignant/notation')}?${gradingSelectionQuery(navigationSelection)}`);
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
				applySaved(rubricResponse(saved.module.id)(data));
				status = 'Version actuelle rechargée.';
				statusKind = 'info';
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

<ActionNotice message={status} kind={statusKind} />

{#snippet saveButton()}
	<Button type="submit" form="rubric-form" disabled={pending || !canSave}
		>{#if pending}<Spinner data-icon="inline-start" aria-hidden="true" />{/if}{pending
			? 'Enregistrement…'
			: 'Enregistrer le barème'}</Button
	>
{/snippet}

<div class="rubric-editor page-sections">
	<ModulePageNavigation
		moduleId={saved.module.id}
		moduleTitle={saved.module.title}
		currentPage="rubric"
		classId={navigationSelection.classId}
		contextId={navigationSelection.contextId}
		academicYear={navigationSelection.academicYear}
		studentId={navigationSelection.studentId}
		returnSection={navigationSelection.section}
		rubricReturn={returnToModule ? 'module' : 'notation'}
		disabled={pending}
	>
		<div class="flex min-w-0 flex-col items-start gap-4">
			{#if !returnToModule}
				<Button type="button" variant="outline" class="min-h-11" disabled={pending} onclick={returnToGrid}
					><ArrowLeftIcon data-icon="inline-start" />Retour à la grille</Button
				>
			{/if}
			<div class="section-header w-full">
				<div class="flex min-w-0 flex-col gap-2">
					<h1 class="page-title">Barème et calculs</h1>
					<p class="text-sm wrap-break-word text-muted-foreground">{saved.module.title}</p>
					<p class="max-w-prose text-sm text-muted-foreground">
						Configurez les sections, les lignes du barème et les résultats calculés. Les points des étudiants se
						saisissent dans la correction.
					</p>
				</div>
				{@render saveButton()}
			</div>
		</div>
	</ModulePageNavigation>
	{#if errorMessage || errorEntries.length}
		<Alert.Root
			variant="destructive"
			bind:ref={summary}
			role={errorEntries.length ? 'group' : 'alert'}
			aria-labelledby="rubric-feedback-title"
			tabindex={-1}
			class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		>
			<CircleAlertIcon aria-hidden="true" /><Alert.Title id="rubric-feedback-title"
				>{conflict ? 'Version à comparer' : 'Vérifiez le barème'}</Alert.Title
			>
			<Alert.Description
				><div class="flex flex-col gap-3">
					<p>{errorMessage || 'Vérifiez les champs indiqués. Vos saisies sont conservées.'}</p>
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
	<form
		method="POST"
		id="rubric-form"
		action={actionPath}
		use:actionTransport.enhance
		novalidate
		onsubmit={actionTransport.handleSubmit(save)}
		aria-busy={pending}
	>
		<fieldset disabled={pending} class="min-w-0">
			<div class="rubric-definition-layout">
				<section
					id="rubric-definition"
					tabindex="-1"
					class="rubric-definition min-w-0"
					aria-label="Évaluations et critères"
				>
					<Tabs.Root bind:value={assessmentId} orientation="vertical" class="assessment-workbench">
						{#if assessments.length}
							<RubricSectionIndex
								bind:value={assessmentId}
								sections={assessments.map((assessment) => ({
									id: assessment.id,
									title: assessment.title || 'Nouvelle section',
									maximum: assessment.kind === 'quiz' ? null : maximum(assessment)
								}))}
								onAdd={addAssessment}
							/>
						{/if}

						<div class="grid min-w-0 gap-8">
							<div class="min-w-0">
								{#each assessments as assessment, assessmentIndex (assessment.id)}
									<Tabs.Content value={assessment.id} class="min-w-0">
										<RubricAssessmentEditor
											{form}
											{assessment}
											{assessmentIndex}
											assessmentCount={assessments.length}
											isSavedAssessment={saved.assessments.some((item) => item.id === assessment.id)}
											{pending}
											bind:expandedDescriptions
											onRemove={() => requestRemoveAssessment(assessment.id)}
											onReorder={(direction) => reorderAssessment(assessmentIndex, direction)}
											onRevalidate={revalidate}
											onStatus={(message) => {
												status = message;
												statusKind = 'info';
											}}
										/>
									</Tabs.Content>
								{:else}<Empty.Root
										><Empty.Header
											><Empty.Title>Définissez votre première section</Empty.Title><Empty.Description
												>Reprenez les critères et les points de votre grille&nbsp;: dossier, soutenance ou tout autre
												livrable.</Empty.Description
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
				</section>
				<aside
					id="rubric-calculation"
					tabindex="-1"
					class="rubric-calculation min-w-0"
					aria-label="Calcul des résultats"
				>
					<RubricSummary {form} />
					{#if $formData.calculationMode === 'custom'}
						<details class="mt-6 min-w-0 border-t pt-3">
							<summary class="min-h-11 cursor-pointer py-3 font-medium">Configurer les résultats existants</summary
							><RubricResults {form} />
						</details>
					{/if}
				</aside>
			</div>
			<div class="deadline-surface mt-(--space-sections)">
				<Form.Fieldset
					{form}
					name="contexts"
					id="echeances"
					tabindex={-1}
					class="deadline-section flex min-w-0 flex-col gap-5"
				>
					<Form.Legend class="text-xl font-semibold tracking-tight">Dates et consignes de remise</Form.Legend
					><Form.Description>Le calendrier appartient à la classe associée.</Form.Description>
					{#each $formData.contexts as context, contextIndex (context.id)}
						{@const savedContext = saved.contexts.find((value) => value.id === context.id)}
						<Form.Fieldset
							{form}
							name={`contexts[${contextIndex}].deadlines`}
							id={`echeances-${context.id}`}
							tabindex={-1}
							class="flex min-w-0 flex-col gap-4"
						>
							<Form.Legend class="mb-2 text-muted-foreground">Classe associée</Form.Legend>
							<p class="text-base font-medium wrap-anywhere">
								{savedContext?.className || 'Classe'}
								{#if savedContext && savedContext.academicYear !== currentAcademicYear()}
									· {savedContext.academicYear}{/if}
							</p>
							{#each context.deadlines as deadline, deadlineIndex (deadline.assessmentId)}
								<div class="deadline-editor min-w-0">
									<h3 class="mb-3 font-medium wrap-break-word">
										{assessments.find((assessment) => assessment.id === deadline.assessmentId)?.title || 'Section'}
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
											required={false}
											id={`deadline-${context.id}-${deadline.assessmentId}-instructions`}
											label="Consignes de remise"
											multiline
											maxlength={10000}
										/></Field.FieldGroup
									>
									<div class="mt-2 flex justify-end">
										<Button
											type="button"
											variant="destructive-ghost"
											class="min-h-11"
											onclick={() => removeDeadline(context.id, deadline.assessmentId)}
											><TrashIcon data-icon="inline-start" />Retirer la date de remise</Button
										>
									</div>
								</div>
							{:else}
								{#if assessments.length === 0}
									<Empty.Root>
										<Empty.Header>
											<Empty.Title>Créez d’abord une évaluation</Empty.Title>
											<Empty.Description>
												Une échéance est liée à une évaluation. Ajoutez une section au barème, puis définissez sa date
												et ses consignes de remise pour cette classe.
											</Empty.Description>
										</Empty.Header>
										<Empty.Content>
											<Button
												type="button"
												class="h-auto min-h-11 max-w-full whitespace-normal"
												onclick={addAssessment}
											>
												<PlusIcon data-icon="inline-start" />Créer une évaluation pour fixer une échéance
											</Button>
										</Empty.Content>
									</Empty.Root>
								{:else}
									<p class="text-sm text-muted-foreground">Aucune date de remise définie pour cette classe.</p>
								{/if}
							{/each}
							<div class="flex flex-wrap gap-2">
								{#each assessments.filter((assessment) => !context.deadlines.some((deadline) => deadline.assessmentId === assessment.id)) as assessment (assessment.id)}<Button
										type="button"
										variant="outline"
										class="h-auto min-h-11 max-w-full wrap-anywhere whitespace-normal"
										onclick={() => addDeadline(context.id, assessment.id)}
										><PlusIcon data-icon="inline-start" />Date · {assessment.title || 'Section sans nom'}</Button
									>{/each}
							</div>
							<Form.FieldErrors />
						</Form.Fieldset>
					{:else}<p class="text-sm text-muted-foreground">
							Rattachez le module à une classe pour définir ses dates de remise.
						</p>{/each}<Form.FieldErrors />
				</Form.Fieldset>
			</div>
		</fieldset>
	</form>
	<div class="editor-save-bar">
		<div role="status" aria-live="polite" class="min-h-5 text-sm text-muted-foreground">
			{pending
				? 'Enregistrement et recalcul en cours…'
				: invalid
					? 'Corrigez les champs signalés avant d’enregistrer. Vos saisies sont conservées.'
					: saveUnconfirmed
						? 'Enregistrement non confirmé. Réessayez.'
						: dirty
							? 'Modifications non enregistrées.'
							: 'Toutes les modifications sont enregistrées.'}
		</div>
		{@render saveButton()}
	</div>
</div>

<AlertDialog.Root bind:open={confirmOpen}
	><AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
		><AlertDialog.Header
			><AlertDialog.Title
				>{confirmKind === 'reload' ? 'Recharger le barème ?' : 'Quitter le barème ?'}</AlertDialog.Title
			><AlertDialog.Description
				>{confirmKind === 'reload'
					? 'La version actuelle remplacera votre brouillon. Les modifications non enregistrées seront perdues.'
					: 'Vos modifications ne sont pas enregistrées. En quittant cette page, vous les perdrez.'}</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel class="min-h-11">Continuer à modifier</AlertDialog.Cancel><AlertDialog.Action
				class="min-h-11"
				disabled={pending}
				onclick={confirmDiscard}
				>{confirmKind === 'reload' ? 'Recharger et remplacer' : 'Quitter sans enregistrer'}</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<AlertDialog.Root bind:open={removalOpen}
	><AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
		><AlertDialog.Header
			><AlertDialog.Title>Retirer « {removalAssessment?.title || 'la section'} » ?</AlertDialog.Title
			><AlertDialog.Description>
				Cette section sera retirée du barème actif, des calculs et des dates de remise lorsque vous cliquerez sur «
				Enregistrer le barème ». Les points déjà enregistrés seront conservés dans l’historique privé des corrections.
				{#if removalResults.length > 0}
					Résultats à vérifier : {removalResults.map((result) => result.title || 'Résultat sans nom').join(', ')}.
				{/if}
			</AlertDialog.Description></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel class="min-h-11">Conserver la section</AlertDialog.Cancel><AlertDialog.Action
				variant="destructive"
				class="min-h-11"
				disabled={pending}
				onclick={() => removeAssessment(removalId)}>Retirer du brouillon</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<style>
	.rubric-definition:focus-visible,
	.rubric-calculation:focus-visible,
	.rubric-editor :global(.deadline-section:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
	}

	.rubric-definition-layout {
		display: grid;
		min-width: 0;
		gap: 1.5rem;
	}
	.rubric-definition,
	.rubric-calculation,
	.deadline-surface {
		min-width: 0;
		border-radius: var(--radius);
		background: var(--card);
		padding: var(--surface-padding);
		scroll-margin-top: 5rem;
	}
	.rubric-calculation {
		align-self: start;
		background: var(--muted);
	}
	.rubric-calculation :global(section) {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.rubric-editor :global(.deadline-section > legend) {
		margin-bottom: 0.75rem;
		padding: 0;
	}
	.rubric-editor :global(.deadline-section) {
		scroll-margin-top: 5rem;
	}
	.deadline-editor + .deadline-editor {
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}

	.rubric-editor {
		container: rubric / inline-size;
	}
	.rubric-editor :global(.assessment-workbench) {
		display: grid;
		min-width: 0;
		gap: 1.5rem;
	}
	@container rubric (min-width: 58rem) {
		.rubric-editor :global(.assessment-workbench:has(.section-index)) {
			grid-template-columns: 13rem minmax(0, 1fr);
			align-items: start;
		}
	}

	.rubric-editor :global([data-fs-field-errors]:empty) {
		display: none;
	}
	@container rubric (min-width: 40rem) {
		.rubric-editor :global(.deadline-fields) {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	@container criteria (max-width: 35rem) {
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
