<script lang="ts">
	import { isQuizSocketHeartbeat, startQuizSocketHeartbeat } from '#lib/quizzes/socket-heartbeat.js';
	import CodeBlock from '#lib/components/shared/CodeBlock.svelte';
	import { flushSync, onMount, tick } from 'svelte';
	import { SvelteSet, SvelteURL } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { z } from 'zod';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { focusFirstInvalidField } from '#lib/client/form-feedback.js';
	import { formatDurationSeconds } from '#lib/teaching/duration.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ExpandIcon from '@lucide/svelte/icons/expand';
	import ListIcon from '@lucide/svelte/icons/list';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import QuizPersonalReview from './QuizPersonalReview.svelte';
	import {
		canReportQuizIncident,
		type QuizParticipantProjection,
		type QuizSessionCommand,
		type QuizSessionReview
	} from '#lib/domain/quiz-session.js';
	import {
		createQuizAnswerDraft,
		joinQuizRoom,
		prepareQuizAnswerSave,
		quizAnswersAreSaved,
		readQuizRoom,
		readQuizSocketMessage,
		reconcileQuizAnswers,
		remainingQuizSeconds,
		setQuizAnswer,
		type QuizAnswerDraft,
		type StudentQuizRoom
	} from '#lib/quizzes/student-client.js';

	let { contextId, runId }: { contextId: string; runId: string } = $props();
	const endpoint = $derived(`/api/quizzes/${contextId}/rooms/${runId}`);
	let room = $state.raw<StudentQuizRoom | null>(null);
	let view = $state.raw<QuizParticipantProjection | null>(null);
	let draft = $state.raw<QuizAnswerDraft | null>(null);
	let review = $state.raw<QuizSessionReview | null>(null);
	const joinSchema = z.strictObject({
		participantId: z.uuid('Sélectionnez votre prénom et nom.')
	});
	const joinForm = superForm(defaults({ participantId: '' }, zod4Client(joinSchema)), {
		SPA: true,
		validators: zod4Client(joinSchema),
		applyAction: 'never',
		invalidateAll: false,
		resetForm: false,
		taintedMessage: false,
		validationMethod: 'submit-only'
	});
	const { form: joinData } = joinForm;
	let loading = $state(true);
	let joining = $state(false);
	let problem = $state('');
	let protocolProblem = $state('');
	const displayedProblem = $derived(problem || protocolProblem);
	let connected = $state(false);
	let connecting = $state(false);
	let fullscreen = $state(false);
	let fullscreenSupported = $state(false);
	let questionIndex = $state(0);
	let overviewOpen = $state(false);
	let summaryOpen = $state(false);
	let confirmSubmit = $state(false);
	let submitDialog = $state<HTMLDivElement | null>(null);
	let submitting = $state(false);
	let now = $state(0);
	let receivedAt = $state(0);
	let socket: WebSocket | null = null;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let reconnectAttempt = 0;
	let disposed = false;
	let reviewRequested = $state(false);
	let lastFocusReport = -Infinity;
	let reportedFullscreenExit = false;
	let lastAnswerSent: string | null = null;
	let pendingSubmit: Extract<QuizSessionCommand, { type: 'submit' }> | null = null;
	const incidentRequests = new SvelteSet<string>();
	const question = $derived(view?.questions[questionIndex]);
	const remaining = $derived(
		view ? remainingQuizSeconds(view.participant.deadlineAt, view.serverNow, receivedAt, now) : null
	);
	const active = $derived(view?.status === 'running' && view.participant.status === 'active');
	const monitored = $derived(view !== null && canReportQuizIncident(view.status, view.participant.status));
	const canAnswer = $derived(active && remaining !== 0 && !submitting && !draft?.conflict);
	const saved = $derived(!protocolProblem && draft !== null && quizAnswersAreSaved(draft));
	const answeredCount = $derived(draft?.answers.filter((answer) => answer.optionIds.length).length ?? 0);
	const unansweredQuestions = $derived(
		view?.questions.flatMap((item, index) =>
			draft?.answers.some((answer) => answer.questionId === item.id && answer.optionIds.length)
				? []
				: [{ id: item.id, index }]
		) ?? []
	);
	const timerText = $derived(formatDurationSeconds(remaining));
	const participantStatus = $derived(view?.participant.status);
	const lifecycle = $derived(
		view?.status === 'closed' ? 'closed' : active && remaining === 0 ? 'expired' : (participantStatus ?? null)
	);
	const lifecycleTitle = $derived(
		lifecycle === 'expired'
			? 'Le temps est écoulé'
			: lifecycle === 'interrupted'
				? 'Votre quiz a été arrêté'
				: lifecycle === 'submitted'
					? 'Vos réponses sont remises'
					: lifecycle === 'closed'
						? 'Quiz clôturé'
						: 'Votre participation est terminée'
	);
	const lifecycleAnnouncement = $derived(
		lifecycle === 'active'
			? 'Le quiz a commencé. Vous pouvez répondre aux questions.'
			: lifecycle === null || lifecycle === 'lobby' || lifecycle === 'awaiting_admission'
				? ''
				: lifecycleTitle
	);
	const focusLifecycle = async () => {
		await tick();
		if (disposed) return;
		const heading = review
			? 'quiz-review-title'
			: lifecycle === 'active'
				? summaryOpen
					? 'quiz-summary-title'
					: 'quiz-question-title'
				: 'quiz-lifecycle-title';
		document.getElementById(heading)?.focus({ preventScroll: true });
	};
	const updateLifecycleFocus = async (previous: typeof lifecycle, focusedElement: Element | null) => {
		if (!previous) return;
		if (previous === lifecycle) {
			if (focusedElement?.id === 'quiz-lifecycle-title') {
				await tick();
				if (!focusedElement.isConnected) await focusLifecycle();
			}
			return;
		}
		if (lifecycle === 'active') {
			if (previous === 'lobby' || previous === 'awaiting_admission') {
				questionIndex = 0;
				summaryOpen = false;
				await focusLifecycle();
			} else {
				await tick();
				if (!focusedElement?.isConnected) await focusLifecycle();
			}
			return;
		}
		if (!lifecycle || lifecycle === 'lobby' || lifecycle === 'awaiting_admission') return;
		const closingOverlay = overviewOpen || confirmSubmit;
		overviewOpen = false;
		confirmSubmit = false;
		await tick();
		if (closingOverlay || !focusedElement?.isConnected || focusedElement === document.body) await focusLifecycle();
	};

	const send = (command: QuizSessionCommand) => {
		if (socket?.readyState !== WebSocket.OPEN) return false;
		socket.send(JSON.stringify(command));
		return true;
	};
	const flushAnswers = () => {
		if (!draft || !connected || !active || remaining === 0 || draft.conflict) return;
		draft = prepareQuizAnswerSave(draft, crypto.randomUUID());
		if (draft.pending && lastAnswerSent !== draft.pending.requestId && send(draft.pending))
			lastAnswerSent = draft.pending.requestId;
	};
	const receive = (raw: string) => {
		const message = readQuizSocketMessage(raw);
		if (!message) {
			protocolProblem =
				'La réponse du serveur est illisible. Conservez cet écran et prévenez l’enseignant ; la sauvegarde de vos derniers choix n’est pas confirmée.';
			return;
		}
		if (message.type === 'error') {
			if (message.requestId && incidentRequests.delete(message.requestId)) return;
			if (message.code === 'review_unavailable') {
				problem = 'La correction personnelle n’est plus disponible sur cette connexion.';
			} else if (['credentials_conflict', 'connection_conflict', 'forbidden'].includes(message.code)) {
				disposed = true;
				socket?.close();
				problem = 'Cet accès a été retiré ou ouvert ailleurs. Prévenez l’enseignant.';
			} else {
				submitting = false;
				pendingSubmit = null;
				problem = 'Le serveur a refusé cette action. Vos choix sont conservés ; prévenez l’enseignant.';
			}
			return;
		}
		if (view && message.view.revision < view.revision) return;
		const previousLifecycle = lifecycle;
		const focusedElement = document.activeElement;
		protocolProblem = '';
		view = message.view;
		receivedAt = performance.now();
		now = receivedAt;
		connected = true;
		connecting = false;
		reconnectAttempt = 0;
		if (view.status === 'closed') {
			draft = null;
			summaryOpen = false;
			confirmSubmit = false;
			submitting = false;
			pendingSubmit = null;
		} else {
			draft = reconcileQuizAnswers(
				draft ?? createQuizAnswerDraft(),
				view.participant.answerVersion,
				view.participant.answers
			);
			if (draft.conflict)
				problem =
					'Les réponses enregistrées ont changé sur une autre connexion. Vos choix sont conservés ; prévenez l’enseignant.';
		}
		if (message.type === 'ack') {
			incidentRequests.delete(message.receipt.requestId);
			if (message.review) {
				review = message.review;
				void focusReview();
			}
			if (message.receipt.type === 'submit') {
				if (message.receipt.requestId === pendingSubmit?.requestId) notify('Vos réponses sont remises.');
				submitting = false;
				pendingSubmit = null;
			}
		}
		if (view.participant.status !== 'active') {
			summaryOpen = false;
			confirmSubmit = false;
			submitting = false;
			pendingSubmit = null;
		} else if (pendingSubmit && connected) send(pendingSubmit);
		if (view.reviewAvailable && !reviewRequested && !review) {
			reviewRequested = true;
			send({ type: 'consume_review', requestId: crypto.randomUUID() });
		}
		flushAnswers();
		reportFullscreenExit();
		void updateLifecycleFocus(previousLifecycle, focusedElement);
	};
	const focusReview = async () => {
		await tick();
		document.getElementById('quiz-review-title')?.focus({ preventScroll: true });
	};
	let stopHeartbeat: (() => void) | undefined;
	const connect = () => {
		if (
			disposed ||
			!room?.joined ||
			view?.status === 'closed' ||
			socket?.readyState === WebSocket.OPEN ||
			socket?.readyState === WebSocket.CONNECTING
		)
			return;
		clearTimeout(retry);
		lastAnswerSent = null;
		connecting = true;
		const url = new SvelteURL(endpoint, window.location.origin);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		stopHeartbeat?.();
		const current = new WebSocket(url);
		socket = current;
		current.onmessage = (event) => {
			if (isQuizSocketHeartbeat(event.data)) return;
			if (socket === current && !disposed && typeof event.data === 'string') receive(event.data);
		};
		const interrupted = (code: number, reason = '') => {
			if (socket !== current) return;
			socket = null;
			connected = false;
			connecting = false;
			if (disposed || view?.status === 'closed') return;
			if (code === 1008 || reconnectAttempt >= 5) {
				problem =
					code === 1008 && reason === 'Connection replaced'
						? 'Ce quiz a été ouvert dans un autre onglet. Continuez dans cet autre onglet ou réessayez ici pour reprendre.'
						: 'La connexion à la salle est interrompue. Réessayez ou prévenez l’enseignant.';
				return;
			}
			retry = setTimeout(connect, Math.min(1000 * 2 ** reconnectAttempt++, 5000));
		};
		current.onclose = (event) => interrupted(event.code, event.reason);
		stopHeartbeat = startQuizSocketHeartbeat(current, () => interrupted(3001));
	};
	const loadRoom = async () => {
		loading = true;
		problem = '';
		try {
			const loaded = await readQuizRoom(endpoint);
			if (disposed) return;
			room = loaded;
			if (loaded.preparedParticipantId) $joinData.participantId = loaded.preparedParticipantId;
			if (loaded.joined) connect();
		} catch (cause) {
			if (!disposed) problem = cause instanceof Error ? cause.message : 'La salle est indisponible. Réessayez.';
		} finally {
			if (!disposed) loading = false;
		}
	};
	const enterFullscreen = async () => {
		if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen)
			throw new Error(
				'Ce navigateur ne permet pas le plein écran nécessaire au quiz. Utilisez un ordinateur compatible et prévenez l’enseignant.'
			);
		if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
		fullscreen = !!document.fullscreenElement;
		if (!fullscreen) throw new Error('Le plein écran n’a pas été activé. Autorisez-le pour rejoindre la salle.');
	};
	const join = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
		event.preventDefault();
		if (joining) return;
		const element = event.currentTarget;
		const validated = await joinForm.validateForm({ update: true, focusOnError: false });
		if (!validated.valid) {
			notify('Sélectionnez votre prénom et nom.', 'error');
			await focusFirstInvalidField(element);
			return;
		}
		joining = true;
		problem = '';
		try {
			if (fullscreenSupported) await enterFullscreen();
			await joinQuizRoom(endpoint, validated.data.participantId, fullscreen);
			if (!disposed) {
				notify('Vous avez rejoint la salle.');
				room = room ? { ...room, joined: true } : null;
				connect();
			}
		} catch (cause) {
			problem = cause instanceof Error ? cause.message : 'Impossible de rejoindre la salle. Réessayez.';
		} finally {
			joining = false;
		}
	};
	const restoreFullscreen = async () => {
		problem = '';
		try {
			await enterFullscreen();
		} catch (cause) {
			problem = cause instanceof Error ? cause.message : 'Réactivez le plein écran.';
		}
	};
	const choose = (optionId: string, checked: boolean) => {
		if (!question || !draft || !canAnswer) return;
		const current = draft.answers.find((answer) => answer.questionId === question.id)?.optionIds ?? [];
		const selected =
			question.type === 'multiple'
				? checked
					? [...new Set([...current, optionId])]
					: current.filter((id) => id !== optionId)
				: [optionId];
		draft = setQuizAnswer(draft, question.id, selected);
		flushAnswers();
	};
	const navigateQuestion = async (index: number) => {
		questionIndex = index;
		overviewOpen = false;
		summaryOpen = false;
		await tick();
		const heading = document.getElementById('quiz-question-title');
		heading?.focus({ preventScroll: true });
		heading?.scrollIntoView({ block: 'start' });
	};
	const showSummary = async () => {
		summaryOpen = true;
		overviewOpen = false;
		await focusLifecycle();
		document.getElementById('quiz-summary-title')?.scrollIntoView({ block: 'start' });
	};
	const submit = () => {
		if (!draft || !saved || !connected || !canAnswer) return;
		problem = '';
		pendingSubmit = {
			type: 'submit',
			requestId: crypto.randomUUID(),
			answerVersion: draft.acknowledgedVersion
		};
		submitting = send(pendingSubmit);
		if (!submitting) pendingSubmit = null;
	};
	const reportIncident = (incident: 'focus' | 'fullscreen') => {
		if (!monitored || !connected || remaining === 0) return false;
		const requestId = crypto.randomUUID();
		if (!send({ type: 'report_incident', requestId, incident })) return false;
		incidentRequests.add(requestId);
		return true;
	};
	const reportFullscreenExit = () => {
		if (!fullscreenSupported || fullscreen || reportedFullscreenExit) return;
		reportedFullscreenExit = reportIncident('fullscreen');
	};
	const reportFocus = () => {
		const at = performance.now();
		if (at - lastFocusReport < 1000) return;
		lastFocusReport = at;
		reportIncident('focus');
	};
	const fullscreenChanged = () => {
		fullscreen = !!document.fullscreenElement;
		if (fullscreen) reportedFullscreenExit = false;
		else reportFullscreenExit();
	};
	const clearSession = () => {
		stopHeartbeat?.();
		disposed = true;
		clearTimeout(retry);
		socket?.close();
		socket = null;
		review = null;
		draft = null;
		summaryOpen = false;
		pendingSubmit = null;
		view = null;
		connected = false;
		incidentRequests.clear();
	};
	const expireReview = () => {
		clearSession();
		// Remove the private review before navigation, even if the destination cannot load offline.
		flushSync();
		window.location.replace(resolve('/modules/[contextId]', { contextId }));
	};
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (active) {
			event.preventDefault();
			event.returnValue = '';
		}
	};
	onMount(() => {
		fullscreenSupported = !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;
		fullscreen = !!document.fullscreenElement;
		void loadRoom();
		const clock = setInterval(() => {
			const previousLifecycle = lifecycle;
			const focusedElement = document.activeElement;
			now = performance.now();
			void updateLifecycleFocus(previousLifecycle, focusedElement);
		}, 500);
		return () => {
			clearInterval(clock);
			clearSession();
		};
	});
