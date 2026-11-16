<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { MediaQuery, SvelteURL } from 'svelte/reactivity';
	import { goto, beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import { z } from 'zod';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { quizDraftSchema } from '#lib/domain/quiz-content.js';
	import { currentAcademicYear } from '#lib/domain/academic-year.js';
	import { quizTeacherProjectionSchema, type QuizSessionCommand } from '#lib/domain/quiz-session.js';
	import {
		confirmQuizRoomCommand,
		quizParticipantLabels,
		quizRoomPageSchema,
		quizRoomCandidatesSchema,
		quizTimeRemaining,
		type QuizRoomCandidate,
		type QuizRoomPage
	} from '#lib/quizzes/teacher-room.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { saveTeaching, TeachingRequestError } from '#lib/teaching/api.js';
	import { formatDurationSeconds } from '#lib/teaching/duration.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import TeacherHeader from '#lib/components/teacher/TeacherHeader.svelte';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { focusFirstInvalidField } from '#lib/client/form-feedback.js';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Play from '@lucide/svelte/icons/play';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';

	let { data }: { data: QuizRoomPage } = $props();
	const initial = untrack(() => data);
	const classLabel = `${initial.context.className}${initial.context.academicYear !== currentAcademicYear(new Date(initial.view.serverNow)) ? ` · ${initial.context.academicYear}` : ''}`;
	const endpoint = `/api/teaching/quiz-rooms/${initial.run.id}`;
	let view = $state.raw(initial.view);
	let serverNow = $state(initial.view.serverNow);
	let clockOffset = initial.view.serverNow - Date.now();
	let connection = $state<'connecting' | 'live' | 'paused'>('connecting');
	let selectedId = $state<string | null>(null);
	let detailOpen = $state(false);
	let detailTrigger: HTMLElement | undefined;
	const wideScreen = new MediaQuery('(min-width: 1280px)');
	let inspectorTop = $state(88);
	const trackHeader = (element: HTMLElement) => {
		const update = () => {
			inspectorTop = Math.ceil(element.getBoundingClientRect().bottom + 8);
		};
		const observer = new ResizeObserver(update);
		observer.observe(element);
		window.addEventListener('scroll', update, { passive: true });
		update();
		return () => {
			observer.disconnect();
			window.removeEventListener('scroll', update);
		};
	};
	let errorMessage = $state('');
	let notice = $state('');
	let pending = $state(false);
	let pendingCommand = $state.raw<QuizSessionCommand | null>(null);
	let blocked = $state(false);
	let refreshing = $state(false);
	let confirmCommand = $state.raw<QuizSessionCommand | null>(null);
	let confirmOpen = $state(false);
	let grades = $state.raw<{ reported: number; conflicts: string[] } | null>(null);
	let retakeOpen = $state(false);
	let candidates = $state.raw<QuizRoomCandidate[]>([]);
	let candidatesLoading = $state(false);
	let candidatesError = $state('');
	let retakeInput = $state.raw<{
		id: string;
		quizId: string;
		expectedQuizRevision: number;
		sourceRunId: string;
		participantIds: string[];
	} | null>(null);
	let allowNavigation = false;
	let socket: WebSocket | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let retryCount = 0;
	const selected = $derived(view.participants.find((participant) => participant.id === selectedId));
	const readyCount = $derived(view.participants.filter((participant) => participant.status === 'lobby').length);
	const completedCount = $derived(
		view.participants.filter((participant) => ['submitted', 'expired', 'closed'].includes(participant.status)).length
	);
	const absentCount = $derived(view.participants.filter((participant) => participant.status === 'absent').length);
	const interruptedCount = $derived(
		view.participants.filter((participant) => participant.status === 'interrupted').length
	);
	const maxDeadline = $derived(
		Math.max(
			0,
			...view.participants
				.filter((participant) => participant.status === 'active')
				.map((participant) => participant.deadlineAt ?? 0)
		)
	);
	const studentPath = resolve('/modules/[contextId]/quiz/[runId]', {
		contextId: initial.context.publicContextId,
		runId: initial.run.id
	});
	const busy = $derived(pending || !!pendingCommand || blocked);
	const showDetail = (participantId: string, trigger: EventTarget | null) => {
		selectedId = participantId;
		detailTrigger = trigger instanceof HTMLElement ? trigger : undefined;
		detailOpen = true;
	};
	const addTimeSchema = z.strictObject({
		seconds: z.int().min(1, 'Ajoutez au moins une seconde.').max(14400, 'Le supplément est limité à quatre heures.')
	});
	const timeForm = superForm(defaults({ seconds: 60 }, zod4(addTimeSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4Client(addTimeSchema),
		applyAction: 'never',
		invalidateAll: false,
		resetForm: false,
		taintedMessage: false,
		validationMethod: 'submit-only',
		scrollToError: 'off',
		autoFocusOnError: false
	});
	const { form: timeData, errors: timeErrors } = timeForm;
	const retakeSchema = z.strictObject({
		participantIds: z.array(z.uuid()).min(1, 'Sélectionnez au moins un étudiant.')
	});
	const retakeForm = superForm(defaults({ participantIds: [] as string[] }, zod4(retakeSchema)), {
		dataType: 'json',
		validators: zod4Client(retakeSchema),
		applyAction: 'never',
		invalidateAll: false,
		resetForm: false,
		taintedMessage: false,
		validationMethod: 'submit-only',
		scrollToError: 'off',
		autoFocusOnError: false
	});
	const retakeTransport = createFormActionTransport(retakeForm);
	const { form: retakeData, allErrors: retakeAllErrors } = retakeForm;

	const acceptView = (value: unknown) => {
		const next = quizTeacherProjectionSchema.parse(value);
		if (next.id !== initial.run.id) throw new Error('Unexpected quiz room.');
		if (next.revision < view.revision) return;
		view = next;
		clockOffset = next.serverNow - Date.now();
		serverNow = next.serverNow;
	};
	const connect = () => {
		if (stopped) return;
		clearTimeout(reconnectTimer);
		if (socket) {
			socket.onclose = null;
			socket.close();
		}
		connection = 'connecting';
		const url = new SvelteURL(endpoint, window.location.href);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		const current = new WebSocket(url);
		socket = current;
		current.onmessage = (event) => {
			try {
				const message: unknown = JSON.parse(String(event.data));
				const parsed = z.object({ type: z.literal('state'), view: quizTeacherProjectionSchema }).safeParse(message);
				if (!parsed.success) return;
				acceptView(parsed.data.view);
				connection = 'live';
				retryCount = 0;
			} catch {
				current.close();
			}
		};
		current.onclose = () => {
			if (stopped || socket !== current) return;
			connection = 'paused';
			if (retryCount < 5) reconnectTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** retryCount++));
		};
		current.onerror = () => current.close();
	};
	onMount(() => {
		if (initial.view.status === 'closed' && page.url.searchParams.get('nouvelle-salle') === '1') void showNewRoom();
		connect();
		const timer = setInterval(() => {
			serverNow = Date.now() + clockOffset;
		}, 1000);
		return () => {
			stopped = true;
			clearInterval(timer);
			clearTimeout(reconnectTimer);
			socket?.close();
		};
	});
	const refresh = async () => {
		if (refreshing || pending) return;
		refreshing = true;
		errorMessage = '';
		notice = '';
		try {
			const response = await fetch(endpoint, { credentials: 'same-origin' });
			if (!response.ok) throw new Error('Unavailable room.');
			acceptView(quizRoomPageSchema.parse(await response.json()).view);
			blocked = false;
			errorMessage = '';
			notice = 'État de la salle actualisé.';
		} catch {
			errorMessage = 'Actualisation impossible. L’état affiché est conservé ; réessayez.';
		} finally {
			refreshing = false;
		}
	};
	const execute = async (command: QuizSessionCommand) => {
		if (pending) return;
		pending = true;
		pendingCommand = command;
		errorMessage = '';
		notice = '';
		try {
			const result = await saveTeaching(endpoint, command, 'POST', command.requestId, (payload) =>
				confirmQuizRoomCommand(initial.run.id, command, payload)
			);
			acceptView(result.view);
			if (result.grades) grades = result.grades;
			pendingCommand = null;
			notice =
				command.type === 'close' ? 'Quiz clôturé. Le transfert des notes a été vérifié.' : 'Décision enregistrée.';
		} catch (cause) {
			errorMessage = cause instanceof Error ? cause.message : 'Action non confirmée. Réessayez.';
			if (cause instanceof TeachingRequestError && command.type === 'add_time' && cause.fields.seconds)
				timeErrors.set({ seconds: [cause.fields.seconds] });
			if (
				cause instanceof TeachingRequestError &&
				cause.decodedServerError &&
				cause.status >= 400 &&
				cause.status < 500
			) {
				pendingCommand = null;
				blocked = cause.status === 409;
			}
		} finally {
			pending = false;
		}
	};
	const issue = (
		command:
			| Omit<Extract<QuizSessionCommand, { type: 'start' | 'close' }>, 'requestId'>
			| {
					type: 'admit_late' | 'interrupt' | 'remove_lobby' | 'remove_expected';
					participantId: string;
			  }
	) => {
		if (busy) return;
		const input: QuizSessionCommand = { ...command, requestId: crypto.randomUUID() };
		if (['close', 'interrupt', 'remove_expected', 'remove_lobby'].includes(command.type)) {
			confirmCommand = input;
			confirmOpen = true;
		} else void execute(input);
	};
	const addTime = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
		event.preventDefault();
		const element = event.currentTarget;
		if (busy || !selected) return;
		const checked = await timeForm.validateForm({ update: true, focusOnError: false });
		if (!checked.valid) {
			notify('Vérifiez le temps supplémentaire indiqué.', 'error');
			await focusFirstInvalidField(element);
			return;
		}
		await execute({
			type: 'add_time',
			requestId: crypto.randomUUID(),
			participantId: selected.id,
			seconds: checked.data.seconds,
			expectedExtraSeconds: selected.extraSeconds
		});
	};
	const copyLink = async () => {
		errorMessage = '';
		notice = '';
		try {
			await navigator.clipboard.writeText(new URL(studentPath, window.location.origin).href);
			notice = 'Lien étudiant copié.';
		} catch {
			errorMessage = 'Copie impossible. Ouvrez le lien étudiant puis copiez son adresse.';
		}
	};
	const showNewRoom = async () => {
		retakeOpen = true;
		if (retakeInput || candidatesLoading) return;
		candidatesLoading = true;
		candidatesError = '';
		try {
			const response = await fetch(`${endpoint}/candidates`, { credentials: 'same-origin' });
			if (!response.ok) throw new Error('La liste des étudiants est indisponible. Réessayez.');
			candidates = quizRoomCandidatesSchema.parse(await response.json());
			$retakeData.participantIds = $retakeData.participantIds.filter((id) =>
				candidates.some((entry) => entry.id === id)
			);
		} catch {
			candidatesError = 'La liste des étudiants est indisponible. Réessayez.';
		} finally {
			candidatesLoading = false;
		}
	};
	const createRetake = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
		event.preventDefault();
		const element = event.currentTarget;
		if (pending || candidatesLoading || candidatesError) return;
		const checked = await retakeForm.validateForm({ update: true, focusOnError: false });
		if (!checked.valid) {
			notify('Sélectionnez au moins un étudiant.', 'error');
			await focusFirstInvalidField(element);
			return;
		}
		pending = true;
		errorMessage = '';
		try {
			if (!retakeInput) {
				const response = await fetch(`/api/teaching/quizzes/${initial.quiz.id}`, {
					credentials: 'same-origin'
				});
				if (!response.ok) throw new Error('Le quiz est indisponible. Réessayez.');
				const quiz = quizDraftSchema.parse(await response.json());
				if (quiz.id !== initial.quiz.id) throw new Error('Référence du quiz invalide.');
				retakeInput = {
					id: crypto.randomUUID(),
					quizId: quiz.id,
					expectedQuizRevision: quiz.revision,
					sourceRunId: initial.run.id,
					participantIds: [...checked.data.participantIds]
				};
			}
			const opening = retakeInput;
			const result = await retakeTransport.submit(
				resolve('/enseignant/quiz/[runId]', { runId: initial.run.id }) + '?/createRetake',
				opening,
				(payload) => {
					const projected = quizTeacherProjectionSchema.parse(payload);
					if (projected.id !== opening.id) throw new Error('Unexpected retake.');
					return projected;
				}
			);
			retakeInput = null;
			allowNavigation = true;
			notify('Nouvelle salle créée.');
			await goto(resolve('/enseignant/quiz/[runId]', { runId: result.id }));
		} catch (cause) {
			allowNavigation = false;
			errorMessage =
				cause instanceof Error ? cause.message : 'Rattrapage non confirmé. Réessayez avec la même sélection.';
			if (
				cause instanceof TeachingRequestError &&
				cause.decodedServerError &&
				cause.status >= 400 &&
				cause.status < 500
			)
				retakeInput = null;
		} finally {
			pending = false;
		}
	};
	beforeNavigate((navigation) => {
		if (!allowNavigation && (pending || pendingCommand || retakeInput)) navigation.cancel();
	});
