<script lang="ts">
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { tick, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { defaults, superForm, setError, type FormPathLeavesWithErrors } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { assessmentStatusLabels, type StudentGrading } from '#lib/domain/grading.js';
	import { calculateStudent } from '#lib/domain/grade-calculation.js';
	import {
		proposalDecisionReceiptSchema,
		type ProposalDecision,
		type ProposalDecisionReceipt,
		type ProposalReviewSelection,
		type ProposalSummary
	} from '#lib/domain/proposals.js';
	import { proposedPointsDiffer, proposedCommentDiffers } from '#lib/grading/proposal-comparison.js';
	import { projectDelayLabel } from '#lib/grading/grade-labels.js';
	import {
		makeProposalPointsSchema,
		proposalInput,
		recordedProposalInput,
		proposalPreview,
		proposalPointsDecision,
		proposalCommentSchema,
		retryDecision,
		reconcileProposalInput,
		type DecisionRetry,
		type ProposalPointsDraft,
		type ProposalDecisionInput
	} from '#lib/grading/proposal-form.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import CorrectionField from './CorrectionField.svelte';
	import ProposalScore from './ProposalScore.svelte';
	import ProposalGradeComparison from './ProposalGradeComparison.svelte';
	let {
		selection,
		queue,
		onrefresh
	}: {
		selection: ProposalReviewSelection;
		queue: ProposalSummary[];
		onrefresh: () => Promise<void>;
	} = $props();
	// The parent keys this editor by proposal ID. Refreshing its revision never resets either draft.
	const initial = untrack(() => ({
		id: selection.proposal.id,
		state: selection.proposal.state,
		points: selection.proposal.state === 'pending' ? proposalInput(selection) : recordedProposalInput(selection),
		comment: selection.proposal.payload?.semesterComment ?? selection.student.comment.content
	}));
	const schema = makeProposalPointsSchema(() => selection);
	const form = superForm<ProposalPointsDraft, string>(defaults(initial.points, zod4(schema)), {
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
	const pointsTransport = createFormActionTransport(form);
	const { form: draft, errors, allErrors } = form;
	const commentForm = superForm(defaults({ content: initial.comment }, zod4(proposalCommentSchema)), {
		dataType: 'json',
		validators: zod4Client(proposalCommentSchema),
		applyAction: 'never',
		invalidateAll: false,
		resetForm: false,
		taintedMessage: false,
		validationMethod: 'submit-only',
		scrollToError: 'off',
		autoFocusOnError: false
	});
	const commentTransport = createFormActionTransport(commentForm);
	const { form: commentDraft, errors: commentErrors } = commentForm;
	let pointsBaseline = $state(JSON.stringify(initial.points));
	let commentBaseline = $state(initial.comment);
	let decisionReceipt = $state.raw<ProposalDecisionReceipt | null>(null);
	let localStudent = $state.raw<StudentGrading | null>(null);
	const review = $derived({ ...selection, student: localStudent ?? selection.student });
	const proposal = $derived(
		decisionReceipt && decisionReceipt.revision >= selection.proposal.revision
			? { ...selection.proposal, ...decisionReceipt }
			: selection.proposal
	);
	const externallyDecided = $derived(initial.state === 'pending' && proposal.state !== 'pending' && !decisionReceipt);
	const rubric = $derived(selection.rubric);
	const assessment = $derived(rubric.assessments.find((item) => item.id === selection.assessmentId)!);
	const context = $derived(rubric.contexts.find((item) => item.id === selection.contextId));
	const record = $derived(review.student.corrections.find((item) => item.assessmentId === selection.assessmentId));
	const deadline = $derived(context?.deadlines.find((item) => item.assessmentId === selection.assessmentId));
	const proposedDifferentCount = $derived(
		assessment.lines.reduce(
			(count, line) =>
				count +
				Number(
					proposedPointsDiffer(
						record?.scores.find((score) => score.lineId === line.id)?.points ?? null,
						proposal.payload?.scores.find((score) => score.lineId === line.id)?.points
					)
				),
			0
		)
	);
	const proposedCommentDifferent = $derived(
		proposedCommentDiffers(review.student.comment.content, proposal.payload?.semesterComment)
	);
	let selectedGroup = $state('');
	const activeGroup = $derived(
		assessment.groups.some((group) => group.id === selectedGroup) ? selectedGroup : assessment.groups[0]?.id
	);
	const current = $derived.by(() => ({
		status: $draft.status,
		scores: $draft.scores.map((score) => ({ ...score }))
	}));
	const absent = $derived(current.status.startsWith('absent_'));
	const shapeChanged = $derived(
		current.scores.length !== assessment.lines.length ||
			assessment.lines.some((line, index) => current.scores[index]?.lineId !== line.id)
	);
	const pointsDirty = $derived(proposal.state === 'pending' && JSON.stringify(current) !== pointsBaseline);
	const commentDirty = $derived(proposal.commentState === 'pending' && $commentDraft.content !== commentBaseline);
	const dirty = $derived(pointsDirty || commentDirty);
	let pending = $state<ProposalDecision['action'] | 'refresh' | null>(null);
	let commentOpen = $state(false);
	let validating = $state(false);
	let conflict = $state(false);
	let errorMessage = $state('');
	let message = $state('');
	let errorSummary = $state<HTMLDivElement | null>(null);
	let detached = $state<ProposalPointsDraft['scores']>([]);
	let confirmOpen = $state(false);
	let destination = $state<ResolvedPathname>(resolve('/enseignant/notation'));
	let allowNavigation = false;
	const retries: Partial<Record<ProposalDecision['action'], DecisionRetry>> = {};
	const pointsBlocked = $derived(
		conflict || shapeChanged || selection.pointsIssues.length > 0 || proposal.legacy || absent
	);
	const commentBlocked = $derived(conflict || selection.commentIssues.length > 0 || proposal.legacy);
	const position = $derived(queue.findIndex((item) => item.id === initial.id));
	const gridLink = $derived(
		resolve('/enseignant/notation') + `?module=${rubric.module.id}&contexte=${selection.contextId}`
	);
	const correctionLink = $derived(
		resolve('/enseignant/notation/[contextId]/[studentId]', {
			contextId: selection.contextId,
			studentId: selection.student.id
		})
	);
	const proposedInput = $derived(proposalInput(review));
	const recorded = $derived(calculateStudent(rubric.assessments, rubric.results, review.student, context?.deadlines));
	const proposed = $derived(
		calculateStudent(rubric.assessments, rubric.results, proposalPreview(review, proposedInput), context?.deadlines)
	);
	const retained = $derived(
		calculateStudent(rubric.assessments, rubric.results, proposalPreview(review, current), context?.deadlines)
	);
	const diagnostics = $derived.by(() => {
		const groups = rubric.assessments.flatMap((item) => {
			const issues = [...new Set(retained.assessments[item.id].issues)];
			return issues.length ? [{ id: item.id, title: item.title, issues }] : [];
		});
		for (const result of rubric.results) {
			const issues = [
				...new Set(
					retained.results[result.id].issues.filter(
						(issue) =>
							!rubric.assessments.some(
								(item) => retained.assessments[item.id].issues.length > 0 && issue.startsWith(`${item.title} : `)
							)
					)
				)
			];
			if (issues.length) groups.push({ id: result.id, title: result.title, issues });
		}
		return groups;
	});
	const diagnosticCount = $derived(diagnostics.reduce((sum, group) => sum + group.issues.length, 0));
	const statusOptions = Object.entries(assessmentStatusLabels).map(([value, label]) => ({
		value,
		label
	}));
	function proposalLink(index: number) {
		return resolve('/enseignant/propositions') + `?proposition=${queue[index].id}&contexte=${queue[index].contextId}`;
	}
	function groupTotal(groupId: string, source: 'recorded' | 'proposed' | 'retained') {
		const lines = assessment.lines.filter((line) => line.groupId === groupId);
		const scores =
			source === 'recorded'
				? (record?.scores ?? [])
				: source === 'proposed'
					? (proposalPreview(review, proposedInput).corrections.find((item) => item.assessmentId === assessment.id)
							?.scores ?? [])
					: (proposalPreview(review, current).corrections.find((item) => item.assessmentId === assessment.id)?.scores ??
						[]);
		const values = lines.map((line) => scores.find((score) => score.lineId === line.id)?.points);
		const complete = values.every((points) => points != null && Number.isInteger(points));
		const sum = values.reduce<number>(
			(total, points) => total + (typeof points === 'number' && Number.isInteger(points) && points >= 0 ? points : 0),
			0
		);
		return `${sum} / ${lines.reduce((total, line) => total + line.maxPoints, 0)}${complete ? '' : ' · incomplet'}`;
	}
	function delayLabel() {
		return projectDelayLabel(assessment, record, deadline);
	}
	async function focusError() {
		notify(errorMessage, 'error');
		await tick();
		errorSummary?.focus();
	}
	function applyErrors(fields: Record<string, string>, scope: 'points' | 'comment') {
		if (scope === 'comment') {
			if (fields.content) commentErrors.set({ content: [fields.content] });
			return;
		}
		const snapshot = form.capture();
		for (const [raw, text] of Object.entries(fields)) {
			const path = raw.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
			setError(
				snapshot,
				(/^(scores|status)(\.|\[|$)/.test(path) ? path : '') as FormPathLeavesWithErrors<ProposalPointsDraft> | '',
				text,
				{ overwrite: true }
			);
		}
		errors.set(snapshot.errors);
	}
	async function execute(input: ProposalDecisionInput) {
		if (pending) return;
		const alreadyAcceptedComment = proposal.commentState === 'accepted';
		pending = input.action;
		errorMessage = '';
		message = '';
		try {
			const request = retryDecision(input, retries[input.action]);
			retries[input.action] = request.retry;
			const transport =
				input.action === 'accept_comment' || input.action === 'keep_comment' ? commentTransport : pointsTransport;
			const response = await transport.submit(
				resolve('/enseignant/propositions') + '?/decideProposal',
				{ proposalId: initial.id, decision: request.decision },
				(value) => proposalDecisionReceiptSchema.refine((receipt) => receipt.id === initial.id).parse(value)
			);
			decisionReceipt = response;
			if (input.action === 'accept_points') {
				localStudent = proposalPreview(review, current);
				pointsBaseline = JSON.stringify(current);
				message = 'Points retenus enregistrés. Le commentaire conserve sa décision indépendante.';
			} else if (input.action === 'accept_comment') {
				localStudent = {
					...review.student,
					comment: { revision: review.student.comment.revision + 1, content: input.content }
				};
				commentBaseline = input.content;
				message = 'Commentaire retenu enregistré. Les points conservent leur décision indépendante.';
			} else if (input.action === 'keep_comment') {
				commentBaseline = $commentDraft.content;
				message = 'Votre commentaire enregistré est conservé.';
			} else {
				pointsBaseline = JSON.stringify(current);
				commentBaseline = $commentDraft.content;
				message = alreadyAcceptedComment
					? 'Proposition refusée. Les points enregistrés sont conservés ; le commentaire déjà repris reste enregistré.'
					: 'Proposition refusée. Les points enregistrés et votre commentaire actuel sont conservés.';
			}
			conflict = false;
			try {
				await onrefresh();
				localStudent = null;
			} catch {
				errorMessage =
					'La décision est enregistrée, mais l’actualisation a échoué. Actualisez les références ; vos saisies sont conservées.';
				await focusError();
			}
		} catch (error) {
			if (error instanceof TeachingRequestError) {
				conflict = error.status === 409;
				errorMessage = `${error.message} Vos saisies sont conservées.`;
				applyErrors(
					error.fields,
					input.action === 'accept_comment' || input.action === 'keep_comment' ? 'comment' : 'points'
				);
			} else errorMessage = 'Décision impossible. Vos saisies sont conservées ; réessayez.';
			await focusError();
		} finally {
			pending = null;
		}
	}
	async function acceptPoints(event: SubmitEvent) {
		event.preventDefault();
		if (pending || pointsBlocked || proposal.state !== 'pending') return;
		if (validating) return;
		validating = true;
		const validated = await form.validateForm({ update: true, focusOnError: false });
		validating = false;
		if (!validated.valid) {
			errorMessage = 'Vérifiez les champs indiqués. Toutes vos saisies sont conservées.';
			await focusError();
			return;
		}
		await execute(proposalPointsDecision(validated.data, proposal.revision));
	}
	async function acceptComment(event?: SubmitEvent) {
		event?.preventDefault();
		if (pending || commentBlocked || proposal.commentState !== 'pending') return;
		if (validating) return;
		validating = true;
		const validated = await commentForm.validateForm({ update: true, focusOnError: false });
		validating = false;
		if (!validated.valid) {
			errorMessage = 'Vérifiez le commentaire. Votre texte est conservé.';
			await focusError();
			return;
		}
		await execute({
			action: 'accept_comment',
			expectedRevision: proposal.revision,
			content: validated.data.content
		});
	}
	async function refresh() {
		if (pending) return;
		pending = 'refresh';
		errorMessage = '';
		message = '';
		try {
			await onrefresh();
			await tick();
			localStudent = null;
			const reconciled = reconcileProposalInput(selection, current);
			detached = [...new Map([...detached, ...reconciled.detached].map((score) => [score.lineId, score])).values()];
			draft.set(reconciled.draft);
			errors.set({});
			commentErrors.set({});
			conflict = false;
			message = 'Références actualisées. Vos points retenus et votre commentaire en cours sont conservés.';
		} catch {
			errorMessage = 'Actualisation impossible. Vos saisies sont conservées ; réessayez.';
			await focusError();
		} finally {
			pending = null;
		}
	}
	async function toggleComment() {
		commentOpen = !commentOpen;
		if (commentOpen) {
			await tick();
			const comparison = document.getElementById('proposal-comment-comparison');
			comparison?.focus({ preventScroll: true });
			comparison?.scrollIntoView({ block: 'nearest' });
		}
	}
	beforeNavigate((navigation) => {
		if (allowNavigation || (!dirty && !pending)) return;
		navigation.cancel();
		if (navigation.willUnload || !navigation.to) return;
		destination = (navigation.to.url.pathname + navigation.to.url.search + navigation.to.url.hash) as ResolvedPathname;
		confirmOpen = true;
	});
	async function leave() {
		if (pending) return;
		confirmOpen = false;
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
	function reserveViewport(node: HTMLDivElement) {
		function measure() {
			node.style.setProperty(
				'--proposal-height',
				`${Math.max(0, window.innerHeight - node.getBoundingClientRect().top - window.scrollY - 8)}px`
			);
		}
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	}
</script>

<ActionNotice {message} />

<div class="proposal-review flex min-w-0 flex-col gap-3" {@attach reserveViewport}>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex flex-wrap items-center gap-1">
			<Button href={gridLink} variant="ghost" class="min-h-11" disabled={!!pending || validating}
				><ChevronLeftIcon data-icon="inline-start" />Retour à la grille</Button
			>
			<Button href={correctionLink} variant="ghost" class="min-h-11" disabled={!!pending || validating}
				>Ouvrir la correction</Button
			>
		</div>
		<Button
			href={`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: rubric.module.id })}?retour=notation&contexte=${selection.contextId}`}
			variant="ghost"
			class="min-h-11"
			disabled={!!pending || validating}>Voir le barème</Button
		>
	</div>
	<section class="context-strip" aria-label="Contexte de la proposition">
		<div class="context-identity">
			<div class="flex min-w-0 flex-col gap-1">
				<h1 class="correction-title">
					{selection.student.name}
				</h1>
				<p class="text-sm wrap-anywhere text-muted-foreground">
					{context?.className} · {context?.academicYear} · {rubric.module.title}
				</p>
				<p class="text-xs wrap-anywhere text-muted-foreground">
					{assessment.title} · Statut enregistré : {assessmentStatusLabels[
						record?.status ?? 'to_evaluate'
					]}{delayLabel() ? ` · ${delayLabel()}` : ''}
				</p>
			</div>
			<CorrectionField
				{form}
				name="status"
				id="proposal-status"
				formId="proposal-points-form"
				label={proposal.state === 'pending'
					? 'Statut après validation'
					: proposal.state === 'accepted'
						? 'Statut validé'
						: 'Statut retenu (non appliqué)'}
				options={statusOptions}
				disabled={!!pending || validating || proposal.state !== 'pending' || proposal.legacy}
			/>
			<nav class="flex flex-wrap items-center justify-end gap-1" aria-label="Propositions">
				<Button
					href={position > 0 ? proposalLink(position - 1) : undefined}
					disabled={!!pending || validating || position <= 0}
					variant="ghost"
					size="icon"
					class="min-h-11 min-w-11"
					aria-label="Proposition précédente"><ChevronLeftIcon /></Button
				>
				<span class="text-xs text-muted-foreground tabular-nums"
					>Proposition {position < 0 ? 'N/D' : position + 1} / {queue.length}</span
				>
				<Button
					href={position >= 0 && position < queue.length - 1 ? proposalLink(position + 1) : undefined}
					disabled={!!pending || validating || position < 0 || position >= queue.length - 1}
					variant="ghost"
					size="icon"
					class="min-h-11 min-w-11"
					aria-label="Proposition suivante"><ChevronRightIcon /></Button
				>
			</nav>
		</div>
		{#if record?.submissionUrl || record?.submittedAt || deadline}<div
				class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground"
			>
				{#if record?.submissionUrl}<Button
						href={record.submissionUrl}
						target="_blank"
						rel="noopener noreferrer"
						variant="ghost"
						class="min-h-11">Ouvrir la remise<ExternalLinkIcon data-icon="inline-end" /></Button
					>{/if}
				{#if record?.submittedAt}<span>Remise : {formatLessonDate(record.submittedAt)}</span>{/if}
				{#if deadline}<span>Échéance : {formatLessonDate(deadline.dueAt)}</span>{/if}
			</div>{/if}
	</section>
	<div
		class="proposal-body flex min-w-0 flex-col gap-3"
		data-auxiliary={commentOpen ||
			errorMessage !== '' ||
			selection.pointsIssues.length > 0 ||
			selection.commentIssues.length > 0 ||
			shapeChanged ||
			proposal.legacy}
	>
		<PrivacyNotice>
			Les propositions de points et de commentaires sont privées et soumises à votre examen. Seuls les éléments que vous
			validez sont enregistrés dans la correction.
		</PrivacyNotice>
		{#if errorMessage}<Alert.Root
				variant="destructive"
				bind:ref={errorSummary}
				role={$allErrors.length ? 'group' : 'alert'}
				aria-labelledby="proposal-feedback-title"
				tabindex={-1}
				class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				<CircleAlertIcon aria-hidden="true" /><Alert.Title id="proposal-feedback-title"
					>{conflict ? 'Version à actualiser' : 'Décision à vérifier'}</Alert.Title
				>
				<Alert.Description
					><div class="flex flex-col gap-2">
						<p>{errorMessage}</p>
						{#if $allErrors.length}<ul class="flex flex-col gap-1">
								{#each $allErrors as error (error.path)}<li>{error.messages[0]}</li>{/each}
							</ul>{/if}<Button
							type="button"
							variant="outline"
							class="min-h-11 self-start"
							disabled={!!pending || validating}
							onclick={refresh}>Actualiser les références</Button
						>
					</div></Alert.Description
				>
			</Alert.Root>{/if}
		{#if proposal.legacy}<Alert.Root
				><CircleAlertIcon aria-hidden="true" /><Alert.Title>Ancienne proposition</Alert.Title><Alert.Description
					>Cette proposition ne contient pas les références nécessaires à une validation. Les points enregistrés restent
					conservés. Demandez une nouvelle proposition à partir de la correction actuelle.</Alert.Description
				></Alert.Root
			>{/if}
		{#if selection.pointsIssues.length || selection.commentIssues.length || shapeChanged}<Alert.Root
				><CircleAlertIcon aria-hidden="true" /><Alert.Title>Références à rapprocher</Alert.Title><Alert.Description
					><div class="flex flex-col gap-2">
						{#if selection.pointsIssues.length || shapeChanged}<div>
								<p class="font-medium">Validation des points bloquée</p>
								<ul class="list-inside list-disc">
									{#each selection.pointsIssues as issue (issue)}<li>
											{issue}
										</li>{/each}{#if shapeChanged}<li>
											Le barème actuel ne correspond plus aux critères affichés dans votre saisie.
										</li>{/if}
								</ul>
							</div>{/if}
						{#if selection.commentIssues.length}<div>
								<p class="font-medium">Reprise du commentaire bloquée</p>
								<ul class="list-inside list-disc">
									{#each selection.commentIssues as issue (issue)}<li>{issue}</li>{/each}
								</ul>
							</div>{/if}
						<p>
							Actualisez les références pour comparer avec la correction actuelle. Si l’écart persiste, demandez une
							nouvelle proposition ; vos saisies restent disponibles ici.
						</p>
						<Button
							type="button"
							variant="outline"
							class="min-h-11 self-start"
							disabled={!!pending || validating}
							onclick={refresh}><RefreshCwIcon data-icon="inline-start" />Actualiser et conserver mes saisies</Button
						>
					</div></Alert.Description
				></Alert.Root
			>{/if}
		{#if proposal.state !== 'pending'}<p class="text-sm wrap-anywhere" role="status">
				{proposal.state === 'accepted'
					? externallyDecided
						? 'Points déjà validés dans une autre session. Vos valeurs retenues conservées peuvent différer de la correction enregistrée.'
						: 'Points validés et appliqués à la correction.'
					: 'Proposition refusée : les points enregistrés ont été conservés.'}
				{proposal.commentState === 'pending'
					? 'Le commentaire attend votre décision séparée.'
					: proposal.commentState === 'accepted'
						? 'Le commentaire retenu a été enregistré.'
						: proposal.commentState === 'kept'
							? 'Votre commentaire enregistré est conservé.'
							: ''}
			</p>{/if}
		{#if absent && proposal.state === 'pending'}<p class="text-sm text-muted-foreground">
				Les champs de points sont désactivés pendant l’absence. Choisissez un statut sans absence pour examiner et
				valider les points retenus.
			</p>{/if}
		<div class="proposal-work">
			<form
				method="POST"
				id="proposal-points-form"
				novalidate
				use:pointsTransport.enhance
				onsubmit={pointsTransport.handleSubmit(acceptPoints)}
				aria-busy={pending === 'accept_points'}
				class="points-form min-w-0"
			>
				<div class="flex flex-col gap-1 pb-2">
					<p class="text-sm font-medium wrap-anywhere">
						{proposedDifferentCount} lignes proposées différentes sur {assessment.lines.length}
					</p>
					<p class="text-xs wrap-anywhere text-muted-foreground">
						Le repère compare le proposé à l’enregistré actuel. Ajusté indique une modification de votre valeur retenue.
					</p>
				</div>
				<Tabs.Root value={activeGroup} onValueChange={(value) => (selectedGroup = value)} class="min-w-0 gap-2">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<h2 class="panel-title">
							{assessment.groups.find((group) => group.id === activeGroup)?.title}
						</h2>
						<Tabs.List aria-label="Groupes de critères" class="h-auto max-w-full flex-wrap justify-start"
							>{#each assessment.groups as group (group.id)}<Tabs.Trigger
									value={group.id}
									class="min-h-11 whitespace-normal">{group.title}</Tabs.Trigger
								>{/each}</Tabs.List
						>
					</div>
					{#each assessment.groups as group (group.id)}<Tabs.Content value={group.id} class="min-w-0">
							<div
								class="criteria-scroll"
								role="region"
								aria-label={`Comparaison des points de ${group.title}`}
								tabindex="-1"
							>
								<div
									role="table"
									aria-label={`Enregistré, proposé et retenu · ${group.title}`}
									class="comparison-table"
								>
									<div role="rowgroup" class="comparison-head">
										<div role="row" class="comparison-header">
											<span role="columnheader">Critère</span><span role="columnheader">Repère du barème</span><span
												role="columnheader">Enregistré</span
											><span role="columnheader">Proposé</span><span role="columnheader">Retenu</span>
										</div>
									</div>
									<Form.Field {form} name="scores" role="rowgroup" class="comparison-rows flex flex-col gap-0">
										{#each assessment.lines.filter((line) => line.groupId === group.id) as line (line.id)}{@const index =
												current.scores.findIndex((score) => score.lineId === line.id)}
											{#if index >= 0}<ProposalScore
													{form}
													{index}
													{line}
													required={current.status === 'graded' &&
														!(assessment.kind === 'project' && record?.latenessDecision === 'refused')}
													recorded={record?.scores.find((score) => score.lineId === line.id)?.points ?? null}
													proposed={proposal.payload?.scores.find((score) => score.lineId === line.id)?.points}
													initial={initial.points.scores.find((score) => score.lineId === line.id)?.points ?? ''}
													disabled={absent || !!pending || proposal.state !== 'pending' || proposal.legacy}
												/>
											{:else}<div role="row" class="border-b py-3">
													<div role="cell">
														{line.label} · Critère ajouté au barème. Actualisez les références pour retrouver votre saisie.
													</div>
												</div>{/if}
										{/each}
									</Form.Field>
									<div role="rowgroup" class="comparison-footer">
										<div role="row" class="comparison-total">
											<span role="rowheader" class="total-label" aria-colspan={2}>Total {group.title}</span><span
												role="cell">{groupTotal(group.id, 'recorded')}</span
											><span role="cell">{groupTotal(group.id, 'proposed')}</span><span role="cell"
												>{groupTotal(group.id, 'retained')}</span
											>
										</div>
									</div>
								</div>
								<p class="pt-2 text-xs text-muted-foreground">
									Points entiers. Un champ vide reste non noté. Les critères non proposés conservent leurs points
									enregistrés.
								</p>
							</div>
						</Tabs.Content>{/each}
				</Tabs.Root>
			</form>
			<aside class="proposal-context" aria-label="Impact et commentaire privé">
				<ProposalGradeComparison {rubric} {assessment} {recorded} {proposed} {retained} />
				{#if proposal.commentState !== 'none'}<section
						class="comment-strip flex flex-wrap items-center justify-between gap-3 border-y py-2"
						aria-label="Proposition de commentaire de semestre"
					>
						<div class="comment-copy flex min-w-0 flex-col gap-1">
							<h2 class="text-sm font-medium">Commentaire de semestre</h2>
							{#if proposal.commentState === 'pending' && proposal.payload?.semesterComment !== undefined}
								<Badge variant="outline" class="h-auto max-w-full whitespace-normal">
									{proposedCommentDifferent ? 'Commentaire proposé différent' : 'Commentaire proposé identique'}
								</Badge>
							{/if}
							<p class="comment-excerpt text-xs wrap-anywhere text-muted-foreground">
								{proposal.commentState === 'accepted'
									? 'Commentaire retenu enregistré.'
									: proposal.commentState === 'kept'
										? 'Votre commentaire enregistré est conservé.'
										: `Proposé : « ${proposal.payload?.semesterComment ?? ''} »`}
							</p>
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="ghost"
								class="min-h-11"
								aria-expanded={commentOpen}
								aria-controls="proposal-comment-comparison"
								onclick={toggleComment}>{commentOpen ? 'Refermer le commentaire' : 'Examiner le commentaire'}</Button
							>
						</div>
					</section>{/if}
				{#if commentOpen}<section
						id="proposal-comment-comparison"
						tabindex="-1"
						class="flex flex-col gap-3 border-b pb-4"
						aria-label="Comparaison du commentaire"
					>
						<div class="comment-reference grid gap-4">
							<div class="flex min-w-0 flex-col gap-1">
								<h3 class="text-sm font-medium">Enregistré</h3>
								<p class="max-w-prose text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
									{review.student.comment.content || 'Aucun commentaire enregistré.'}
								</p>
							</div>
							<div class="flex min-w-0 flex-col gap-1">
								<h3 class="text-sm font-medium">Proposé</h3>
								<p class="max-w-prose text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">
									{proposal.payload?.semesterComment || 'Commentaire proposé vide.'}
								</p>
							</div>
						</div>
						<form
							method="POST"
							id="proposal-comment-form"
							novalidate
							use:commentTransport.enhance
							onsubmit={commentTransport.handleSubmit(acceptComment)}
							aria-busy={pending === 'accept_comment'}
						>
							<Field.FieldGroup>
								<CorrectionField
									form={commentForm}
									name="content"
									id="proposal-retained-comment"
									label="Commentaire retenu"
									required={false}
									multiline
									maxlength={10000}
									disabled={!!pending || validating || proposal.commentState !== 'pending' || proposal.legacy}
									description="Ajustez le texte puis reprenez-le explicitement. La validation des points n’enregistre pas ce commentaire."
								/>
								{#if proposal.commentState === 'pending'}<div class="flex flex-wrap items-center gap-2">
										<Button
											type="submit"
											variant="outline"
											class="min-h-11"
											disabled={!!pending || validating || commentBlocked}>Reprendre le commentaire</Button
										><Button
											type="button"
											variant="ghost"
											class="min-h-11"
											disabled={!!pending || validating || conflict || proposal.legacy}
											onclick={() => execute({ action: 'keep_comment', expectedRevision: proposal.revision })}
											>Conserver mon commentaire</Button
										>{#if commentDirty}<span class="text-xs text-muted-foreground">Texte retenu modifié</span>{/if}
									</div>{/if}
							</Field.FieldGroup>
						</form>
					</section>{/if}
			</aside>
		</div>
		{#if diagnosticCount || detached.length}<details class="diagnostics border-t pt-2">
				<summary
					class="min-h-11 cursor-pointer py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>Détails du calcul{diagnosticCount
						? ` · ${diagnosticCount} élément${diagnosticCount > 1 ? 's' : ''}`
						: ''}{detached.length
						? ` · ${detached.length} saisie${detached.length > 1 ? 's' : ''} de critère retiré conservée${detached.length > 1 ? 's' : ''}`
						: ''}</summary
				>
				<div class="flex flex-col gap-3 pb-3">
					{#each diagnostics as group (group.id)}<div>
							<h3 class="text-sm font-medium">{group.title}</h3>
							<ul class="list-inside list-disc text-sm wrap-anywhere text-muted-foreground">
								{#each group.issues as issue (issue)}<li>{issue}</li>{/each}
							</ul>
						</div>{/each}{#if detached.length}<div>
							<h3 class="text-sm font-medium">Saisies de critères retirés conservées</h3>
							<ul class="text-sm wrap-anywhere text-muted-foreground">
								{#each detached as score (score.lineId)}<li>
										{score.lineId} : {score.points || 'N/D'} points. Non appliqué au barème actuel.
									</li>{/each}
							</ul>
						</div>{/if}
				</div>
			</details>{/if}
	</div>
	<footer class="bottom-summary" aria-label="Bilan et décision sur la proposition">
		<div class="decision flex min-w-0 flex-col gap-2">
			<p class="text-xs wrap-anywhere text-muted-foreground">
				{proposal.state === 'accepted'
					? 'Points validés'
					: proposal.state === 'rejected'
						? 'Points refusés'
						: pointsBlocked
							? 'Validation des points indisponible'
							: 'Barème et correction à jour'}{diagnosticCount
					? ` · ${diagnosticCount} élément${diagnosticCount > 1 ? 's' : ''} à examiner`
					: ''}
			</p>
			<p class="text-xs wrap-anywhere text-muted-foreground">
				{proposal.state === 'pending'
					? `Les points retenus seront appliqués à ${assessment.title}. Statut après validation : ${assessmentStatusLabels[current.status]}.`
					: proposal.state === 'accepted'
						? `Statut validé : ${assessmentStatusLabels[current.status]}.`
						: 'Les valeurs retenues affichées n’ont pas été appliquées.'}
				{proposal.commentState === 'pending' ? 'Le commentaire attend une décision séparée.' : ''}
			</p>
			{#if proposal.state === 'pending'}<div class="decision-actions flex flex-wrap gap-2">
					<Button
						type="submit"
						form="proposal-points-form"
						class="min-h-11"
						disabled={!!pending || validating || pointsBlocked}
						>{#if pending === 'accept_points'}<Spinner data-icon="inline-start" />{/if}Valider les points</Button
					><Button
						type="button"
						variant="outline"
						class="min-h-11"
						disabled={!!pending || validating || conflict}
						onclick={() => execute({ action: 'reject', expectedRevision: proposal.revision })}>Refuser</Button
					>
				</div>{/if}
			<p role="status" aria-live="polite" class="text-xs wrap-anywhere text-muted-foreground">
				{pending
					? pending === 'refresh'
						? 'Actualisation des références…'
						: 'Enregistrement de la décision…'
					: pointsDirty || commentDirty
						? 'Modifications retenues non enregistrées.'
						: proposal.state === 'pending'
							? 'Votre décision reste à enregistrer.'
							: ''}
			</p>
		</div>
	</footer>
</div>

<AlertDialog.Root bind:open={confirmOpen}
	><AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
		><AlertDialog.Header
			><AlertDialog.Title>Quitter cette proposition ?</AlertDialog.Title><AlertDialog.Description
				>{pending
					? 'Un enregistrement est en cours. Attendez sa fin avant de quitter.'
					: 'Vos ajustements de points et de commentaire non enregistrés seront perdus.'}</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel class="min-h-11">Continuer à examiner</AlertDialog.Cancel><AlertDialog.Action
				class="min-h-11"
				disabled={!!pending || validating}
				onclick={leave}>Quitter sans enregistrer</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<style>
	.proposal-work {
		display: grid;
		min-width: 0;
		gap: 1.5rem;
	}
	.proposal-context {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1.25rem;
	}
	@media (min-width: 80rem) {
		.proposal-work {
			grid-template-columns: minmax(0, 1fr) minmax(17rem, 0.45fr);
		}
		.proposal-context {
			background: var(--muted);
			padding: 1.25rem;
		}
		.proposal-context .comment-reference {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (min-width: 80rem) and (min-height: 36rem) {
		.proposal-work {
			flex: 1;
			min-height: 0;
		}
		.proposal-context {
			overflow-y: auto;
			overscroll-behavior-y: contain;
			padding-block: 0.25rem;
			padding-right: 0.25rem;
		}
	}

	.proposal-review {
		padding-bottom: env(safe-area-inset-bottom);
	}
	.context-strip {
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--card);
	}
	.proposal-body {
		padding: 1rem;
		border-radius: var(--radius);
		background: var(--card);
	}
	.bottom-summary {
		padding: 1rem 1.25rem;
		border-radius: var(--radius);
		background: var(--muted);
	}
	.points-form {
		container: comparison / inline-size;
	}

	.context-strip {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.context-identity {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: end;
		gap: 0.75rem;
	}
	.proposal-review :global([data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.criteria-scroll {
		padding: 0.25rem;
		overflow-y: auto;
		max-height: 36rem;
		scrollbar-color: var(--border) transparent;
		scrollbar-width: thin;
		outline-offset: 0.25rem;
	}
	.criteria-scroll:focus-visible {
		outline: 2px solid var(--ring);
	}
	.comparison-head {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.comparison-total {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		padding: 0.5rem 0.25rem;
		background: var(--muted);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.total-label {
		grid-column: 1 / -1;
		font-weight: 500;
	}
	.comment-copy {
		flex: 1 1 18rem;
		min-width: min(100%, 18rem);
	}
	.comment-excerpt {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
	.bottom-summary {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-bottom: env(safe-area-inset-bottom);
	}

	.decision-actions :global(button) {
		flex: 1;
	}
	@media (min-width: 48rem) {
		.context-identity {
			grid-template-columns: minmax(0, 1fr) minmax(13rem, 0.5fr);
		}
		.context-identity nav {
			grid-column: 1 / -1;
		}
		.comment-reference {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@container comparison (min-width: 41rem) {
		.criteria-scroll {
			scroll-padding-top: 3rem;
		}
		.comparison-head {
			position: sticky;
			top: 0;
			z-index: 1;
			background: var(--muted);
			width: auto;
			height: auto;
			overflow: visible;
			clip-path: none;
			white-space: normal;
		}
		.comparison-header {
			display: grid;
			grid-template-columns:
				minmax(7rem, 1.3fr) minmax(8rem, 2fr) repeat(2, minmax(4rem, 0.8fr))
				minmax(6rem, 1fr);
			gap: 0.75rem;
			padding: 0.25rem 0.25rem;
			background: var(--muted);
			color: var(--muted-foreground);
			font-size: 0.75rem;
		}
		.comparison-header > :nth-child(n + 3) {
			text-align: center;
		}
		.comparison-total {
			grid-template-columns:
				minmax(7rem, 1.3fr) minmax(8rem, 2fr) repeat(2, minmax(4rem, 0.8fr))
				minmax(6rem, 1fr);
			gap: 0.75rem;
			padding-block: 0.25rem;
		}
		.total-label {
			grid-column: span 2;
		}
		.comparison-total > :not(.total-label) {
			text-align: center;
		}
	}

	@media (min-width: 80rem) {
		.proposal-review {
			margin-top: 0;
			gap: 0.5rem;
		}
		.context-identity {
			grid-template-columns: minmax(0, 1fr) 13rem auto;
			gap: 1.25rem;
		}
		.context-identity nav {
			grid-column: auto;
		}
		.proposal-review :global([data-slot='native-select']) {
			font-size: 0.875rem;
		}
		.bottom-summary {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			gap: 1.5rem;
		}
		.decision {
			justify-content: space-between;
		}
	}
	@media (min-width: 80rem) and (min-height: 36rem) {
		.proposal-review {
			height: var(--proposal-height, calc(100dvh - 5rem));
		}
		.proposal-review > :not(.proposal-body) {
			flex-shrink: 0;
		}
		.proposal-body {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior-y: contain;
			scrollbar-color: var(--border) transparent;
			scrollbar-width: thin;
		}
		.proposal-body > * {
			flex-shrink: 0;
		}
		.points-form {
			flex: 1;
			min-height: 10rem;
		}
		.points-form :global([data-slot='tabs']) {
			display: grid;
			height: 100%;
			grid-template-rows: auto minmax(0, 1fr);
		}
		.points-form :global([data-slot='tabs-content']) {
			min-height: 0;
		}
		.criteria-scroll {
			height: 100%;
			max-height: none;
			overscroll-behavior-y: contain;
		}
		.proposal-body[data-auxiliary='true'] .points-form {
			flex: 0 0 auto;
		}
		.proposal-body[data-auxiliary='true'] .points-form :global([data-slot='tabs']) {
			height: auto;
			grid-template-rows: auto auto;
		}
		.proposal-body[data-auxiliary='true'] .criteria-scroll {
			max-height: 24rem;
			height: auto;
		}
		.bottom-summary {
			max-height: 34dvh;
			overflow-y: auto;
			scrollbar-color: var(--border) transparent;
			scrollbar-width: thin;
		}
	}
	@media (max-width: 63.99rem) {
		.criteria-scroll {
			max-height: none;
			overflow: visible;
		}
	}
	@media (pointer: coarse) {
		.proposal-review :global([data-slot='input']),
		.proposal-review :global([data-slot='textarea']),
		.proposal-review :global([data-slot='native-select']) {
			font-size: 1rem;
		}
	}
</style>
