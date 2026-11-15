<script lang="ts">
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { tick, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import StudentGradeExport from './StudentGradeExport.svelte';
	import CorrectionCalculationDetails from './CorrectionCalculationDetails.svelte';
	import { gradingSelectionQuery } from '#lib/domain/grading-selection.js';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { defaults, superForm, setError, type FormPathLeavesWithErrors } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import {
		assessmentStatusLabels,
		correctionWriteSchema,
		semesterCommentWriteSchema,
		type StudentGrading
	} from '#lib/domain/grading.js';
	import { calculateStudent } from '#lib/domain/grade-calculation.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { studentGradingResponse, commentReceiptSchema } from '#lib/teaching/action-responses.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import {
		correctionInput,
		correctionPayload,
		makeCorrectionSchema,
		mergeSavedAssessment,
		previewCorrection,
		submissionMetadata,
		type CorrectionDraft
	} from '#lib/grading/correction-form.js';
	import { hasScoreInputError, scoreDraftSummary } from '#lib/grading/score-draft.js';
	import CorrectionField from './CorrectionField.svelte';
	import CorrectionCriteria from './CorrectionCriteria.svelte';
	import { summarizeCorrection } from '#lib/grading/correction-summary.js';
	import type { DetailedCorrectionData } from './DetailedCorrection.svelte';
	let {
		data,
		student,
		onreload
	}: { data: DetailedCorrectionData; student: StudentGrading; onreload: () => Promise<void> } = $props();
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
	const form = superForm<CorrectionDraft, string>(defaults(correctionInput(rubric, initial.student), zod4(schema)), {
		id: 'assessment-correction',
		dataType: 'json',
		validators: zod4Client(schema),
		applyAction: 'never',
		invalidateAll: false,
		resetForm: false,
		taintedMessage: false,
		validationMethod: 'submit-only',
		scrollToError: 'off',
		autoFocusOnError: false
	});
	const actionTransport = createFormActionTransport(form);
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
			id: 'semester-comment',
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
	const commentTransport = createFormActionTransport(commentForm);
	const correctionPath = resolve('/enseignant/notation/[contextId]/[studentId]', {
		contextId: initial.contextId,
		studentId: initial.student.id
	});
	const { form: commentDraft, errors: commentErrors } = commentForm;
	let baselines = $state(untrack(() => $draft.assessments.map((item) => JSON.stringify(item))));
	let commentBaseline = $state(untrack(() => $commentDraft.content));
	let pending = $state(false);
	let savingComment = $state(false);
	let commentOpen = $state(false);
	let submissionOpen = $state(false);
	let historyOpen = $state(false);
	let detailsOpen = $state(false);
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
	const invalidScoreIds = $derived(
		rubric.assessments
			.filter((item, index) => hasScoreInputError(item, $draft.assessments[index]))
			.map((item) => item.id)
	);
	const selectedScoreInvalid = $derived(invalidScoreIds.includes(assessment.id));
	const selectedInvalid = $derived(!schema.safeParse($draft).success);
	const selectedDirty = $derived(JSON.stringify(current) !== baselines[selectedIndex]);
	const reviewRequired = $derived(
		savedStudent.corrections.find((record) => record.assessmentId === assessment.id)?.needsReview ?? false
	);
	const dirtyCount = $derived(
		$draft.assessments.filter((item, index) => JSON.stringify(item) !== baselines[index]).length
	);
	const commentDirty = $derived($commentDraft.content !== commentBaseline);
	const dirty = $derived(dirtyCount > 0 || commentDirty);
	const activeGroup = $derived(groupSelections[assessment.id] ?? assessment.groups[0].id);
	const deadline = $derived(context?.deadlines.find((item) => item.assessmentId === assessment.id));
	const position = $derived(data.students.findIndex((item) => item.id === initial.student.id));
	const navigationQuery = gradingSelectionQuery({
		academicYear: context?.academicYear,
		classId: context?.classId,
		moduleId: rubric.module.id,
		contextId: initial.contextId,
		studentId: initial.student.id
	});
	const gridLink = resolve('/enseignant/notation') + `?${navigationQuery}`;
	const rubricQuery = `retour=notation&${navigationQuery}`;

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
	const submittedAt = $derived(preview.corrections.find((item) => item.assessmentId === assessment.id)?.submittedAt);
	const calculated = $derived(calculateStudent(rubric.assessments, rubric.results, preview, context?.deadlines));
	const summary = $derived(summarizeCorrection(rubric, $draft, calculated, invalidScoreIds));
	const statusOptions = Object.entries(assessmentStatusLabels).map(([value, label]) => ({
		value,
		label
	}));
	const delayOptions = [
		{ value: 'automatic', label: 'Pénalité automatique' },
		{ value: 'exempt', label: 'Exception accordée' },
		{ value: 'refused', label: 'Projet explicitement non remis / refusé' }
	];
	const groupTotal = (groupId: string) => scoreDraftSummary(assessment, current, groupId);

	function changeAssessment(index: number) {
		selectedIndex = index;
		form.errors.set({});
		if (!conflict) errorMessage = '';
		message = '';
	}
	async function focusError() {
		notify(errorMessage, 'error');
		await tick();
		errorSummary?.focus();
	}
	function applyErrors(fields: Record<string, string>) {
		const snapshot = form.capture();
		for (const [raw, text] of Object.entries(fields)) {
			const path = raw.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
			const scoped = /^(scores|status|submissionUrl|submittedAt|latenessDecision)(\.|\[|$)/.test(path)
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
			const saved = await actionTransport.submit(
				correctionPath + '?/saveAssessment',
				{ assessmentId: input.assessmentId, correction: payload },
				studentGradingResponse(initial.student.id, input.assessmentId)
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
				assessments: value.assessments.map((item, itemIndex) => (itemIndex === index ? fresh : item))
			}));
			baselines[index] = JSON.stringify(fresh);
			form.errors.set({});
			message = `${rubric.assessments[index].title} enregistré.`;
		} catch (error) {
			if (error instanceof TeachingRequestError) {
				conflict = error.status === 409;
				applyErrors(
					Object.fromEntries(
						Object.entries(error.fields).map(([path, text]) => [path.replace(/^correction\./, ''), text])
					)
				);
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
			const saved = await commentTransport.submit(
				correctionPath + '?/saveComment',
				validated.data,
				commentReceiptSchema.parse
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
			} else errorMessage = 'Enregistrement du commentaire impossible. Votre texte est conservé ; réessayez.';
			await focusError();
		} finally {
			pending = false;
			savingComment = false;
		}
	}
	async function copyComment() {
		message = '';
		errorMessage = '';
		try {
			await navigator.clipboard.writeText($commentDraft.content);
			message = 'Commentaire copié.';
		} catch {
			errorMessage = 'Copie indisponible. Sélectionnez le commentaire pour le copier.';
			await focusError();
		}
	}
	beforeNavigate((navigation) => {
		if (allowNavigation || (!dirty && !pending)) return;
		navigation.cancel();
		if (navigation.willUnload || !navigation.to) return;
		destination = (navigation.to.url.pathname + navigation.to.url.search + navigation.to.url.hash) as ResolvedPathname;
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
	const toggleCalculationDetails = async () => {
		detailsOpen = !detailsOpen;
		if (!detailsOpen) return;
		await tick();
		const panel = document.getElementById('calculation-details');
		panel?.focus({ preventScroll: true });
		panel?.scrollIntoView({ block: 'nearest' });
	};
	function toggleSubmission() {
		submissionOpen = !submissionOpen;
		if (submissionOpen) void revealPanel('submission-fields');
	}
	const focusSubmissionLink = async () => {
		submissionOpen = true;
		await tick();
		jumpTo('submission-url', 'center');
	};
	function toggleComment() {
		commentOpen = !commentOpen;
		if (commentOpen) void revealPanel('semester-comment');
	}
	function toggleHistory() {
		historyOpen = !historyOpen;
		if (historyOpen) void revealPanel('retired-score-history');
	}
	const jumpTo = (id: string, block: ScrollLogicalPosition = 'start') => {
		const target = document.getElementById(id);
		// Instant scrolling also avoids animated travel with the software keyboard open.
		target?.scrollIntoView({ block, behavior: 'instant' });
		target?.focus({ preventScroll: true });
	};
	function reserveDesktopViewport(node: HTMLDivElement) {
		function measure() {
			const documentTop = node.getBoundingClientRect().top + window.scrollY;
			node.style.setProperty('--correction-height', `${Math.max(0, window.innerHeight - documentTop - 8)}px`);
		}
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	}
</script>

<ActionNotice {message} />

<div class="correction flex min-w-0 flex-col gap-4" data-bounded={true} {@attach reserveDesktopViewport}>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Button href={gridLink} variant="ghost" class="min-h-11" disabled={pending}
			><ChevronLeftIcon data-icon="inline-start" />Retour à la grille</Button
		>
		<Button
			href={`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: rubric.module.id })}?${rubricQuery}`}
			variant="ghost"
			class="min-h-11"
			disabled={pending}>Voir le barème</Button
		>
	</div>

	<section class="context-strip flex min-w-0 flex-col gap-3" aria-label="Contexte de la correction">
		<div class="context-identity">
			<div class="min-w-0">
				<h1 class="correction-title">
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
					>{#each rubric.assessments as item, index (item.id)}<NativeSelect.Option value={String(index)}
							>{item.title}</NativeSelect.Option
						>{/each}</NativeSelect.Root
				>
				{#if assessment.title.length > 28}<Field.FieldDescription class="text-xs wrap-anywhere"
						>{assessment.title}</Field.FieldDescription
					>{/if}
			</Field.Field>
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
				<Button
					type="button"
					variant="outline"
					class="correction-jump mr-auto min-h-11"
					aria-controls="correction-summary"
					onclick={() => jumpTo('correction-summary')}>Bilan</Button
				>
				<span class="mr-1 text-sm text-muted-foreground tabular-nums">{position + 1} / {data.students.length}</span
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
					href={savedStudent.corrections.find((record) => record.assessmentId === assessment.id)!.submissionUrl!}
					target="_blank"
					rel="noopener noreferrer"
					variant="outline"
					class="min-h-11">Ouvrir la remise<ExternalLinkIcon data-icon="inline-end" /></Button
				>{/if}
			<div class="submission-dates text-xs">
				<p>
					{current.submittedAt
						? submittedAt
							? `Remise : ${formatLessonDate(submittedAt)}`
							: 'Date de remise à vérifier'
						: 'Date de remise non renseignée'}
				</p>
				<p class="text-muted-foreground">
					{deadline ? `Échéance : ${formatLessonDate(deadline.dueAt)}` : 'Aucune échéance commune'}
				</p>
			</div>
			{#if assessment.kind === 'project'}<p class="text-xs text-muted-foreground">
					{summary.assessments[selectedIndex].delay}
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
	<div class="correction-body flex min-w-0 flex-col gap-4">
		<PrivacyNotice>
			Les notes, absences, liens et dates de remise ainsi que les commentaires sont des données privées utilisées pour
			l’évaluation et le suivi pédagogique.
		</PrivacyNotice>
		{#if errorMessage || $allErrors.length}
			<Alert.Root
				variant="destructive"
				bind:ref={errorSummary}
				role={$allErrors.length ? 'group' : 'alert'}
				aria-labelledby="correction-feedback-title"
				tabindex={-1}
				class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				<CircleAlertIcon aria-hidden="true" />
				<Alert.Title id="correction-feedback-title"
					>{conflict ? 'Version à actualiser' : 'Vérifiez la correction'}</Alert.Title
				>
				<Alert.Description
					><div class="flex flex-col gap-2">
						<p>{errorMessage}</p>
						{#if $allErrors.length}<ul class="flex flex-col gap-1">
								{#each $allErrors as error (error.path)}<li>
										{#if error.path === `assessments[${selectedIndex}].submissionUrl`}
											<Button
												type="button"
												variant="link"
												class="h-auto min-h-11 max-w-full justify-start px-0 text-left whitespace-normal"
												onclick={focusSubmissionLink}>Lien de la remise · {error.messages[0]}</Button
											>
										{:else}{error.messages[0]}{/if}
									</li>{/each}
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
			method="POST"
			id="correction-form"
			action={correctionPath + '?/saveAssessment'}
			use:actionTransport.enhance
			novalidate
			onsubmit={actionTransport.handleSubmit(save)}
			aria-busy={pending && !savingComment}
			class="flex min-w-0 flex-col gap-4"
		>
			<fieldset disabled={pending} class="correction-fields min-w-0" data-submission={submissionOpen}>
				<CorrectionCriteria
					{form}
					{assessment}
					assessmentIndex={selectedIndex}
					{current}
					{pending}
					{activeGroup}
					onGroupChange={(value) => (groupSelections[assessment.id] = value)}
				/>
				{#if submissionOpen}<Field.FieldGroup id="submission-fields" class="submission-fields gap-4 border-t pt-4">
						<CorrectionField
							{form}
							name={`assessments[${selectedIndex}].submissionUrl`}
							id="submission-url"
							label="Lien de la remise"
							required={false}
							type="url"
							description="Lien HTTPS vers GitHub, Teams ou le support reçu."
						/>
						<CorrectionField
							{form}
							name={`assessments[${selectedIndex}].submittedAt`}
							id="submission-date"
							label="Date de remise"
							required={current.status === 'graded' &&
								assessment.kind === 'project' &&
								current.latenessDecision === 'automatic' &&
								!!deadline}
							type="datetime-local"
						/>
						{#if assessment.kind === 'project'}<CorrectionField
								{form}
								name={`assessments[${selectedIndex}].latenessDecision`}
								id="submission-delay"
								label="Décision de retard ou non-remise"
								options={delayOptions}
								description="De 1 à 5 jours calendaires : −1 point par jour sur le projet /20 ; au-delà de 5 jours : zéro. Le plancher est zéro."
							/>{/if}
						{#if deadline?.submissionInstructions}<p
								class="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground"
							>
								{deadline.submissionInstructions}
							</p>{/if}
					</Field.FieldGroup>{/if}
			</fieldset>
		</form>

		{#if commentOpen}<section
				id="semester-comment"
				class="flex flex-col gap-3 border-t pt-4"
				aria-label="Commentaire privé du semestre"
			>
				<form
					method="POST"
					id="semester-comment-form"
					action={correctionPath + '?/saveComment'}
					use:commentTransport.enhance
					novalidate
					onsubmit={commentTransport.handleSubmit(saveComment)}
					aria-busy={savingComment}
				>
					<Field.FieldGroup>
						<CorrectionField
							form={commentForm}
							name="content"
							id="semester-comment-content"
							label="Commentaire privé du semestre"
							required={false}
							multiline
							maxlength={10000}
							disabled={pending}
							description="Conservé pour cet étudiant et ce module, prêt à copier dans le formulaire de l’école."
						/>
						<div class="flex flex-wrap items-center gap-3">
							<Button type="submit" variant="outline" class="min-h-11" disabled={pending || conflict || !commentDirty}
								>{#if savingComment}<Spinner data-icon="inline-start" />{/if}Enregistrer le commentaire</Button
							><Button
								type="button"
								variant="ghost"
								class="min-h-11"
								disabled={!$commentDraft.content}
								onclick={copyComment}><CopyIcon data-icon="inline-start" />Copier</Button
							>{#if commentDirty}<span class="text-sm text-muted-foreground">Commentaire non enregistré</span>{/if}
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
							{score.assessmentTitle} · {score.label} : {score.points ?? 'N/D'} / {score.maxPoints}
						</li>{/each}
				</ul>
			</section>{/if}
		<section
			id="calculation-details"
			tabindex="-1"
			hidden={!detailsOpen}
			aria-label="Détails du bilan"
			class="calculation-details correction-jump-target flex flex-col gap-4 border-t pt-4"
		>
			<h2 class="item-title">Détails du bilan</h2>
			{#if reviewRequired}<Alert.Root
					><CircleAlertIcon aria-hidden="true" /><Alert.Title>Barème modifié · correction à revoir</Alert.Title
					><Alert.Description
						>Vos points sont conservés. Vérifiez-les puis enregistrez cette évaluation pour confirmer la nouvelle
						grille.</Alert.Description
					></Alert.Root
				>{/if}
			<StudentGradeExport {rubric} contextId={initial.contextId} student={savedStudent} disabled={dirty || pending} />
			<p class="text-xs text-muted-foreground">
				{assessment.groups.map((group) => `${group.title} ${groupTotal(group.id)}`).join(' + ')}
			</p>
			<CorrectionCalculationDetails assessments={summary.assessments} results={summary.results} />
			{#if summary.diagnostics.length}<section
					id="correction-diagnostics"
					class="flex flex-col gap-4 border-t pt-4"
					aria-label="Détails de la correction"
				>
					<h3 class="item-title">Détails de la correction</h3>
					{#each summary.diagnostics as group (group.id)}<div class="flex flex-col gap-2">
							<h4 class="text-sm font-medium wrap-anywhere">{group.title}</h4>
							<ul class="flex flex-col gap-1 text-sm text-muted-foreground">
								{#each group.issues as issue, index (`${group.id}:${index}`)}<li class="wrap-anywhere">
										{issue}
									</li>{/each}
							</ul>
						</div>{/each}
				</section>{/if}
		</section>
	</div>
	<section
		id="correction-summary"
		tabindex="-1"
		class="bottom-summary correction-jump-target flex min-w-0 flex-wrap items-center justify-between gap-3"
		aria-label="Bilan des évaluations"
	>
		<div class="min-w-0">
			<h2 class="text-sm font-semibold wrap-anywhere tabular-nums">
				{assessment.title} · {summary.assessments[selectedIndex].mark}
			</h2>
			{#if rubric.results.length === 1}<p class="text-xs wrap-anywhere text-muted-foreground tabular-nums">
					{rubric.results[0].title} · {summary.results[0].mark}
				</p>{/if}
			<Button
				type="button"
				variant="ghost"
				class="min-h-11"
				aria-expanded={detailsOpen}
				aria-controls="calculation-details"
				onclick={toggleCalculationDetails}
				>{rubric.results.length > 1
					? `Détails du bilan (${rubric.results.length} résultats)`
					: 'Détails du bilan'}</Button
			>
		</div>
		<div class="summary-actions flex flex-wrap items-center gap-3">
			<Button
				type="button"
				variant="outline"
				class="correction-jump min-h-11"
				aria-controls="correction-entry"
				onclick={() => jumpTo('correction-entry')}>Revenir à la saisie</Button
			>
			<p role="status" aria-live="polite" class="save-state text-sm text-muted-foreground">
				{selectedScoreInvalid
					? 'Corrigez les points signalés avant d’enregistrer. Vos saisies sont conservées.'
					: selectedInvalid
						? 'Corrigez les champs signalés avant d’enregistrer. Vos saisies sont conservées.'
						: reviewRequired
							? 'Barème modifié : vérifiez puis enregistrez cette évaluation.'
							: pending
								? savingComment
									? 'Enregistrement du commentaire…'
									: 'Enregistrement de l’évaluation…'
								: dirtyCount
									? `${dirtyCount} évaluation${dirtyCount > 1 ? 's' : ''} non enregistrée${dirtyCount > 1 ? 's' : ''}`
									: commentDirty
										? 'Commentaire non enregistré.'
										: 'Aucune modification en attente.'}
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
				disabled={pending || conflict || (!selectedDirty && !reviewRequired)}
				>{#if pending && !savingComment}<Spinner data-icon="inline-start" />{/if}Enregistrer {assessment.title}</Button
			>
		</div>
	</section>
</div>

<AlertDialog.Root bind:open={confirmOpen}
	><AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
		><AlertDialog.Header
			><AlertDialog.Title
				>{confirmKind === 'reload' ? 'Recharger la correction ?' : 'Quitter la correction ?'}</AlertDialog.Title
			><AlertDialog.Description
				>{pending
					? 'Un enregistrement est en cours. Attendez sa fin avant de quitter la correction.'
					: confirmKind === 'reload'
						? 'La version actuelle remplacera toutes les évaluations et le commentaire en cours. Les modifications non enregistrées seront perdues.'
						: 'Les modifications non enregistrées des évaluations et du commentaire seront perdues.'}</AlertDialog.Description
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

<style>
	.calculation-details[hidden] {
		display: none;
	}

	.correction {
		padding-bottom: env(safe-area-inset-bottom);
	}
	.context-strip {
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--card);
	}
	.context-facts {
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
	.correction-body {
		border-radius: var(--radius);
		background: var(--card);
		padding: 1rem;
	}
	.bottom-summary {
		padding: 1rem 1.25rem;
		border-radius: var(--radius);
		background: var(--muted);
	}
	.context-identity nav {
		padding-left: 0.5rem;
	}
	.summary-actions {
		justify-content: flex-end;
	}
	@media (max-width: 39.99rem) {
		.correction-body,
		.bottom-summary {
			padding: 1rem;
		}
		.summary-actions {
			width: 100%;
			justify-content: start;
		}
		.summary-actions :global(button[type='submit']) {
			width: 100%;
		}
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

	.bottom-summary {
		padding-bottom: env(safe-area-inset-bottom);
	}
	.correction-jump-target {
		scroll-margin-block: 0.75rem;
	}
	.correction-jump-target:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	@media (max-width: 47.99rem) {
		.correction,
		.context-strip,
		.context-identity {
			gap: 0.5rem;
		}
		.context-strip {
			padding: 0.75rem;
		}
		.context-facts {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.25rem 0.5rem;
		}
		.submission-dates,
		.context-facts > p,
		.context-facts > :global(a) {
			grid-column: 1 / -1;
			overflow-wrap: anywhere;
		}
		.context-facts > :global(button) {
			min-width: 0;
			height: auto;
			white-space: normal;
		}
	}
	@media (min-width: 80rem) {
		.correction :global(.correction-jump) {
			display: none;
		}
	}
	@media (min-width: 48rem) {
		.context-identity {
			grid-template-columns: minmax(0, 1fr) minmax(11rem, 0.6fr);
		}
		.correction :global(.submission-fields) {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (min-width: 80rem) {
		.context-identity {
			grid-template-columns: minmax(10rem, 1fr) minmax(14rem, 1.5fr) 12rem auto;
			gap: 1.25rem;
		}
		.correction :global(.submission-fields) {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.correction :global([data-slot='native-select']) {
			font-size: 0.875rem;
		}
		.correction {
			margin-top: 0;
			gap: 0.5rem;
		}
		.context-strip {
			padding: 1rem 1.25rem;
			gap: 0.75rem;
		}

		.bottom-summary {
			padding-top: 0.75rem;
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
			padding-block: 0.75rem;
			gap: 0.5rem;
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
		.correction-fields[data-submission='true'] {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
			align-items: start;
			gap: 1.5rem;
		}
		.correction-fields[data-submission='true'] :global(.submission-fields) {
			display: flex;
			flex-direction: column;
			margin-top: 0.5rem;
		}
		.bottom-summary {
			padding-block: 0.5rem;
		}
		.save-state {
			max-width: 24rem;
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