</script>

<svelte:window
	onpagehide={clearSession}
	onpageshow={(event) => {
		if (event.persisted) window.location.reload();
	}}
	onblur={reportFocus}
	onbeforeunload={beforeUnload}
	ononline={connect}
/>
<svelte:document
	onfullscreenchange={fullscreenChanged}
	onvisibilitychange={() => {
		if (document.hidden) reportFocus();
	}}
/>

<div class="quiz-student min-w-0">
	<p role="status" aria-label="État du quiz" class="sr-only">{lifecycleAnnouncement}</p>
	<header class="mb-6 border-b pb-5">
		{#if !active}<Button href={resolve('/modules/[contextId]', { contextId })} variant="link" class="mb-3 min-h-11 px-0"
				><ArrowLeftIcon data-icon="inline-start" />Retour au cours</Button
			>{/if}
		<h1 class="page-title wrap-anywhere">
			{view?.title ?? room?.title ?? 'Rejoindre le quiz'}
		</h1>
		{#if view}<p class="mt-2 text-sm text-muted-foreground">{view.participant.name}</p>{/if}
	</header>
	<ActionNotice message={displayedProblem} kind="error" dismissOnClear />
	{#if displayedProblem}<Alert.Root variant="destructive" appearance="inline" class="mb-5"
			><CircleAlertIcon aria-hidden="true" /><Alert.Title
				>{problem ? 'Vérifiez votre accès' : 'Sauvegarde à vérifier'}</Alert.Title
			><Alert.Description>{displayedProblem}</Alert.Description></Alert.Root
		>{/if}
	{#if loading}<p role="status" class="py-8 text-muted-foreground">Ouverture de la salle…</p>
	{:else if !room}<Button variant="outline" onclick={loadRoom}>Réessayer</Button>
	{:else if review}<QuizPersonalReview {review} onexpire={expireReview} />
	{:else if !view && !room.joined && room.status !== 'closed'}
		<section class="mx-auto max-w-xl py-3" aria-labelledby="quiz-join-title">
			<h2 id="quiz-join-title" class="text-lg font-semibold">Choisissez votre nom</h2>
			<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
				L’enseignant vérifiera votre présence avant de vous autoriser à répondre.
			</p>
			{#if !fullscreenSupported}<p class="mt-4 text-sm text-muted-foreground">
					Vous pouvez rejoindre le quiz sans plein écran sur ce navigateur. Gardez cette page ouverte pendant le quiz.
				</p>{/if}
			<form method="POST" class="mt-6 flex flex-col gap-5" onsubmit={join} novalidate aria-busy={joining}>
				<Form.Field form={joinForm} name="participantId">
					<Form.Control id="quiz-student-name">
						{#snippet children({ props })}
							<Form.Label>Votre prénom et nom</Form.Label>
							<NativeSelect.Root
								{...props}
								bind:value={$joinData.participantId}
								onchange={() => joinForm.validate('participantId', { update: 'errors' })}
								required
								disabled={joining}
								class="w-full border"
							>
								<NativeSelect.Option value="">Sélectionner mon nom</NativeSelect.Option>
								{#each room?.roster ?? [] as student (student.id)}
									<NativeSelect.Option value={student.id}>{student.name}</NativeSelect.Option>
								{/each}
							</NativeSelect.Root>
						{/snippet}
					</Form.Control>
					<Form.Description>Si votre nom manque, prévenez l’enseignant.</Form.Description>
					<Form.FieldErrors />
				</Form.Field>
				<PrivacyNotice>
					Votre nom, vos réponses et les horaires de participation sont enregistrés pour ce quiz. Les changements de
					fenêtre, d’onglet ou d’application sont signalés à l’enseignant.
					{#if fullscreenSupported}Les sorties du plein écran sont également signalées.{/if}
					Aucun enregistrement audio, vidéo ou de votre écran n’est effectué.
				</PrivacyNotice>
				<Button type="submit" disabled={joining} class="min-h-11 w-fit">
					{#if fullscreenSupported}<ExpandIcon data-icon="inline-start" />{/if}{joining
						? 'Connexion…'
						: fullscreenSupported
							? 'Passer en plein écran et rejoindre'
							: 'Rejoindre la salle'}
				</Button>
			</form>
		</section>
	{:else if !view && room.status === 'closed'}
		<h2 class="text-lg font-semibold">Ce quiz est clôturé</h2>
		<p class="mt-2 text-muted-foreground">La consultation personnelle n’est plus disponible.</p>
	{:else if !view}
		<p role="status" class="py-8 text-muted-foreground">
			{connecting ? 'Connexion à la salle…' : 'La connexion à la salle est interrompue.'}
		</p>
		{#if !connecting}<Button variant="outline" onclick={connect}>Reprendre la connexion</Button>{/if}
	{:else if view.status === 'closed'}
		<h2 id="quiz-lifecycle-title" tabindex="-1" class="lifecycle-title text-lg font-semibold">{lifecycleTitle}</h2>
		<p role="status" class="mt-2 text-muted-foreground">
			{view.reviewAvailable && reviewRequested
				? 'Ouverture de votre correction…'
				: 'La consultation personnelle n’est plus disponible sur cet accès.'}
		</p>
	{:else if participantStatus === 'lobby' || participantStatus === 'awaiting_admission'}
		<h2 class="text-lg font-semibold">
			{participantStatus === 'lobby' ? 'Vous êtes dans la salle' : 'Admission en attente'}
		</h2>
		<p class="mt-2 text-muted-foreground">
			{participantStatus === 'lobby'
				? 'Gardez cet écran ouvert. L’enseignant va lancer le quiz.'
				: 'L’enseignant doit autoriser votre arrivée avant que vous puissiez répondre.'}
		</p>
		{@render fullscreenWarning()}
	{:else if active}
		<div class="quiz-status mb-5 flex flex-wrap items-center justify-between gap-3 border-b bg-card py-3 text-sm">
			<div>
				<p class="font-medium">
					Temps restant <span
						class="ml-2 font-semibold tabular-nums"
						role="timer"
						aria-label={`Temps restant : ${timerText}`}>{timerText}</span
					>
				</p>
				<p role="status" class="mt-1 text-muted-foreground">
					{!connected
						? 'Connexion interrompue · Vos derniers choix restent sur cet écran'
						: protocolProblem
							? 'Sauvegarde non confirmée · Vos derniers choix restent sur cet écran'
							: saved
								? 'Réponses enregistrées'
								: 'Enregistrement des réponses…'}
				</p>
			</div>
			<Button
				variant="outline"
				class="min-h-11"
				onclick={() => {
					overviewOpen = true;
				}}><ListIcon data-icon="inline-start" />Questions · {answeredCount}/{view.questions.length}</Button
			>
		</div>
		{#if !connected}<div class="mb-5 flex flex-wrap items-center gap-3">
				<p class="text-sm text-destructive">Le temps continue pendant la coupure. Ne rechargez pas la page.</p>
				<Button variant="outline" class="min-h-11" onclick={connect} disabled={connecting}
					>{connecting ? 'Reconnexion…' : 'Reprendre la connexion'}</Button
				>
			</div>{/if}
		{@render fullscreenWarning()}
		{#if remaining === 0}<h2 id="quiz-lifecycle-title" tabindex="-1" class="lifecycle-title text-lg font-semibold">
				{lifecycleTitle}
			</h2>
			<p role="status" class="mt-2 text-muted-foreground">
				Les réponses enregistrées sont figées. Les questions sans réponse valent zéro. Attendez la clôture par
				l’enseignant.
			</p>
		{:else if summaryOpen}
			<section class="mx-auto max-w-3xl min-w-0 py-3" aria-labelledby="quiz-summary-title">
				<h2 id="quiz-summary-title" tabindex="-1" class="question-title text-xl leading-snug font-medium">
					Vérifiez vos réponses
				</h2>
				<p class="mt-4 tabular-nums">
					{answeredCount} question{answeredCount > 1 ? 's' : ''} répondue{answeredCount > 1 ? 's' : ''} sur {view
						.questions.length}.
				</p>
				{#if unansweredQuestions.length}
					<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
						Les questions sans réponse valent zéro. Vous pouvez encore y répondre avant de remettre le quiz.
					</p>
					<nav class="mt-6" aria-label="Questions sans réponse">
						<h3 class="mb-3 font-medium">Questions sans réponse</h3>
						<ol class="flex flex-col gap-2">
							{#each unansweredQuestions as item (item.id)}
								<li>
									<Button
										variant="outline"
										class="min-h-11 w-full justify-between gap-3"
										disabled={submitting}
										onclick={() => navigateQuestion(item.index)}
										><span>Question {item.index + 1}</span><span class="text-xs text-muted-foreground"
											>Sans réponse</span
										></Button
									>
								</li>
							{/each}
						</ol>
					</nav>
				{:else}
					<p class="mt-2 text-sm text-muted-foreground">Vous avez répondu à toutes les questions.</p>
				{/if}
				<div class="mt-8 flex flex-wrap justify-between gap-3 border-t pt-5">
					<Button
						variant="outline"
						class="min-h-11"
						disabled={submitting}
						onclick={() => navigateQuestion(questionIndex)}
						><ArrowLeftIcon data-icon="inline-start" />Revenir aux questions</Button
					>
					<Button
						class="min-h-11"
						disabled={!saved || !connected || !canAnswer}
						onclick={() => {
							confirmSubmit = true;
						}}>{submitting ? 'Remise en cours…' : 'Remettre définitivement'}</Button
					>
				</div>
			</section>
		{:else if question}
			<section class="question-work mx-auto max-w-3xl min-w-0 py-3" aria-labelledby="quiz-question-title">
				<p class="mb-3 text-sm text-muted-foreground">
					Question {questionIndex + 1} sur {view.questions.length} · 1 point
				</p>
				<h2
					id="quiz-question-title"
					tabindex="-1"
					class="question-title text-xl leading-snug font-medium wrap-anywhere whitespace-pre-wrap"
				>
					{question.prompt}
				</h2>
				{#if question.code}
					<div class="my-5">
						<CodeBlock label="Code de la question">{question.code}</CodeBlock>
					</div>{/if}
				<Field.Set class="mt-6 gap-3"
					><Field.Legend class="sr-only"
						>Choisissez {question.type === 'multiple' ? 'les réponses' : 'une réponse'}</Field.Legend
					>
					<Field.Description
						>{question.type === 'multiple'
							? 'Plusieurs réponses possibles. Sélectionnez toutes les bonnes réponses pour obtenir le point.'
							: 'Une seule réponse possible.'}</Field.Description
					>
					{#each question.options as option (option.id)}
						{@const selected =
							draft?.answers.find((answer) => answer.questionId === question.id)?.optionIds.includes(option.id) ??
							false}
						<label
							class={[
								'quiz-choice flex min-h-14 min-w-0 items-start gap-3 rounded-control border bg-card px-4 py-3 has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring',
								{ 'cursor-pointer': canAnswer, 'cursor-not-allowed opacity-60': !canAnswer }
							]}
						>
							<input
								type={question.type === 'multiple' ? 'checkbox' : 'radio'}
								name={`question-${question.id}`}
								value={option.id}
								checked={selected}
								disabled={!canAnswer}
								onchange={(event) => choose(option.id, event.currentTarget.checked)}
								class="mt-1 size-4 shrink-0 accent-primary"
							/>
							<span class="min-w-0 wrap-anywhere whitespace-pre-wrap">{option.text}</span>
						</label>
					{/each}
				</Field.Set>
				{#if draft?.answers.some((answer) => answer.questionId === question.id)}<Button
						variant="ghost"
						class="mt-2 min-h-11"
						disabled={!canAnswer}
						onclick={() => {
							if (draft && question) {
								draft = setQuizAnswer(draft, question.id, []);
								flushAnswers();
							}
						}}>Effacer ma réponse</Button
					>{/if}
				<nav
					class="mt-8 flex flex-wrap justify-between gap-3 border-t pt-5"
					aria-label="Navigation entre les questions"
				>
					<Button
						variant="outline"
						class="min-h-11"
						disabled={questionIndex === 0}
						onclick={() => navigateQuestion(questionIndex - 1)}
						><ArrowLeftIcon data-icon="inline-start" />Précédente</Button
					>
					{#if questionIndex < view.questions.length - 1}<Button
							class="min-h-11"
							onclick={() => navigateQuestion(questionIndex + 1)}
							>Suivante<ArrowRightIcon data-icon="inline-end" /></Button
						>{:else}<Button class="min-h-11" disabled={submitting} onclick={showSummary}
							>Vérifier mes réponses<ArrowRightIcon data-icon="inline-end" /></Button
						>{/if}
				</nav>
			</section>
		{/if}
	{:else}
		<h2 id="quiz-lifecycle-title" tabindex="-1" class="lifecycle-title text-lg font-semibold">{lifecycleTitle}</h2>
		<p class="mt-2 leading-relaxed text-muted-foreground">
			{participantStatus === 'interrupted'
				? 'L’enseignant a arrêté votre participation. La note de ce quiz est zéro.'
				: 'Vous ne pouvez plus modifier vos réponses.'} Gardez cet écran ouvert jusqu’à la clôture par l’enseignant pour consulter
			votre correction.
		</p>
	{/if}
</div>

{#snippet fullscreenWarning()}
	{#if fullscreenSupported && !fullscreen}<Alert.Root class="my-5"
			><Alert.Title>Le plein écran est désactivé</Alert.Title><Alert.Description
				><p>Cette sortie est signalée à l’enseignant.</p>
				<Button variant="outline" class="mt-3 min-h-11" onclick={restoreFullscreen}
					><ExpandIcon data-icon="inline-start" />Revenir en plein écran</Button
				></Alert.Description
			></Alert.Root
		>{/if}
{/snippet}

<Sheet.Root bind:open={overviewOpen}
	><Sheet.Content
		onCloseAutoFocus={(event) => {
			if (lifecycle !== 'active') {
				event.preventDefault();
				void focusLifecycle();
			}
		}}
		class="data-[side=right]:w-full data-[side=right]:sm:max-w-md"
		><Sheet.Header class="pr-16"
			><Sheet.Title>Vos questions</Sheet.Title><Sheet.Description
				>Vous pouvez changer vos réponses jusqu’à la remise définitive ou la fin du temps.</Sheet.Description
			></Sheet.Header
		>
		<nav class="min-h-0 overflow-y-auto px-4 pb-6" aria-label="Toutes les questions">
			<ol class="flex flex-col gap-2">
				{#each view?.questions ?? [] as item, index (item.id)}<li>
						<Button
							variant={index === questionIndex ? 'secondary' : 'ghost'}
							class="min-h-11 w-full justify-between gap-3"
							onclick={() => navigateQuestion(index)}
							aria-current={index === questionIndex ? 'step' : undefined}
							><span>Question {index + 1}</span><span class="text-xs text-muted-foreground"
								>{draft?.answers.some((answer) => answer.questionId === item.id && answer.optionIds.length)
									? 'Répondue'
									: 'Sans réponse'}</span
							></Button
						>
					</li>{/each}
			</ol>
		</nav></Sheet.Content
	></Sheet.Root
>
<AlertDialog.Root bind:open={confirmSubmit}
	><AlertDialog.Content
		bind:ref={submitDialog}
		onOpenAutoFocus={(event) => {
			// Bits UI's delayed autofocus can run after a server-driven close.
			event.preventDefault();
			if (confirmSubmit && submitDialog?.isConnected) submitDialog.focus({ preventScroll: true });
		}}
		onCloseAutoFocus={(event) => {
			if (review || lifecycle !== 'active') {
				event.preventDefault();
				void focusLifecycle();
			}
		}}
		><AlertDialog.Header
			><AlertDialog.Title>Remettre définitivement vos réponses ?</AlertDialog.Title><AlertDialog.Description
				>{answeredCount} question{answeredCount > 1 ? 's' : ''} répondue{answeredCount > 1 ? 's' : ''} sur {view
					?.questions.length ?? 0}. Les questions sans réponse valent zéro. Après la remise, vous ne pourrez plus
				modifier vos choix.</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel disabled={submitting}>Continuer le quiz</AlertDialog.Cancel><AlertDialog.Action
				onclick={submit}
				disabled={!saved || !connected || !canAnswer}
				>{submitting ? 'Remise en cours…' : 'Remettre définitivement'}</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<style>
	.quiz-student {
		padding: 1.25rem 1.25rem max(2rem, env(safe-area-inset-bottom, 0px));
		border-radius: var(--radius-container);
		background: var(--card);
	}
	.quiz-status {
		position: sticky;
		top: 0;
		z-index: 10;
	}
	.question-title {
		scroll-margin-top: 8rem;
	}
	.question-title:focus-visible,
	.lifecycle-title:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 0.5rem;
	}
	.quiz-choice {
		touch-action: manipulation;
	}
	@media (min-width: 48rem) {
		.quiz-student {
			padding: 2rem;
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.quiz-choice:not(:has(input:disabled)):hover {
			background: var(--accent);
		}
	}
</style>
