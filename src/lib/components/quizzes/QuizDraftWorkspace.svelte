<script lang="ts">
	import { notify } from '#lib/client/notifications.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { untrack } from 'svelte';
	import { goto, beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import type { QuizDraft } from '#lib/domain/quiz-content.js';
	import { quizRoomOpenSchema, quizTeacherProjectionSchema } from '#lib/domain/quiz-session.js';
	import type { QuizWorkspaceData } from '#lib/quizzes/teacher-data.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { formatDurationSeconds } from '#lib/teaching/duration.js';
	import QuizDraftEditor from './QuizDraftEditor.svelte';
	import ModulePageNavigation from '#lib/components/teaching/ModulePageNavigation.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Play from '@lucide/svelte/icons/play';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';

	let { data }: { data: QuizWorkspaceData } = $props();
	const roomForm = superForm(
		defaults(
			{
				id: '00000000-0000-4000-8000-000000000000',
				quizId: '00000000-0000-4000-8000-000000000000',
				expectedQuizRevision: 1
			},
			zod4Client(quizRoomOpenSchema)
		),
		{
			id: 'quiz-room-opening',
			dataType: 'json',
			validators: zod4Client(quizRoomOpenSchema),
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false
		}
	);
	const roomTransport = createFormActionTransport(roomForm);
	let quizzes = $state.raw(untrack(() => data.quizzes));
	let contextId = $state(untrack(() => data.selectedContextId));
	let editing = $state(false);
	let initialDraft = $state.raw<QuizDraft | null>(null);
	let editorKey = $state('');
	let pending = $state(false);
	let opening = $state.raw<{ id: string; quizId: string; expectedQuizRevision: number } | null>(null);
	let errorMessage = $state('');
	let allowNavigation = false;
	const currentContexts = $derived(
		data.module.contexts.filter((entry) =>
			data.rubric.contexts.some((label) => label.id === entry.id && label.academicYear === data.academicYear)
		)
	);
	const context = $derived(currentContexts.find((entry) => entry.id === contextId));
	const contextLabel = $derived(data.rubric.contexts.find((entry) => entry.id === context?.id));
	const returnSection = $derived(
		['information', 'preparation', 'resources', 'planning'].includes(page.url.searchParams.get('section') ?? '')
			? page.url.searchParams.get('section')
			: null
	);
	const navigationScope = $derived({
		...(context ? { classe: context.classId, contexte: context.id } : {}),
		...(contextLabel?.academicYear ? { annee: contextLabel.academicYear } : {}),
		...(returnSection ? { section: returnSection } : {})
	});
	const visibleQuizzes = $derived(quizzes.filter((quiz) => quiz.contextId === context?.id));
	const lines = $derived(
		data.rubric.assessments
			.filter((section) => section.kind === 'quiz' && section.purpose === 'graded')
			.flatMap((section) => section.lines)
	);
	const hasFreeLine = $derived(
		lines.some((line) => !quizzes.some((quiz) => quiz.contextId === contextId && quiz.lineId === line.id))
	);
	const canCreate = $derived(!!context?.lessons.length && hasFreeLine && !data.module.paused);
	const rubricPath = $derived(
		`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId: data.module.id })}?${new URLSearchParams({ ...navigationScope, retour: 'module' })}` as ResolvedPathname
	);
	const edit = (draft: QuizDraft | null) => {
		initialDraft = draft;
		editorKey = draft?.id ?? crypto.randomUUID();
		editing = true;
	};
	const saved = (draft: QuizDraft) => {
		quizzes = quizzes.some((entry) => entry.id === draft.id)
			? quizzes.map((entry) => (entry.id === draft.id ? draft : entry))
			: [...quizzes, draft];
	};
	const openRoom = async (quiz: QuizDraft) => {
		if (pending || (opening && opening.quizId !== quiz.id)) return;
		opening ??= { id: crypto.randomUUID(), quizId: quiz.id, expectedQuizRevision: quiz.revision };
		const command = opening;
		pending = true;
		errorMessage = '';
		try {
			const view = await roomTransport.submit(
				resolve('/enseignant/modules/[moduleId]/quiz', { moduleId: data.module.id }) + '?/openRoom',
				command,
				(payload) => {
					const result = quizTeacherProjectionSchema.parse(payload);
					if (result.id !== command.id) throw new Error('Unexpected room.');
					return result;
				}
			);
			opening = null;
			allowNavigation = true;
			notify('Salle de quiz ouverte.');
			await goto(resolve('/enseignant/quiz/[runId]', { runId: view.id }));
		} catch (cause) {
			allowNavigation = false;
			errorMessage =
				cause instanceof Error ? cause.message : 'Ouverture non confirmée. Réessayez pour retrouver la même salle.';
			notify(errorMessage, 'error');
			if (
				cause instanceof TeachingRequestError &&
				cause.decodedServerError &&
				cause.status >= 400 &&
				cause.status < 500
			)
				opening = null;
		} finally {
			pending = false;
		}
	};
	beforeNavigate((navigation) => {
		if (!allowNavigation && (pending || opening)) navigation.cancel();
	});
</script>

<form
	hidden
	method="POST"
	use:roomTransport.enhance
	onsubmit={roomTransport.handleSubmit((event) => event.preventDefault())}
></form>

{#if editing}
	{#key editorKey}<QuizDraftEditor
			data={{ ...data, quizzes }}
			initial={initialDraft}
			{contextId}
			frozen={!!initialDraft && data.runs.some((run) => run.quizId === initialDraft?.id)}
			onSaved={saved}
			onClose={() => {
				editing = false;
			}}
		/>{/key}
{:else}
	<section class="page-sections">
		<ModulePageNavigation
			moduleId={data.module.id}
			moduleTitle={data.module.title}
			currentPage="quiz"
			classId={context?.classId}
			contextId={context?.id}
			academicYear={contextLabel?.academicYear}
			{returnSection}
			disabled={pending || !!opening}
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="flex flex-col gap-2">
					<h1 class="page-title">Quiz</h1>
					<p class="text-sm text-muted-foreground">
						{data.module.title}
					</p>
				</div>
				{#if visibleQuizzes.length}<Button disabled={!canCreate || pending || !!opening} onclick={() => edit(null)}
						><Plus data-icon="inline-start" />Créer un quiz</Button
					>{/if}
			</div>
		</ModulePageNavigation>
		{#if currentContexts.length > 1}
			<Field.Field class="max-w-sm">
				<Field.FieldLabel for="quiz-context">Classe</Field.FieldLabel>
				<NativeSelect.Root id="quiz-context" class="w-full" bind:value={contextId} disabled={pending || !!opening}>
					{#each currentContexts as entry (entry.id)}
						{@const label = data.rubric.contexts.find((item) => item.id === entry.id)}
						<NativeSelect.Option value={entry.id}>{label?.className ?? 'Classe'}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</Field.Field>
		{:else if contextLabel}
			<div class="flex min-w-0 flex-col gap-2">
				<p class="text-sm font-medium">Classe</p>
				<output aria-label="Classe associée" class="font-medium wrap-anywhere">{contextLabel.className}</output>
			</div>
		{/if}
		{#if errorMessage}<Alert.Root variant="destructive" role="alert"
				><CircleAlert /><Alert.Title>Salle à vérifier</Alert.Title><Alert.Description
					>{errorMessage}{#if opening}<p class="mt-2">
							La tentative de création est conservée. Réessayez son ouverture dans la liste ci-dessous.
						</p>{/if}</Alert.Description
				></Alert.Root
			>{/if}
		{#if !context || !context.lessons.length}<Empty.Root variant="surface"
				><Empty.Header
					><Empty.Media variant="icon"><CalendarDaysIcon aria-hidden="true" /></Empty.Media><Empty.Title
						>{context ? 'Planifiez une séance' : 'Associez une classe et une séance'}</Empty.Title
					><Empty.Description
						>Un quiz se prépare dans une séance du module. Ajoutez son planning pour commencer.</Empty.Description
					></Empty.Header
				><Empty.Content
					><Button
						href={`${resolve('/enseignant/modules/[moduleId]', { moduleId: data.module.id })}?${new URLSearchParams({ ...navigationScope, section: 'planning' })}` as ResolvedPathname}
						>Préparer le planning</Button
					></Empty.Content
				></Empty.Root
			>
		{:else if !visibleQuizzes.length}<Empty.Root variant="surface"
				><Empty.Header
					><Empty.Media variant="icon"><ListChecksIcon aria-hidden="true" /></Empty.Media><Empty.Title
						>Préparer le premier quiz</Empty.Title
					><Empty.Description
						>{hasFreeLine
							? 'Créez les questions et leurs bonnes réponses, reliez le quiz à sa séance, puis ouvrez une salle quand la classe est prête.'
							: 'Créez d’abord une ligne de quiz notée dans le barème. Son maximum correspond au nombre de questions : un point par question.'}</Empty.Description
					></Empty.Header
				><Empty.Content
					>{#if hasFreeLine}<Button disabled={!canCreate || pending || !!opening} onclick={() => edit(null)}
							><Plus data-icon="inline-start" />Créer le premier quiz</Button
						>{:else}<Button href={rubricPath}>Créer une ligne dans le barème</Button>{/if}</Empty.Content
				></Empty.Root
			>
		{:else}
			{#if !hasFreeLine}<p class="text-sm text-muted-foreground">
					Pour ajouter un autre quiz, <a class="font-medium text-primary underline underline-offset-4" href={rubricPath}
						>créez une nouvelle ligne dans le barème</a
					>.
				</p>{/if}
			<div class="overflow-hidden rounded-xl bg-card">
				<Table.Root
					><Table.Caption class="sr-only">Quiz de {contextLabel?.className}</Table.Caption><Table.Header
						><Table.Row
							><Table.Head>Quiz et séance</Table.Head><Table.Head class="hidden md:table-cell">Questions</Table.Head
							><Table.Head class="hidden md:table-cell">Durée</Table.Head><Table.Head class="hidden md:table-cell"
								>État</Table.Head
							><Table.Head class="text-right">Actions</Table.Head></Table.Row
						></Table.Header
					><Table.Body
						>{#each visibleQuizzes as quiz (quiz.id)}{@const runs = data.runs.filter(
								(run) => run.quizId === quiz.id
							)}{@const current = runs.find((run) => run.status !== 'closed') ?? runs[0]}{@const lesson =
								context.lessons.find((entry) => entry.id === quiz.lessonId)}{@const durationLabel =
								formatDurationSeconds(quiz.content.durationSeconds)}{@const statusLabel = quiz.needsReview
								? 'À vérifier'
								: current?.status === 'running'
									? 'En cours'
									: current?.status === 'lobby'
										? 'Salle ouverte'
										: current
											? 'Clôturé'
											: 'Prêt à lancer'}<Table.Row
								><Table.Cell class="max-w-40 whitespace-normal md:max-w-80"
									><p class="font-medium break-words">{quiz.content.title}</p>
									<p class="mt-1 text-xs text-muted-foreground">
										{lesson?.title ?? 'Séance à réassocier'}
									</p>
									<div class="mt-3 flex flex-col items-start gap-2 md:hidden">
										<p class="text-xs text-muted-foreground tabular-nums">
											{quiz.content.questions.length} question{quiz.content.questions.length > 1 ? 's' : ''} · {durationLabel}
										</p>
										<Badge variant={quiz.needsReview ? 'outline' : 'secondary'}>{statusLabel}</Badge>
									</div></Table.Cell
								><Table.Cell class="hidden tabular-nums md:table-cell">{quiz.content.questions.length}</Table.Cell
								><Table.Cell class="hidden tabular-nums md:table-cell">{durationLabel}</Table.Cell><Table.Cell
									class="hidden md:table-cell"
									><Badge variant={quiz.needsReview ? 'outline' : 'secondary'}>{statusLabel}</Badge></Table.Cell
								><Table.Cell
									><div class="flex flex-row flex-wrap justify-end gap-2">
										<Tooltip.Root>
											<Tooltip.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														variant="outline"
														size="icon-sm"
														disabled={pending || !!opening}
														aria-label={`${runs.length ? 'Consulter' : 'Modifier'} ${quiz.content.title}`}
														onclick={() => edit(quiz)}
													>
														{#if runs.length}<EyeIcon aria-hidden="true" />{:else}<PencilIcon aria-hidden="true" />{/if}
													</Button>
												{/snippet}
											</Tooltip.Trigger>
											<Tooltip.Content role="tooltip" sideOffset={8}
												>{runs.length ? 'Consulter' : 'Modifier'}</Tooltip.Content
											>
										</Tooltip.Root>
										{#if current?.status === 'closed' && current.canOpenFollowUp}
											<Tooltip.Root
												><Tooltip.Trigger
													>{#snippet child({ props })}<Button
															{...props}
															variant="outline"
															size="icon-sm"
															aria-label={`Voir les résultats de ${quiz.content.title}`}
															href={resolve('/enseignant/quiz/[runId]', { runId: current.id })}
															><ChartColumnIcon aria-hidden="true" /></Button
														>{/snippet}</Tooltip.Trigger
												><Tooltip.Content>Voir les résultats</Tooltip.Content></Tooltip.Root
											>
											<Button
												size="sm"
												href={`${resolve('/enseignant/quiz/[runId]', { runId: current.id })}?nouvelle-salle=1` as ResolvedPathname}
												disabled={pending || !!opening || quiz.needsReview || !quiz.lessonId || !!data.module.paused}
												><Play data-icon="inline-start" />Ouvrir une salle</Button
											>
										{:else if current}<Button
												size="sm"
												variant={current.status === 'closed' ? 'outline' : 'default'}
												href={resolve('/enseignant/quiz/[runId]', { runId: current.id })}
												>{current.status === 'closed' ? 'Voir les résultats' : 'Piloter la salle'}</Button
											>{:else}<Button
												size="sm"
												disabled={pending ||
													(opening?.quizId !== quiz.id && !!opening) ||
													quiz.needsReview ||
													!quiz.lessonId ||
													!!data.module.paused}
												onclick={() => openRoom(quiz)}
											>
												{#if pending && opening?.quizId === quiz.id}<Spinner data-icon="inline-start" />{:else}<Play
														data-icon="inline-start"
														aria-hidden="true"
													/>{/if}
												{opening?.quizId === quiz.id ? 'Réessayer l’ouverture' : 'Ouvrir une salle'}
											</Button>{/if}
									</div></Table.Cell
								></Table.Row
							>{/each}</Table.Body
					></Table.Root
				>
			</div>
			<p class="max-w-prose text-sm text-muted-foreground">
				Ouvrir une salle fige le quiz. Les étudiants rejoignent le lien de sa séance publiée ; vous décidez ensuite du
				démarrage.
			</p>
		{/if}
	</section>
{/if}