</script>

<div
	class="sticky top-0 z-20 hidden xl:block"
	role="region"
	aria-label="Contexte et commandes du quiz"
	{@attach trackHeader}
>
	<TeacherHeader
		parentLink={{
			href: resolve('/enseignant/modules/[moduleId]/quiz', { moduleId: initial.quiz.moduleId }),
			label: 'Quiz du module'
		}}
	>
		{#snippet context()}
			<h1 class="truncate text-2xl leading-tight font-semibold tracking-tight" title={`Quiz : ${view.title}`}>
				Quiz : {view.title}
			</h1>
			<p class="mt-1 max-w-prose text-sm leading-5 text-muted-foreground">
				{classLabel}{initial.run.sourceRunId ? ' · Rattrapage' : ''} · {@render roomProgress()}
			</p>
		{/snippet}
		{#snippet actions()}
			<div class="flex shrink-0 items-center gap-3">
				{@render studentLinks(true)}
				{@render roomClock()}
				{@render primaryAction()}
			</div>
		{/snippet}
	</TeacherHeader>
</div>

<section class="quiz-room flex flex-col gap-4 xl:px-10 xl:py-4">
	<div class="flex flex-col gap-4 xl:hidden">
		<a
			class="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
			href={resolve('/enseignant/modules/[moduleId]/quiz', { moduleId: initial.quiz.moduleId })}
			><ArrowLeft class="size-4" />Quiz du module</a
		>
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0 space-y-2">
				<h1 class="page-title break-words">Quiz : {view.title}</h1>
				<p class="text-sm text-muted-foreground">
					{classLabel}{initial.run.sourceRunId ? ' · Rattrapage' : ''}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-3">
				{@render roomClock()}{@render primaryAction()}
			</div>
		</div>
		<div class="flex flex-wrap items-center justify-between gap-3 border-y py-3 text-sm">
			<p class="text-muted-foreground">{@render roomProgress()}</p>
			<div class="flex flex-wrap gap-2">
				{@render studentLinks(false)}
			</div>
		</div>
	</div>
	{#if connection === 'paused' && view.status !== 'closed'}<Alert.Root
			><CircleAlert /><Alert.Title>Le direct est interrompu</Alert.Title><Alert.Description
				>Les réponses déjà confirmées restent enregistrées. L’état affiché peut être ancien.<Button
					variant="outline"
					size="sm"
					class="mt-3"
					onclick={() => {
						retryCount = 0;
						connect();
					}}>Reconnecter le direct</Button
				></Alert.Description
			></Alert.Root
		>{/if}
	{#if errorMessage}<Alert.Root variant="destructive" role="alert"
			><CircleAlert /><Alert.Title>Action à vérifier</Alert.Title><Alert.Description
				><p>{errorMessage}</p>
				<div class="mt-3 flex flex-wrap gap-2">
					{#if pendingCommand}<Button
							variant="outline"
							disabled={pending}
							onclick={() => pendingCommand && execute(pendingCommand)}
							>{#if pending}<Spinner data-icon="inline-start" />{/if}Réessayer la même décision</Button
						>{:else if blocked}<Button variant="outline" disabled={refreshing} onclick={refresh}
							>Actualiser l’état de la salle</Button
						>{/if}
				</div></Alert.Description
			></Alert.Root
		>{/if}
	<ActionNotice message={notice} />
	<ActionNotice message={errorMessage} kind="error" />
	{#if view.status === 'lobby'}<p class="text-sm text-muted-foreground">
			Les étudiants choisissent leur nom puis attendent votre démarrage. Les questions et les réponses seront mélangées
			pour chacun.
		</p>{/if}
	{#if view.status === 'closed'}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm text-muted-foreground">
				{grades
					? `${grades.reported} note${grades.reported > 1 ? 's' : ''} transférée${grades.reported > 1 ? 's' : ''}.`
					: 'Les notes se vérifient dans la grille de notation.'}
			</p>
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					href={`${resolve('/enseignant/notation')}?${new URLSearchParams({ module: initial.quiz.moduleId, contexte: initial.run.contextId })}` as ResolvedPathname}
					>Vérifier les notes</Button
				><Button disabled={busy} onclick={showNewRoom}>Nouvelle salle</Button>
			</div>
		</div>
		{#if grades?.conflicts.length}<Alert.Root variant="destructive"
				><CircleAlert /><Alert.Title
					>{grades.conflicts.length} note{grades.conflicts.length > 1 ? 's' : ''} à vérifier</Alert.Title
				><Alert.Description
					>Une note a été modifiée séparément. La valeur existante est conservée : {view.participants
						.filter((entry) => grades?.conflicts.includes(entry.id))
						.map((entry) => entry.name)
						.join(', ')}. Vérifiez la grille avant de corriger.</Alert.Description
				></Alert.Root
			>{/if}
	{/if}
	<PrivacyNotice>
		Les noms, réponses, horaires et signalements servent au suivi et à l’évaluation du quiz. Les changements de fenêtre
		et sorties du plein écran ne prouvent pas, à eux seuls, une fraude.
	</PrivacyNotice>
	<div class="overflow-hidden rounded-xl bg-card">
		<Table.Root
			><Table.Caption class="sr-only">Suivi individuel du quiz {view.title}</Table.Caption><Table.Header
				><Table.Row
					><Table.Head>Étudiant</Table.Head><Table.Head>État</Table.Head><Table.Head class="hidden sm:table-cell"
						>Progression</Table.Head
					><Table.Head class="hidden md:table-cell">{view.status === 'closed' ? 'Points' : 'Temps restant'}</Table.Head
					><Table.Head class="text-right"><span class="sr-only">Détail</span></Table.Head></Table.Row
				></Table.Header
			><Table.Body>
				{#each view.participants as participant (participant.id)}<Table.Row
						data-state={selectedId === participant.id && detailOpen ? 'selected' : undefined}
						><Table.Cell class="max-w-72 whitespace-normal"
							><button
								type="button"
								class="inline-flex min-h-11 min-w-11 items-center rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
								aria-label={`Sélectionner ${participant.name}`}
								onclick={(event) => showDetail(participant.id, event.currentTarget)}>{participant.name}</button
							><span class="mt-1 block text-xs text-muted-foreground"
								>{participant.connected ? 'Connecté' : 'Déconnecté'}</span
							><span class="mt-1 block text-xs text-muted-foreground tabular-nums sm:hidden"
								>{participant.answeredCount} / {view.maxPoints} réponses</span
							><span class="mt-1 block text-xs text-muted-foreground tabular-nums md:hidden"
								>{view.status === 'closed'
									? `${participant.points ?? 'N/D'} / ${view.maxPoints} points`
									: quizTimeRemaining(participant.deadlineAt, serverNow, participant.status, view.status)}</span
							></Table.Cell
						><Table.Cell
							><Badge
								class="max-w-28 whitespace-normal"
								variant={participant.status === 'active' ? 'default' : 'secondary'}
								>{quizParticipantLabels[participant.status]}</Badge
							>{#if participant.incidents.focus + participant.incidents.fullscreen > 0}<span
									class="mt-1 block text-xs text-muted-foreground"
									>{participant.incidents.focus + participant.incidents.fullscreen} signalement{participant.incidents
										.focus +
										participant.incidents.fullscreen >
									1
										? 's'
										: ''}</span
								>{/if}</Table.Cell
						><Table.Cell class="hidden tabular-nums sm:table-cell"
							><span>{participant.answeredCount} / {view.maxPoints}</span>
							<div class="mt-2 h-1.5 w-20 overflow-hidden rounded-control bg-muted" aria-hidden="true">
								<div
									class="h-full bg-primary"
									style:width={`${(100 * participant.answeredCount) / view.maxPoints}%`}
								></div>
							</div></Table.Cell
						><Table.Cell class="hidden tabular-nums md:table-cell"
							>{view.status === 'closed'
								? `${participant.points ?? 'N/D'} / ${view.maxPoints}`
								: quizTimeRemaining(participant.deadlineAt, serverNow, participant.status, view.status)}</Table.Cell
						><Table.Cell class="text-right"
							><Button
								variant="ghost"
								size="sm"
								aria-label={`Voir le détail de ${participant.name}`}
								onclick={(event) => showDetail(participant.id, event.currentTarget)}
								><span class="sm:hidden">Détail</span><span class="hidden sm:inline">Voir le détail</span></Button
							></Table.Cell
						></Table.Row
					>{/each}
				{#if !view.participants.length}<Table.Row
						><Table.Cell colspan={5} class="py-12 text-center text-muted-foreground"
							>Aucun étudiant attendu. Vérifiez la liste de la classe.</Table.Cell
						></Table.Row
					>{/if}
			</Table.Body></Table.Root
		>
	</div>
</section>

<Sheet.Root bind:open={detailOpen}
	><Sheet.Content
		modal={!wideScreen.current}
		interactOutsideBehavior={wideScreen.current ? 'ignore' : 'close'}
		onCloseAutoFocus={(event) => {
			event.preventDefault();
			detailTrigger?.focus({ preventScroll: true });
		}}
		class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg data-[side=right]:xl:rounded-xl data-[side=right]:xl:border"
		style={wideScreen.current
			? `top: ${inspectorTop}px; right: 1rem; bottom: auto; width: 24rem; height: auto; max-height: calc(100dvh - ${inspectorTop + 16}px);`
			: undefined}
		><Sheet.Header
			><Sheet.Title class="pr-12 text-xl font-semibold">{selected?.name ?? 'Étudiant retiré'}</Sheet.Title
			><Sheet.Description
				>{selected
					? quizParticipantLabels[selected.status]
					: 'Cet étudiant ne fait plus partie de la salle.'}</Sheet.Description
			></Sheet.Header
		>
		{#if selected}<div class="flex flex-col gap-4 px-6 pb-6">
				{@render roomFeedback()}
				<div class="flex flex-col gap-3">
					<p class="text-sm font-medium">Progression actuelle</p>
					<p class="text-sm text-muted-foreground">
						<strong class="text-lg font-semibold text-foreground tabular-nums"
							>{selected.answeredCount} / {view.maxPoints}</strong
						> réponses enregistrées
					</p>
					<div
						class="h-2 w-full overflow-hidden rounded-control bg-muted"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={view.maxPoints}
						aria-valuenow={selected.answeredCount}
						aria-label="Réponses enregistrées"
					>
						<div
							class="h-full rounded-control bg-primary"
							style:width={`${(100 * selected.answeredCount) / view.maxPoints}%`}
						></div>
					</div>
				</div>
				<dl class="grid grid-cols-2 gap-5 text-sm">
					<div>
						<dt class="text-muted-foreground">Temps restant</dt>
						<dd class="mt-1 font-medium tabular-nums">
							{quizTimeRemaining(selected.deadlineAt, serverNow, selected.status, view.status)}
						</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Temps ajouté</dt>
						<dd class="mt-1 tabular-nums">{formatDurationSeconds(selected.extraSeconds)}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Sorties de plein écran</dt>
						<dd class="mt-1 tabular-nums">{selected.incidents.fullscreen}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Pertes de focus</dt>
						<dd class="mt-1 tabular-nums">{selected.incidents.focus}</dd>
					</div>
				</dl>
				<p class="text-xs leading-relaxed text-muted-foreground">
					Ces signalements indiquent un changement de fenêtre ou de plein écran. Ils ne prouvent pas, à eux seuls, une
					triche.
				</p>
				{#if view.status !== 'closed' && ['not_joined', 'lobby', 'awaiting_admission', 'active'].includes(selected.status)}<form
						method="POST"
						onsubmit={addTime}
						novalidate
						class="flex flex-col gap-2"
					>
						<Form.Field form={timeForm} name="seconds"
							><Form.Control
								>{#snippet children({ props })}<Form.Label>Temps supplémentaire</Form.Label><Input
										{...props}
										type="number"
										min={1}
										max={14400}
										step={1}
										bind:value={$timeData.seconds}
										onblur={() => timeForm.validate('seconds', { update: 'errors' })}
										disabled={busy}
									/>{/snippet}</Form.Control
							><Form.Description
								>En secondes. À ajouter : {formatDurationSeconds($timeData.seconds)}. Déjà accordé : {formatDurationSeconds(
									selected.extraSeconds
								)}.</Form.Description
							><Form.FieldErrors /></Form.Field
						><Button type="submit" class="w-full" disabled={busy}
							><Clock data-icon="inline-start" />Ajouter du temps</Button
						>
					</form>{/if}
				{#if view.status !== 'closed'}<Separator />{/if}
				<div class="flex flex-col items-start gap-3">
					{#if view.status === 'running' && selected.status === 'awaiting_admission'}<p
							class="text-sm text-muted-foreground"
						>
							L’étudiant reçoit le temps restant de la classe. Vous pouvez ensuite lui accorder un supplément.
						</p>
						<Button
							disabled={busy}
							onclick={() => selected && issue({ type: 'admit_late', participantId: selected.id })}
							>Admettre cet étudiant</Button
						>{/if}
					{#if selected.status === 'lobby' || selected.status === 'awaiting_admission'}<Button
							variant="outline"
							disabled={busy}
							onclick={() => selected && issue({ type: 'remove_lobby', participantId: selected.id })}
							>Libérer cette identité</Button
						>{/if}
					{#if view.status === 'running' && ['active', 'expired', 'submitted'].includes(selected.status)}<Button
							variant="destructive"
							disabled={busy}
							onclick={() => selected && issue({ type: 'interrupt', participantId: selected.id })}
							>Interrompre avec zéro</Button
						>{/if}
					{#if view.status === 'running'}<Button
							variant="outline"
							disabled={busy}
							onclick={() => selected && issue({ type: 'remove_expected', participantId: selected.id })}
							>Retirer de la liste attendue</Button
						>{/if}
				</div>
			</div>{/if}
	</Sheet.Content></Sheet.Root
>

<AlertDialog.Root bind:open={confirmOpen}
	><AlertDialog.Content
		><AlertDialog.Header
			><AlertDialog.Title
				>{confirmCommand?.type === 'close'
					? 'Clôturer ce quiz ?'
					: confirmCommand?.type === 'interrupt'
						? 'Interrompre avec zéro point ?'
						: confirmCommand?.type === 'remove_lobby'
							? 'Libérer cette identité ?'
							: 'Retirer cet étudiant de la salle ?'}</AlertDialog.Title
			><AlertDialog.Description
				>{confirmCommand?.type === 'close'
					? 'Les réponses confirmées sont notées, les absents reçoivent zéro et les notes sont transférées vers la grille. Les étudiants encore actifs ne pourront plus répondre.'
					: confirmCommand?.type === 'interrupt'
						? 'La tentative est arrêtée avec zéro point. Cette décision sera reportée à la clôture.'
						: confirmCommand?.type === 'remove_lobby'
							? 'L’accès actuel est révoqué. L’étudiant pourra reprendre son identité depuis le lien du quiz.'
							: 'Cet étudiant sort de la cohorte à noter. Aucun zéro d’absence ne sera créé pour lui.'}</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel>Annuler</AlertDialog.Cancel><AlertDialog.Action
				disabled={busy}
				onclick={() => {
					if (!confirmCommand || busy) return;
					const command = confirmCommand;
					confirmOpen = false;
					confirmCommand = null;
					void execute(command);
				}}>Confirmer</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

<Sheet.Root bind:open={retakeOpen}
	><Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
		><Sheet.Header
			><Sheet.Title>Nouvelle salle</Sheet.Title><Sheet.Description
				>Choisissez les étudiants sans note sur ce quiz ou les absents à rattraper. La nouvelle salle utilise le même
				quiz. Les notes déjà obtenues ou modifiées manuellement sont conservées.</Sheet.Description
			></Sheet.Header
		>
		<form
			method="POST"
			class="space-y-5 px-4 pb-6"
			use:retakeTransport.enhance
			onsubmit={retakeTransport.handleSubmit(createRetake)}
			novalidate
		>
			{@render roomFeedback()}
			{#if candidatesLoading}<p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
					<Spinner />Chargement des étudiants…
				</p>{:else if candidatesError}<Alert.Root variant="destructive" role="alert">
					<CircleAlert /><Alert.Title>Liste indisponible</Alert.Title><Alert.Description>
						<p>{candidatesError}</p>
						<Button variant="outline" type="button" onclick={showNewRoom}>Réessayer</Button>
					</Alert.Description>
				</Alert.Root>{:else if !candidates.length}<p role="status" class="text-sm text-muted-foreground">
					Aucun étudiant à convoquer pour ce quiz. Les notes déjà obtenues sont conservées.
				</p>{/if}
			<Form.Fieldset form={retakeForm} name="participantIds"
				><Form.Legend>Étudiants à convoquer</Form.Legend>
				{#each ['ungraded', 'absence'] as kind (kind)}
					{@const entries = candidates.filter((entry) => entry.kind === kind)}
					{#if entries.length && !candidatesLoading && !candidatesError}<Field.FieldSet class="gap-2">
							<Field.FieldLegend variant="label">
								{kind === 'ungraded' ? 'Sans note' : 'Absents à rattraper'} · {entries.length}
							</Field.FieldLegend>
							<Field.FieldGroup class="gap-2">
								{#each entries as participant (participant.id)}<Field.Field
										orientation="horizontal"
										data-invalid={$retakeAllErrors.length > 0 || undefined}
										data-disabled={pending || !!retakeInput || undefined}
										><Checkbox
											id={`retake-${participant.id}`}
											aria-invalid={$retakeAllErrors.length > 0 || undefined}
											aria-describedby="retake-participant-errors"
											disabled={pending || !!retakeInput}
											checked={$retakeData.participantIds.includes(participant.id)}
											onCheckedChange={(checked) => {
												$retakeData.participantIds = checked
													? [...$retakeData.participantIds, participant.id]
													: $retakeData.participantIds.filter((id) => id !== participant.id);
												void retakeForm.validateForm({ update: true, focusOnError: false });
											}}
										/><Field.FieldLabel for={`retake-${participant.id}`}>{participant.name}</Field.FieldLabel
										></Field.Field
									>{/each}
							</Field.FieldGroup>
						</Field.FieldSet>{/if}
				{/each}
				<Form.FieldErrors id="retake-participant-errors" /></Form.Fieldset
			><Button type="submit" disabled={pending || candidatesLoading || !!candidatesError || !candidates.length}
				>{#if pending}<Spinner data-icon="inline-start" />{/if}{retakeInput
					? 'Réessayer la création de cette salle'
					: 'Créer la salle'}</Button
			>
		</form></Sheet.Content
	></Sheet.Root
>

{#snippet roomClock()}
	{#if view.status === 'running'}
		<span class="text-xl font-semibold tabular-nums" aria-label="Temps restant maximal"
			>{quizTimeRemaining(maxDeadline || null, serverNow, 'active', view.status)}</span
		>
	{/if}
{/snippet}

{#snippet primaryAction()}
	{#if view.status === 'lobby'}
		<Button disabled={busy || view.participants.length === 0} onclick={() => issue({ type: 'start' })}
			><Play data-icon="inline-start" />Démarrer le quiz</Button
		>
	{:else if view.status === 'running'}
		<Button disabled={busy} onclick={() => issue({ type: 'close' })}>Clôturer le quiz</Button>
	{:else}<Badge variant="secondary">Quiz clôturé</Badge>{/if}
{/snippet}

{#snippet studentLinks(compact: boolean)}
	<Button
		variant={compact ? 'ghost' : 'outline'}
		size={compact ? 'icon' : 'sm'}
		title={compact ? 'Copier le lien étudiant' : undefined}
		onclick={copyLink}
		><Copy data-icon="inline-start" /><span class={compact ? 'sr-only' : undefined}>Copier le lien étudiant</span
		></Button
	><Button
		variant="ghost"
		size={compact ? 'icon' : 'sm'}
		title={compact ? 'Ouvrir le quiz étudiant · nouvel onglet' : undefined}
		href={studentPath}
		target="_blank"
		rel="noopener noreferrer"
		aria-label="Ouvrir le quiz étudiant · nouvel onglet"
		><ExternalLink data-icon="inline-start" /><span class={compact ? 'sr-only' : undefined}>Ouvrir</span></Button
	>
{/snippet}

{#snippet roomProgress()}
	{#if view.status === 'closed'}
		<span role="status" aria-label="Bilan du quiz">
			{completedCount} copie{completedCount > 1 ? 's' : ''} terminée{completedCount > 1 ? 's' : ''} ·
			{absentCount}
			absent{absentCount > 1 ? 's' : ''}{#if interruptedCount}
				· {interruptedCount} tentative{interruptedCount > 1 ? 's' : ''}
				interrompue{interruptedCount > 1 ? 's' : ''}{/if}
		</span>
	{:else}
		{view.status === 'lobby'
			? `${readyCount} prêt${readyCount > 1 ? 's' : ''}`
			: `${completedCount} copie${completedCount > 1 ? 's' : ''} terminée${completedCount > 1 ? 's' : ''}`}
		sur {view.participants.length} · {view.maxPoints} question{view.maxPoints > 1 ? 's' : ''} · {connection === 'live'
			? 'En direct'
			: connection === 'connecting'
				? 'Connexion…'
				: 'Direct interrompu'}
	{/if}
{/snippet}

{#snippet roomFeedback()}
	{#if errorMessage}<Alert.Root variant="destructive" role="alert"
			><CircleAlert /><Alert.Title>Action à vérifier</Alert.Title><Alert.Description
				><p>{errorMessage}</p>
				{#if pendingCommand}<Button
						variant="outline"
						class="mt-3"
						disabled={pending}
						onclick={() => pendingCommand && execute(pendingCommand)}>Réessayer la même décision</Button
					>{:else if blocked}<Button variant="outline" class="mt-3" disabled={refreshing} onclick={refresh}
						>Actualiser l’état de la salle</Button
					>{/if}</Alert.Description
			></Alert.Root
		>{/if}
{/snippet}
