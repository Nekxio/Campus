<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		defaults,
		superForm,
		setError,
		type FormPathLeavesWithErrors
	} from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import {
		assessmentStatusLabels,
		correctionWriteSchema,
		semesterCommentWriteSchema,
		type StudentGrading,
		type RubricResult
	} from '#lib/domain/grading.js';
	import {
		calculateStudent,
		formatMark,
		type CalculatedGrade
	} from '#lib/domain/grade-calculation.js';
	import { saveTeaching, TeachingRequestError } from '#lib/teaching/api.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import {
		assessmentWeights,
		correctionInput,
		correctionPayload,
		makeCorrectionSchema,
		mergeSavedAssessment,
		previewCorrection,
		submissionMetadata,
		type CorrectionDraft
	} from '#lib/grading/correction-form.js';
	import CorrectionField from './CorrectionField.svelte';
	import CriterionScore from './CriterionScore.svelte';
	import type { DetailedCorrectionData } from './DetailedCorrection.svelte';
	let {
		data,
		student,
		onreload
	}: { data: DetailedCorrectionData; student: StudentGrading; onreload: () => Promise<void> } =
		$props();
	// This inner editor is keyed by context and student, never by refreshed route data.
	const initial = untrack(() => ({ rubric: data.rubric, student, contextId: data.contextId }));
	const rubric = initial.rubric;
	const context = rubric.contexts.find((item) => item.id === initial.contextId);
	let savedStudent = $state.raw(initial.student);
	let savedDates = submissionMetadata(initial.student);
	let selectedIndex = $state(0);
	let groupSelections = $state<Record<string, string>>({});
	const schema = makeCorrectionSchema(
		rubric,
		() => selectedIndex,
		() => savedDates,
		initial.contextId
	);
	const form = superForm<CorrectionDraft, string>(
		defaults(correctionInput(rubric, initial.student), zod4(schema)),
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
	const { form: draft, errors, allErrors } = form;
	const commentForm = superForm(
		defaults(
			{
				expectedRevision: initial.student.comment.revision,
				content: initial.student.comment.content
			},
			zod4(semesterCommentWriteSchema)
		),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4Client(semesterCommentWriteSchema),
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false,
			validationMethod: 'submit-only',
			scrollToError: 'off',
			autoFocusOnError: false
		}
	);
	const { form: commentDraft, errors: commentErrors } = commentForm;
	let baselines = $state(untrack(() => $draft.assessments.map((item) => JSON.stringify(item))));
	let commentBaseline = $state(untrack(() => $commentDraft.content));
	let pending = $state(false);
	let savingComment = $state(false);
	let commentOpen = $state(false);
	let submissionOpen = $state(false);
	let historyOpen = $state(false);
	let message = $state('');
	let errorMessage = $state('');
	let conflict = $state(false);
	let errorSummary = $state<HTMLDivElement | null>(null);
	let confirmOpen = $state(false);
	let confirmKind = $state<'leave' | 'reload'>('leave');
	let destination = $state<ResolvedPathname>(resolve('/enseignant/notation'));
	let allowNavigation = false;
	const assessment = $derived(rubric.assessments[selectedIndex]);
	// Superforms proxies may mutate nested records without replacing their identity.
	// A fresh snapshot makes status, points and their dependent UI update together.
	const current = $derived.by(() => {
		const value = $draft.assessments[selectedIndex];
		return { ...value, scores: value.scores.map((score) => ({ ...score })) };
	});
	const absent = $derived(
		current.status === 'absent_justified' || current.status === 'absent_unjustified'
	);
	const selectedDirty = $derived(JSON.stringify(current) !== baselines[selectedIndex]);
	const dirtyCount = $derived(
		$draft.assessments.filter((item, index) => JSON.stringify(item) !== baselines[index]).length
	);
	const commentDirty = $derived($commentDraft.content !== commentBaseline);
	const dirty = $derived(dirtyCount > 0 || commentDirty);
	const activeGroup = $derived(groupSelections[assessment.id] ?? assessment.groups[0].id);
	const deadline = $derived(context?.deadlines.find((item) => item.assessmentId === assessment.id));
	const position = $derived(data.students.findIndex((item) => item.id === initial.student.id));
	const gridLink =
		resolve('/enseignant/notation') + `?module=${rubric.module.id}&contexte=${initial.contextId}`;
	const preview = $derived({
		...savedStudent,
		corrections: $draft.assessments.map((item) =>
			previewCorrection(
				item,
				rubric.module.revision,
				savedStudent.corrections.find((record) => record.assessmentId === item.assessmentId),
				savedDates[item.assessmentId]
			)
		)
	});
	const calculated = $derived(
		calculateStudent(rubric.assessments, rubric.results, preview, context?.deadlines)
	);
	const diagnosticGroups = $derived.by(() => {
		const assessments = rubric.assessments.flatMap((item) => {
			const issues = calculated.assessments[item.id].issues;
			return issues.length ? [{ id: `assessment-${item.id}`, title: item.title, issues }] : [];
		});
		const results = rubric.results.flatMap((item) => {
			// Result calculations repeat an assessment's diagnostics in one joined message.
			// Keep that assessment's complete list once, and retain independent rule errors.
			const issues = calculated.results[item.id].issues.filter(
				(issue) =>
					!rubric.assessments.some(
						(assessment) =>
							calculated.assessments[assessment.id].issues.length > 0 &&
							issue.startsWith(`${assessment.title} : `)
					)
			);
			return issues.length ? [{ id: `result-${item.id}`, title: item.title, issues }] : [];
		});
		return [...assessments, ...results];
	});
	function resultIssueSummary(result: RubricResult) {
		const ids =
			result.rule.kind === 'weighted'
				? result.rule.components.flatMap((component) => component.assessmentIds)
				: result.rule.assessmentIds;
		const count =
			ids
				.filter((id, index) => ids.indexOf(id) === index)
				.reduce((total, id) => {
					const grade = calculated.assessments[id];
					return total + (grade && grade.state !== 'ready' ? grade.issues.length : 0);
				}, 0) ||
			calculated.results[result.id].issues.length ||
			1;
		return `${count} élément${count > 1 ? 's' : ''} ${calculated.results[result.id].state === 'invalid' ? 'à corriger' : 'à compléter'}.`;
	}
	const statusOptions = Object.entries(assessmentStatusLabels).map(([value, label]) => ({
		value,
		label
	}));
	const delayOptions = [
		{ value: 'automatic', label: 'Pénalité automatique' },
		{ value: 'exempt', label: 'Exception accordée' },
		{ value: 'refused', label: 'Production refusée' }
	];
	function groupTotal(groupId: string) {
		const lines = assessment.lines.filter((line) => line.groupId === groupId);
		const points = lines.reduce((sum, line) => {
			const raw = current.scores.find((score) => score.lineId === line.id)?.points ?? '';
			return sum + (/^\d+$/.test(raw.trim()) ? Number(raw) : 0);
		}, 0);
		const complete = lines.every(
			(line) =>
				(current.scores.find((score) => score.lineId === line.id)?.points ?? '').trim() !== ''
		);
		return `${points} / ${lines.reduce((sum, line) => sum + line.maxPoints, 0)} pts${complete ? '' : ' · incomplet'}`;
	}
	function resultLabel(grade: CalculatedGrade) {
		return grade.state === 'ready'
			? `${formatMark(grade.mark)} /20`
			: grade.state === 'invalid'
				? 'À corriger'
				: 'En attente';
	}
	function delayLabel(id: string) {
		const item = $draft.assessments.find((value) => value.assessmentId === id)!;
		const grade = calculated.assessments[id];
		if (item.status === 'absent_unjustified') return 'Absence injustifiée · zéro';
		if (item.status === 'absent_justified') return 'Rattrapage à traiter';
		if (rubric.assessments.find((value) => value.id === id)?.kind !== 'project')
			return 'Aucune pénalité';
		if (item.latenessDecision === 'refused') return 'Production refusée · zéro';
		if (item.latenessDecision === 'exempt') return 'Exception de retard accordée';
		return grade.latenessDays > 0
			? `${grade.latenessDays} jour${grade.latenessDays > 1 ? 's' : ''} · −${formatMark(grade.penalty)} /20`
			: 'Pénalité automatique · aucun retard établi';
	}
	function changeAssessment(index: number) {
		selectedIndex = index;
		form.errors.set({});
		if (!conflict) errorMessage = '';
		message = '';
	}
	async function focusError() {
		await tick();
		errorSummary?.focus();
	}
	function applyErrors(fields: Record<string, string>) {
		const snapshot = form.capture();
		for (const [raw, text] of Object.entries(fields)) {
			const path = raw.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
			const scoped = /^(scores|status|submissionUrl|submittedAt|latenessDecision)(\.|\[|$)/.test(
				path
			)
				? `assessments[${selectedIndex}].${path}`
				: '';
			setError(snapshot, scoped as FormPathLeavesWithErrors<CorrectionDraft> | '', text, {
				overwrite: true
			});
		}
		errors.set(snapshot.errors);
	}
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (pending || conflict) return;
		pending = true;
		savingComment = false;
		errorMessage = '';
		message = '';
		const index = selectedIndex;
		try {
			const validated = await form.validateForm({ update: true, focusOnError: false });
			if (!validated.valid) {
				errorMessage = 'Vérifiez les champs indiqués. Toutes vos saisies sont conservées.';
				await focusError();
				return;
			}
			const input = validated.data.assessments[index];
			const payload = correctionWriteSchema.parse(
				correctionPayload(
					input,
					rubric.module.revision,
					savedStudent.corrections.find((record) => record.assessmentId === input.assessmentId),
					savedDates[input.assessmentId]
				)
			);
			const saved = await saveTeaching<StudentGrading>(
				`/api/teaching/contexts/${initial.contextId}/students/${initial.student.id}/assessments/${input.assessmentId}`,
				payload,
				'PATCH'
			);
			savedStudent = mergeSavedAssessment(savedStudent, saved, input.assessmentId);
			if (!commentDirty) {
				commentForm.reset({
					data: { expectedRevision: saved.comment.revision, content: saved.comment.content }
				});
				commentBaseline = saved.comment.content;
				savedStudent = { ...savedStudent, comment: saved.comment };
			}
			savedDates = submissionMetadata(savedStudent);
			const fresh = correctionInput(rubric, savedStudent).assessments[index];
			draft.update((value) => ({
				assessments: value.assessments.map((item, itemIndex) =>
					itemIndex === index ? fresh : item
				)
			}));
			baselines[index] = JSON.stringify(fresh);
			form.errors.set({});
			message = `${rubric.assessments[index].title} enregistré.`;
		} catch (error) {
			if (error instanceof TeachingRequestError) {
				conflict = error.status === 409;
				applyErrors(error.fields);
				errorMessage = conflict
					? 'La correction ou le barème a changé depuis son ouverture. Vos saisies sont conservées. Rechargez la version actuelle avant de reprendre.'
					: error.message;
			} else errorMessage = 'Enregistrement impossible. Vos saisies sont conservées ; réessayez.';
			await focusError();
		} finally {
			pending = false;
		}
	}
	async function saveComment(event: SubmitEvent) {
		event.preventDefault();
		if (pending || conflict) return;
		pending = true;
		savingComment = true;
		errorMessage = '';
		message = '';
		try {
			const validated = await commentForm.validateForm({ update: true, focusOnError: false });
			if (!validated.valid) {
				errorMessage = 'Vérifiez le commentaire. Votre texte est conservé.';
				await focusError();
				return;
			}
			const saved = await saveTeaching<StudentGrading['comment']>(
				`/api/teaching/contexts/${initial.contextId}/students/${initial.student.id}/comment`,
				validated.data,
				'PATCH'
			);
			commentForm.reset({ data: { expectedRevision: saved.revision, content: saved.content } });
			commentBaseline = saved.content;
			savedStudent = { ...savedStudent, comment: saved };
			message = 'Commentaire privé enregistré.';
		} catch (error) {
			if (error instanceof TeachingRequestError) {
				conflict = error.status === 409;
				commentErrors.set(error.fields.content ? { content: [error.fields.content] } : {});
				errorMessage = conflict
					? 'Le commentaire a changé depuis son ouverture. Votre texte est conservé. Rechargez la version actuelle avant de reprendre.'
					: error.message;
			} else
				errorMessage =
					'Enregistrement du commentaire impossible. Votre texte est conservé ; réessayez.';
			await focusError();
		} finally {
			pending = false;
			savingComment = false;
		}
	}
	async function copyComment() {
		try {
			await navigator.clipboard.writeText($commentDraft.content);
			message = 'Commentaire copié.';
		} catch {
			message = 'Copie indisponible. Sélectionnez le commentaire pour le copier.';
		}
	}
	beforeNavigate((navigation) => {
		if (allowNavigation || (!dirty && !pending)) return;
		navigation.cancel();
		if (navigation.willUnload || !navigation.to) return;
		destination = (navigation.to.url.pathname +
			navigation.to.url.search +
			navigation.to.url.hash) as ResolvedPathname;
		confirmKind = 'leave';
		confirmOpen = true;
	});
	async function confirmDiscard() {
		if (pending) return;
		confirmOpen = false;
		if (confirmKind === 'reload') {
			pending = true;
			try {
				await onreload();
			} catch {
				errorMessage = 'Actualisation impossible. Vos saisies sont conservées ; réessayez.';
				await focusError();
			} finally {
				pending = false;
			}
			return;
		}
		allowNavigation = true;
		try {
			await goto(destination);
		} catch {
			errorMessage = 'Impossible d’ouvrir cette page. Vos saisies sont conservées.';
			await focusError();
		} finally {
			allowNavigation = false;
		}
	}
	function studentLink(index: number) {
		return resolve('/enseignant/notation/[contextId]/[studentId]', {
			contextId: initial.contextId,
			studentId: data.students[index].id
		});
	}
	async function revealPanel(id: string) {
		await tick();
		document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
	}
	function toggleSubmission() {
		submissionOpen = !submissionOpen;
		if (submissionOpen) void revealPanel('submission-fields');
	}
	function toggleComment() {
		commentOpen = !commentOpen;
		if (commentOpen) void revealPanel('semester-comment');
	}
	function toggleHistory() {
		historyOpen = !historyOpen;
		if (historyOpen) void revealPanel('retired-score-history');
	}
	function reserveDesktopViewport(node: HTMLDivElement) {
		function measure() {
			const documentTop = node.getBoundingClientRect().top + window.scrollY;
			node.style.setProperty(
				'--correction-height',
				`${Math.max(0, window.innerHeight - documentTop - 8)}px`
			);
		}
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	}
</script>

<div
	class="correction flex min-w-0 flex-col gap-4"
	data-bounded={true}
	{@attach reserveDesktopViewport}
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button href={gridLink} variant="ghost" class="min-h-11" disabled={pending}
			><ChevronLeftIcon data-icon="inline-start" />Retour à la grille</Button
		>
		<Button
			href={resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: rubric.module.id })}
			variant="ghost"
			class="min-h-11"
			disabled={pending}>Voir le barème</Button
		>
	</div>

	<section
		class="context-strip flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/30 p-4"
		aria-label="Contexte de la correction"
	>
		<div class="context-identity">
			<div class="min-w-0">
				<h1 class="text-2xl font-semibold tracking-tight wrap-anywhere">
					{initial.student.name}
				</h1>
				<p class="text-sm wrap-anywhere text-muted-foreground">
					{context?.className} · {context?.academicYear} · {rubric.module.title}
				</p>
			</div>
			<Field.Field class="gap-1"
				><Field.FieldLabel for="assessment-choice">Évaluation</Field.FieldLabel><NativeSelect.Root
					id="assessment-choice"
					disabled={pending}
					value={String(selectedIndex)}
					class="w-full"
					onchange={(event) => changeAssessment(Number(event.currentTarget.value))}
					>{#each rubric.assessments as item, index (item.id)}<NativeSelect.Option
							value={String(index)}>{item.title}</NativeSelect.Option
						>{/each}</NativeSelect.Root
				></Field.Field
			>
			<CorrectionField
				{form}
				id="assessment-status"
				formId="correction-form"
				disabled={pending}
				name={`assessments[${selectedIndex}].status`}
				label="Statut de l’évaluation"
				options={statusOptions}
			/>
			<nav class="flex items-center justify-end gap-1" aria-label="Étudiants">
				<span class="mr-1 text-sm text-muted-foreground tabular-nums"
					>{position + 1} / {data.students.length}</span
				><Button
					href={position > 0 ? studentLink(position - 1) : undefined}
					disabled={pending || position <= 0}
					variant="ghost"
					size="icon"
					class="min-h-11 min-w-11"
					aria-label="Étudiant précédent"><ChevronLeftIcon /></Button
				><Button
					href={position < data.students.length - 1 ? studentLink(position + 1) : undefined}
					disabled={pending || position >= data.students.length - 1}
					variant="ghost"
					size="icon"
					class="min-h-11 min-w-11"
					aria-label="Étudiant suivant"><ChevronRightIcon /></Button
				>
			</nav>
		</div>
		<div class="context-facts flex flex-wrap items-center gap-x-3 gap-y-2">
			{#if savedStudent.corrections.find((record) => record.assessmentId === assessment.id)?.submissionUrl}<Button
					href={savedStudent.corrections.find((record) => record.assessmentId === assessment.id)!
						.submissionUrl!}
					target="_blank"
					rel="noopener noreferrer"
					variant="outline"
					class="min-h-11">Ouvrir la remise<ExternalLinkIcon data-icon="inline-end" /></Button
				>{/if}
			<div class="text-xs">
				<p>
					{current.submittedAt
						? `Remise : ${current.submittedAt.replace('T', ' · ')} Paris`
						: 'Date de remise non renseignée'}
				</p>
				<p class="text-muted-foreground">
					{deadline
						? `Échéance : ${formatLessonDate(deadline.dueAt)} Paris`
						: 'Aucune échéance commune'}
				</p>
			</div>
			{#if assessment.kind === 'project'}<p class="text-xs text-muted-foreground">
					{delayLabel(assessment.id)}
				</p>{/if}
			<Button
				type="button"
				variant="ghost"
				class="min-h-11"
				aria-expanded={submissionOpen}
				aria-controls="submission-fields"
				disabled={pending}
				onclick={toggleSubmission}>Modifier la remise</Button
			>
			<Button
				type="button"
				variant="ghost"
				class="min-h-11"
				aria-label="Commentaire privé du semestre"
				aria-expanded={commentOpen}
				aria-controls="semester-comment"
				disabled={pending}
				onclick={toggleComment}>Commentaire privé<ChevronRightIcon data-icon="inline-end" /></Button
			>
		</div>
	</section>
	<div
		class="correction-body flex min-w-0 flex-col gap-4"
		data-auxiliary={commentOpen ||
			submissionOpen ||
			historyOpen ||
			Boolean(errorMessage) ||
			$allErrors.length > 0 ||
			diagnosticGroups.length > 0}
	>
		{#if errorMessage || $allErrors.length}
			<Alert.Root
				variant="destructive"
				bind:ref={errorSummary}
				tabindex={-1}
				class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				<CircleAlertIcon aria-hidden="true" />
				<Alert.Title>{conflict ? 'Version à actualiser' : 'Vérifiez la correction'}</Alert.Title>
				<Alert.Description
					><div class="flex flex-col gap-2">
						<p>{errorMessage}</p>
						{#if $allErrors.length}<ul class="flex flex-col gap-1">
								{#each $allErrors as error (error.path)}<li>{error.messages[0]}</li>{/each}
							</ul>{/if}
						{#if conflict}<Button
								type="button"
								variant="outline"
								class="min-h-11 self-start"
								disabled={pending}
								onclick={() => {
									confirmKind = 'reload';
									confirmOpen = true;
								}}>Recharger la version actuelle</Button
							>{/if}
					</div></Alert.Description
				>
			</Alert.Root>
		{/if}
		<form
			id="correction-form"
			novalidate
			onsubmit={save}
			aria-busy={pending && !savingComment}
			class="flex min-w-0 flex-col gap-4"
		>
			<fieldset disabled={pending} class="correction-fields min-w-0">
				{#if submissionOpen}<Field.FieldGroup
						id="submission-fields"
						class="submission-fields gap-4 border-t pt-4"
					>
						<CorrectionField
							{form}
							name={`assessments[${selectedIndex}].submissionUrl`}
							id="submission-url"
							label="Lien de la remise"
							type="url"
							description="Lien HTTPS vers GitHub, Teams ou le support reçu."
						/>
						<CorrectionField
							{form}
							name={`assessments[${selectedIndex}].submittedAt`}
							id="submission-date"
							label="Date de remise (heure de Paris)"
							type="datetime-local"
						/>
						{#if assessment.kind === 'project'}<CorrectionField
								{form}
								name={`assessments[${selectedIndex}].latenessDecision`}
								id="submission-delay"
								label="Décision de retard"
								options={delayOptions}
								description="Un point par jour de retard est retiré de la note du projet sur 20."
							/>{/if}
						{#if deadline?.submissionInstructions}<p
								class="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground"
							>
								{deadline.submissionInstructions}
							</p>{/if}
					</Field.FieldGroup>{/if}
				<div class="work-area mt-4">
					<Tabs.Root
						value={activeGroup}
						onValueChange={(value) => (groupSelections[assessment.id] = value)}
						class="min-w-0 gap-2"
					>
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex flex-wrap items-center gap-3">
								<h2 class="text-xl font-semibold tracking-tight">
									{assessment.groups.find((group) => group.id === activeGroup)?.title}
								</h2>
								<Badge variant="outline">{groupTotal(activeGroup)}</Badge>
							</div>
							<Tabs.List
								aria-label="Groupes de critères"
								class="h-auto max-w-full flex-wrap justify-start gap-1 p-0"
								>{#each assessment.groups as group (group.id)}<Tabs.Trigger
										value={group.id}
										class="min-h-11 whitespace-normal">{group.title}</Tabs.Trigger
									>{/each}</Tabs.List
							>
						</div>
						<p class="text-sm text-muted-foreground">
							Points entiers. Un champ vide reste non noté.{absent
								? ' Les points saisis sont conservés pendant l’absence et exclus du calcul.'
								: ''}
						</p>
						{#each assessment.groups as group (group.id)}<Tabs.Content
								value={group.id}
								class="min-w-0"
							>
								<div
									class="criteria-scroll"
									role="region"
									aria-label={`Critères de ${group.title}`}
									tabindex="-1"
								>
									<Form.Field
										{form}
										name={`assessments[${selectedIndex}].scores`}
										class="criterion-list flex flex-col gap-0 border-t"
									>
										{#each assessment.lines as line, lineIndex (line.id)}{#if line.groupId === group.id}<CriterionScore
													{form}
													assessmentIndex={selectedIndex}
													scoreIndex={lineIndex}
													{line}
													disabled={absent || pending}
												/>{/if}{/each}
									</Form.Field>
								</div>
							</Tabs.Content>{/each}
					</Tabs.Root>
				</div>
			</fieldset>
		</form>
		{#if diagnosticGroups.length}<section
				id="correction-diagnostics"
				class="flex flex-col gap-4 border-t pt-4"
				aria-label="Détails de la correction"
			>
				<h3 class="text-base font-semibold">Détails de la correction</h3>
				{#each diagnosticGroups as group (group.id)}<div class="flex flex-col gap-2">
						<h4 class="text-sm font-medium wrap-anywhere">{group.title}</h4>
						<ul class="flex flex-col gap-1 text-sm text-muted-foreground">
							{#each group.issues as issue, index (`${group.id}:${index}`)}<li
									class="wrap-anywhere"
								>
									{issue}
								</li>{/each}
						</ul>
					</div>{/each}
			</section>{/if}

		{#if commentOpen}<section
				id="semester-comment"
				class="flex flex-col gap-3 border-t pt-4"
				aria-label="Commentaire privé du semestre"
			>
				<form
					id="semester-comment-form"
					novalidate
					onsubmit={saveComment}
					aria-busy={savingComment}
				>
					<Field.FieldGroup>
						<CorrectionField
							form={commentForm}
							name="content"
							id="semester-comment-content"
							label="Commentaire privé du semestre"
							multiline
							maxlength={10000}
							disabled={pending}
							description="Conservé pour cet étudiant et ce module, prêt à copier dans le formulaire de l’école."
						/>
						<div class="flex flex-wrap items-center gap-3">
							<Button
								type="submit"
								variant="outline"
								class="min-h-11"
								disabled={pending || conflict || !commentDirty}
								>{#if savingComment}<Spinner data-icon="inline-start" />{/if}Enregistrer le
								commentaire</Button
							><Button
								type="button"
								variant="ghost"
								class="min-h-11"
								disabled={!$commentDraft.content}
								onclick={copyComment}><CopyIcon data-icon="inline-start" />Copier</Button
							>{#if commentDirty}<span class="text-sm text-muted-foreground"
									>Commentaire non enregistré</span
								>{/if}
						</div>
					</Field.FieldGroup>
				</form>
			</section>{/if}
		{#if historyOpen && savedStudent.retiredScores.length}<section
				id="retired-score-history"
				class="flex flex-col gap-3 border-t pt-3"
				aria-label="Points conservés de critères retirés"
			>
				<h3 class="text-sm font-medium">Points conservés de critères retirés</h3>
				<ul class="flex flex-col gap-2 text-sm text-muted-foreground">
					{#each savedStudent.retiredScores as score, index (`${score.assessmentTitle}:${score.label}:${index}`)}<li
							class="wrap-anywhere"
						>
							{score.assessmentTitle} · {score.label} : {score.points ?? '—'} / {score.maxPoints}
						</li>{/each}
				</ul>
			</section>{/if}
	</div>
	<section
		class="bottom-summary flex min-w-0 flex-col gap-2 border-t bg-background pt-3"
		aria-label="Bilan des évaluations"
	>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h2 class="text-base font-semibold">Bilan des évaluations</h2>
				<p class="text-xs text-muted-foreground">
					{assessment.groups.map((group) => `${group.title} ${groupTotal(group.id)}`).join(' + ')}
				</p>
			</div>
			<div class="summary-actions flex flex-wrap items-center gap-3">
				<p role="status" aria-live="polite" class="max-w-prose text-sm text-muted-foreground">
					{pending
						? savingComment
							? 'Enregistrement du commentaire…'
							: 'Enregistrement de l’évaluation…'
						: dirtyCount
							? `${dirtyCount} évaluation${dirtyCount > 1 ? 's' : ''} non enregistrée${dirtyCount > 1 ? 's' : ''}`
							: commentDirty
								? 'Commentaire non enregistré.'
								: message || 'Évaluations enregistrées.'}
				</p>
				{#if savedStudent.retiredScores.length}<Button
						type="button"
						variant="ghost"
						class="min-h-11"
						aria-expanded={historyOpen}
						aria-controls="retired-score-history"
						onclick={toggleHistory}>Critères retirés ({savedStudent.retiredScores.length})</Button
					>{/if}

				<Button
					type="submit"
					form="correction-form"
					class="min-h-11"
					disabled={pending || conflict || !selectedDirty}
					>{#if pending && !savingComment}<Spinner data-icon="inline-start" />{/if}Enregistrer {assessment.title}</Button
				>
			</div>
		</div>
		<div class="assessment-summary">
			<table class="w-full table-fixed text-xs tabular-nums">
				<caption class="sr-only"
					>Points, notes normalisées, coefficients et retard des évaluations</caption
				><thead
					><tr
						><th scope="col">Évaluation</th><th scope="col">Points bruts</th><th scope="col"
							>Note sur 20</th
						><th scope="col">Poids</th><th scope="col">Retard et calcul</th></tr
					></thead
				><tbody>
					{#each rubric.assessments as item (item.id)}{@const grade =
							calculated.assessments[item.id]}<tr
							><th scope="row">{item.title}</th><td>{grade.rawPoints ?? '—'} / {grade.maxPoints}</td
							><td
								>{#if grade.rawMark !== null && grade.mark !== null && grade.rawMark !== grade.mark}{formatMark(
										grade.rawMark
									)} brut →
								{/if}{resultLabel(grade)}</td
							><td>{assessmentWeights(item, rubric)}</td><td>{delayLabel(item.id)}</td></tr
						>{/each}
					{#each rubric.results as result (result.id)}{@const grade =
							calculated.results[result.id]}<tr class="result-row"
							><th scope="row">{result.title}</th><td>—</td><td>{resultLabel(grade)}</td><td
								>100 %</td
							><td
								>{grade.state === 'ready'
									? result.rule.kind === 'points_ratio'
										? 'Somme des points, puis conversion sur 20'
										: 'Notes normalisées puis pondérées'
									: resultIssueSummary(result)}</td
							></tr
						>{/each}
				</tbody>
			</table>
		</div>
		<div class="mobile-summary flex flex-col gap-3">
			{#each rubric.assessments as item (item.id)}{@const grade = calculated.assessments[item.id]}
				<div class="border-b pb-3">
					<h3 class="font-medium">{item.title} · {resultLabel(grade)}</h3>
					<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
						<dt class="text-muted-foreground">Points bruts</dt>
						<dd class="tabular-nums">{grade.rawPoints ?? '—'} / {grade.maxPoints}</dd>
						<dt class="text-muted-foreground">Poids</dt>
						<dd class="wrap-anywhere">{assessmentWeights(item, rubric)}</dd>
						<dt class="text-muted-foreground">Retard</dt>
						<dd class="wrap-anywhere">{delayLabel(item.id)}</dd>
					</dl>
				</div>{/each}{#each rubric.results as result (result.id)}<div class="flex flex-col gap-1">
					<p class="font-medium">{result.title} · {resultLabel(calculated.results[result.id])}</p>
					{#if calculated.results[result.id].state !== 'ready'}<p
							class="text-sm wrap-anywhere text-muted-foreground"
						>
							{resultIssueSummary(result)}
						</p>{/if}
				</div>{/each}
		</div>
		{#if rubric.results.length === 0}<p class="text-sm text-muted-foreground">
				Aucun résultat de module défini. Les évaluations restent indépendantes.
			</p>{/if}
	</section>
</div>

<AlertDialog.Root bind:open={confirmOpen}
	><AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
		><AlertDialog.Header
			><AlertDialog.Title
				>{confirmKind === 'reload'
					? 'Recharger la correction ?'
					: 'Quitter la correction ?'}</AlertDialog.Title
			><AlertDialog.Description
				>{pending
					? 'Un enregistrement est en cours. Attendez sa fin avant de quitter la correction.'
					: confirmKind === 'reload'
						? 'La version actuelle remplacera toutes les évaluations et le commentaire en cours. Les modifications non enregistrées seront perdues.'
						: 'Les modifications non enregistrées des évaluations et du commentaire seront perdues.'}</AlertDialog.Description
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

<style>
	.correction {
		padding-bottom: env(safe-area-inset-bottom);
	}
	.correction :global([data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.context-identity {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		align-items: end;
	}
	.criteria-scroll {
		padding-block: 0.25rem;
		max-height: 31rem;
		overflow-y: auto;
		overscroll-behavior-y: contain;
		scrollbar-color: var(--border) transparent;
		scrollbar-width: thin;
		outline-offset: 0.25rem;
	}
	.criteria-scroll:focus-visible {
		outline: 2px solid var(--ring);
	}
	.mobile-summary {
		display: flex;
	}
	.assessment-summary {
		display: none;
	}
	.bottom-summary {
		padding-bottom: env(safe-area-inset-bottom);
	}
	@media (min-width: 48rem) {
		.context-identity {
			grid-template-columns: minmax(0, 1fr) minmax(11rem, 0.6fr);
		}
		.correction :global(.submission-fields) {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.mobile-summary {
			display: none;
		}
		.assessment-summary {
			display: block;
			max-height: 15rem;
			overflow-y: auto;
			scrollbar-color: var(--border) transparent;
		}
		.assessment-summary th,
		.assessment-summary td {
			padding: 0.35rem 0.5rem;
			border-bottom: 1px solid var(--border);
			text-align: left;
			overflow-wrap: anywhere;
		}
		.assessment-summary th:first-child,
		.assessment-summary td:first-child {
			padding-left: 0;
		}
		.assessment-summary thead {
			background: var(--muted);
			color: var(--muted-foreground);
			font-size: 0.75rem;
		}
		.assessment-summary th {
			font-weight: 500;
		}
		.assessment-summary .result-row {
			background: var(--muted);
		}
		.assessment-summary th:nth-child(1) {
			width: 18%;
		}
		.assessment-summary th:nth-child(2) {
			width: 15%;
		}
		.assessment-summary th:nth-child(3) {
			width: 20%;
		}
		.assessment-summary th:nth-child(4) {
			width: 15%;
		}
		.assessment-summary th:nth-child(5) {
			width: 32%;
		}
	}
	@media (min-width: 80rem) {
		.context-identity {
			grid-template-columns: minmax(0, 1fr) 11rem 12rem auto;
			gap: 1.25rem;
		}
		.correction :global(.submission-fields) {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.correction :global([data-slot='native-select']) {
			font-size: 0.875rem;
		}
		.correction {
			margin-top: -2rem;
			gap: 0.5rem;
		}
		.context-strip {
			padding: 0.75rem;
			gap: 0.5rem;
		}
		.work-area {
			margin-top: 0.5rem;
		}
		.work-area :global([data-slot='tabs']) {
			gap: 0.25rem;
		}
		.correction :global(.criterion-list > *) {
			margin-block: 0;
		}
		.assessment-summary th,
		.assessment-summary td {
			padding-block: 0.25rem;
		}
		.bottom-summary {
			padding-top: 0.5rem;
		}
	}
	@media (min-width: 80rem) and (min-height: 36rem) {
		.correction[data-bounded='true'] {
			height: var(--correction-height, calc(100dvh - 5rem));
		}
		.correction[data-bounded='true'] > :not(.correction-body) {
			flex-shrink: 0;
		}
		.correction[data-bounded='true'] .context-strip {
			padding-block: 0.5rem;
			gap: 0.25rem;
		}
		.correction-body {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior-y: contain;
			scrollbar-color: var(--border) transparent;
			scrollbar-width: thin;
		}
		.correction-body > * {
			flex-shrink: 0;
		}
		.correction-body #correction-form {
			flex: 1;
			min-height: 12rem;
		}
		.correction-fields {
			display: flex;
			flex-direction: column;
			height: 100%;
			min-height: 0;
		}
		.work-area {
			flex: 1;
			min-height: 0;
			margin-top: 0;
		}
		.work-area :global([data-slot='tabs']) {
			display: grid;
			height: 100%;
			grid-template-rows: auto auto minmax(0, 1fr);
		}
		.work-area :global([data-slot='tabs-content']) {
			min-height: 0;
			overflow: hidden;
		}
		.criteria-scroll {
			height: 100%;
			max-height: none;
		}
		.correction-body[data-auxiliary='true'] #correction-form {
			flex: 0 0 auto;
		}
		.correction-body[data-auxiliary='true'] .correction-fields {
			height: auto;
		}
		.correction-body[data-auxiliary='true'] .work-area {
			margin-top: 0.5rem;
		}
		.correction-body[data-auxiliary='true'] .work-area :global([data-slot='tabs']) {
			height: auto;
			grid-template-rows: auto auto auto;
		}
		.correction-body[data-auxiliary='true'] .criteria-scroll {
			height: auto;
			max-height: 24rem;
		}
		.bottom-summary {
			padding-top: 0.25rem;
			max-height: 35dvh;
			overflow-y: auto;
		}
	}

	@media (pointer: coarse) {
		.correction :global([data-slot='native-select']),
		.correction :global([data-slot='input']),
		.correction :global([data-slot='textarea']) {
			font-size: 1rem;
		}
	}
</style>
