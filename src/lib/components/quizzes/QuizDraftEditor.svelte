<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { defaults, setError, superForm, type FormPathLeavesWithErrors } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import {
		quizDraftSchema,
		quizDraftWriteSchema,
		quizQuestionSchema,
		type QuizDraft,
		type QuizDraftWrite,
		type QuizQuestion
	} from '#lib/domain/quiz-content.js';
	import {
		changeQuizQuestionType,
		confirmQuizDraftSave,
		createQuizQuestion,
		quizEditorInput,
		selectQuizCorrectOption,
		type QuizEditorInput
	} from '#lib/quizzes/teacher-editor.js';
	import type { QuizWorkspaceData } from '#lib/quizzes/teacher-data.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { formatDurationSeconds, formatDurationInput, parseDurationInput } from '#lib/teaching/duration.js';
	import CorrectionField from '#lib/components/grading/CorrectionField.svelte';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { focusFirstInvalidField } from '#lib/client/form-feedback.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import Minus from '@lucide/svelte/icons/minus';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Settings from '@lucide/svelte/icons/settings';
	import Trash from '@lucide/svelte/icons/trash-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';

	let {
		data,
		initial,
		contextId,
		frozen,
		onSaved,
		onClose
	}: {
		data: QuizWorkspaceData;
		initial: QuizDraft | null;
		contextId: string;
		frozen: boolean;
		onSaved: (quiz: QuizDraft) => void;
		onClose: () => void;
	} = $props();
	const snapshot = untrack(() => ({ data, initial, contextId }));
	const context = snapshot.data.module.contexts.find((entry) => entry.id === snapshot.contextId);
	const contextLabel = snapshot.data.rubric.contexts.find((entry) => entry.id === snapshot.contextId);
	const classLabel = contextLabel
		? `${contextLabel.className}${contextLabel.academicYear !== snapshot.data.academicYear ? ` · ${contextLabel.academicYear}` : ''}`
		: 'Classe';
	const lines = snapshot.data.rubric.assessments
		.filter((section) => section.kind === 'quiz' && section.purpose === 'graded')
		.flatMap((section) =>
			section.lines.map((line) => ({
				...line,
				assessmentId: section.id,
				sectionTitle: section.title
			}))
		);
	const availableLines = lines.filter(
		(line) =>
			!snapshot.data.quizzes.some(
				(quiz) => quiz.contextId === snapshot.contextId && quiz.lineId === line.id && quiz.id !== snapshot.initial?.id
			)
	);
	const firstLine = availableLines[0];
	const input: QuizEditorInput = snapshot.initial
		? quizEditorInput({ ...snapshot.initial, lessonId: snapshot.initial.lessonId ?? '' })
		: {
				moduleId: snapshot.data.module.id,
				contextId: snapshot.contextId,
				lessonId: context?.lessons[0]?.id ?? '',
				assessmentId: firstLine?.assessmentId ?? '',
				lineId: firstLine?.id ?? '',
				content: { version: 1, title: '', durationSeconds: 600, questions: [createQuizQuestion()] }
			};
	const schema = quizDraftWriteSchema
		.omit({ id: true, requestId: true, expectedRevision: true })
		.superRefine((value, ctx) => {
			const line = availableLines.find(
				(entry) => entry.id === value.lineId && entry.assessmentId === value.assessmentId
			);
			if (!line || line.maxPoints !== value.content.questions.length)
				ctx.addIssue({
					code: 'custom',
					path: ['lineId'],
					message: 'Le maximum de cette ligne doit être égal au nombre de questions (un point par question).'
				});
			if (!context?.lessons.some((lesson) => lesson.id === value.lessonId))
				ctx.addIssue({
					code: 'custom',
					path: ['lessonId'],
					message: 'Choisissez une séance de cette classe.'
				});
		});
	const form = superForm<QuizEditorInput, string>(defaults<QuizEditorInput, string>(input, zod4(schema)), {
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
	const transport = createFormActionTransport(form);
	const { form: formData, allErrors } = form;
	let durationInput = $state(formatDurationInput(input.content.durationSeconds));
	let durationEdited = $state(false);
	const durationSeconds = $derived(parseDurationInput(durationInput));
	const updateDuration = (value: string) => {
		durationInput = value;
		durationEdited = true;
		const seconds = parseDurationInput(value);
		if (seconds !== null) {
			$formData.content.durationSeconds = seconds;
			form.errors.update((errors) => ({
				...errors,
				content: { ...errors.content, durationSeconds: undefined }
			}));
		}
	};
	const stepDuration = (direction: -1 | 1) => {
		const current = durationSeconds ?? $formData.content.durationSeconds;
		const next = direction === 1 ? (Math.floor(current / 30) + 1) * 30 : (Math.ceil(current / 30) - 1) * 30;
		updateDuration(formatDurationInput(Math.max(30, Math.min(14400, next))));
	};
	const formId = $props.id();
	let quizId = $state(snapshot.initial?.id ?? null);
	let revision = $state(snapshot.initial?.revision ?? 0);
	let needsReview = $state(snapshot.initial?.needsReview ?? false);
	let baseline = $state(JSON.stringify(quizEditorInput(input)));
	let pending = $state(false);
	let pendingCommand = $state.raw<QuizDraftWrite | null>(null);
	let conflict = $state(false);
	let errorMessage = $state('');
	let notice = $state('');
	let settingsOpen = $state(false);
	let questionOpen = $state(false);
	let selectedQuestionId = $state<string | null>(null);
	let confirmOpen = $state(false);
	let confirmKind = $state<'leave' | 'reload' | 'close'>('close');
	let destination: ResolvedPathname = resolve('/');
	let allowNavigation = false;
	const dirty = $derived(
		JSON.stringify(quizEditorInput($formData)) !== baseline || (durationEdited && durationSeconds === null)
	);
	const questionIndex = $derived(
		$formData.content.questions.findIndex((question) => question.id === selectedQuestionId)
	);
	const question = $derived($formData.content.questions[questionIndex]);
	const line = $derived(lines.find((entry) => entry.id === $formData.lineId));
	const lineMismatch = $derived(!line || line.maxPoints !== $formData.content.questions.length);
	const errorMessages = $derived([...new Set($allErrors.flatMap((entry) => entry.messages))]);
	const typeLabels: Record<QuizQuestion['type'], string> = {
		single: 'Une réponse',
		multiple: 'Plusieurs réponses',
		true_false: 'Vrai / Faux'
	};
	const lessonOptions = [
		{ value: '', label: 'Choisir une séance' },
		...(context?.lessons.map((lesson) => ({ value: lesson.id, label: lesson.title })) ?? [])
	];

	const revealErrors = async () => {
		const questionError = $allErrors.find((entry) => entry.path.startsWith('content.questions['));
		const index = questionError?.path.match(/\[(\d+)\]/)?.[1];
		if (index !== undefined) {
			selectedQuestionId = $formData.content.questions[Number(index)]?.id ?? null;
			settingsOpen = false;
			questionOpen = true;
		} else {
			questionOpen = false;
			settingsOpen = true;
		}
		const element = document.getElementById(formId);
		if (element instanceof HTMLFormElement) await focusFirstInvalidField(element);
	};

	const save = async (event?: SubmitEvent) => {
		event?.preventDefault();
		if (pending || conflict || frozen) return;
		if (!pendingCommand) {
			const checked = await form.validateForm({ update: true, focusOnError: false });
			if (durationEdited && durationSeconds === null) {
				setError(checked, 'content.durationSeconds', 'Choisissez une durée de 0:30 à 240:00, par pas de 30 secondes.');
				form.errors.set(checked.errors);
				await revealErrors();
				return;
			}
			if (!checked.valid) {
				errorMessage = 'Corrigez les champs signalés. Vos saisies sont conservées.';
				notify(errorMessage, 'error');
				await revealErrors();
				return;
			}
			pendingCommand = {
				...quizEditorInput(checked.data),
				id: quizId ?? crypto.randomUUID(),
				expectedRevision: revision,
				requestId: crypto.randomUUID()
			};
		}
		const command = pendingCommand;
		pending = true;
		errorMessage = '';
		notice = '';
		try {
			const saved = await transport.submit(
				resolve('/enseignant/modules/[moduleId]/quiz', { moduleId: command.moduleId }) + '?/saveQuiz',
				command,
				(payload) => confirmQuizDraftSave(command, payload)
			);
			quizId = command.id;
			revision = saved.revision;
			baseline = JSON.stringify(saved.baseline);
			needsReview = false;
			pendingCommand = null;
			onSaved({ id: command.id, ...saved.baseline, revision: saved.revision, needsReview: false, archived: false });
			notice = 'Quiz enregistré.';
		} catch (cause) {
			errorMessage = cause instanceof Error ? cause.message : 'Enregistrement non confirmé. Réessayez.';
			notify(errorMessage, 'error');
			if (
				cause instanceof TeachingRequestError &&
				cause.decodedServerError &&
				cause.status >= 400 &&
				cause.status < 500
			) {
				pendingCommand = null;
				conflict = cause.status === 409;
				if (Object.keys(cause.fields).length) {
					const snapshot = form.capture();
					for (const [rawPath, message] of Object.entries(cause.fields)) {
						const path = rawPath.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
						setError(snapshot, path as FormPathLeavesWithErrors<QuizEditorInput>, message, {
							overwrite: true
						});
					}
					form.errors.set(snapshot.errors);
					await revealErrors();
				}
			}
		} finally {
			pending = false;
		}
	};
	const editQuestion = (id: string) => {
		selectedQuestionId = id;
		questionOpen = true;
	};
	const updateQuestion = (next: QuizQuestion) => {
		$formData.content.questions = $formData.content.questions.map((entry) => (entry.id === next.id ? next : entry));
	};
	const updateQuestionType = (question: QuizQuestion, value: string) => {
		const type = quizQuestionSchema.shape.type.safeParse(value);
		if (type.success) updateQuestion(changeQuizQuestionType(question, type.data));
	};
	const addQuestion = () => {
		const next = createQuizQuestion();
		$formData.content.questions = [...$formData.content.questions, next];
		editQuestion(next.id);
	};
	const moveQuestion = (index: number, delta: number) => {
		const next = [...$formData.content.questions];
		[next[index], next[index + delta]] = [next[index + delta], next[index]];
		$formData.content.questions = next;
	};
	const removeOption = (optionId: string) => {
		if (question)
			updateQuestion({
				...question,
				options: question.options.filter((option) => option.id !== optionId),
				correctOptionIds: question.correctOptionIds.filter((id) => id !== optionId)
			});
	};
	const changeLine = (lineId: string) => {
		const next = availableLines.find((entry) => entry.id === lineId);
		$formData.lineId = lineId;
		$formData.assessmentId = next?.assessmentId ?? '';
	};
	const closeEditor = () => {
		if (dirty || pendingCommand || pending) {
			confirmKind = 'close';
			confirmOpen = true;
		} else onClose();
	};
	const confirmDiscard = async () => {
		if (pending) return;
		confirmOpen = false;
		if (confirmKind === 'reload') {
			if (!quizId) return;
			pending = true;
			errorMessage = '';
			notice = '';
			try {
				const response = await fetch(`/api/teaching/quizzes/${quizId}`, {
					credentials: 'same-origin'
				});
				if (!response.ok) throw new Error('Unavailable saved quiz.');
				const saved = quizDraftSchema.parse(await response.json());
				if (saved.id !== quizId || saved.contextId !== snapshot.contextId || saved.moduleId !== snapshot.data.module.id)
					throw new Error('Unexpected quiz.');
				const next = quizEditorInput({ ...saved, lessonId: saved.lessonId ?? '' });
				form.reset({ data: next });
				durationInput = formatDurationInput(next.content.durationSeconds);
				durationEdited = false;
				revision = saved.revision;
				baseline = JSON.stringify(next);
				needsReview = saved.needsReview;
				pendingCommand = null;
				conflict = false;
				errorMessage = '';
				notice = 'Version enregistrée rechargée.';
				onSaved(saved);
			} catch {
				errorMessage = 'Actualisation impossible. Vos saisies sont conservées ; réessayez.';
				notify(errorMessage, 'error');
			} finally {
				pending = false;
			}
		} else if (confirmKind === 'leave') {
			allowNavigation = true;
			await goto(destination);
		} else {
			allowNavigation = true;
			onClose();
		}
	};
	beforeNavigate((navigation) => {
		if (allowNavigation || (!dirty && !pendingCommand && !pending)) return;
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
</script>

<section class="space-y-6">
	<div class="space-y-4">
		<Button variant="ghost" class="-ml-3" onclick={closeEditor}
			><ArrowLeft data-icon="inline-start" />Tous les quiz</Button
		>
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0 space-y-2">
				<h1 class="page-title break-words">{$formData.content.title || 'Créer un quiz'}</h1>
				<p class="text-sm text-muted-foreground">
					{snapshot.data.module.title} · {classLabel}
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					onclick={() => {
						settingsOpen = true;
					}}><Settings data-icon="inline-start" />Paramètres</Button
				>{#if !frozen}<Button
						type="submit"
						form={formId}
						disabled={pending || conflict || (!dirty && !needsReview && !pendingCommand && revision > 0)}
						>{#if pending}<Spinner data-icon="inline-start" />{/if}{pendingCommand
							? 'Réessayer l’enregistrement'
							: 'Enregistrer le quiz'}</Button
					>{/if}
			</div>
		</div>
	</div>
	<div class="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
		<p class="text-muted-foreground">
			{$formData.content.questions.length} question{$formData.content.questions.length > 1 ? 's' : ''} · {formatDurationSeconds(
				$formData.content.durationSeconds
			)} · Un point par question
		</p>
		<span role="status" class="text-muted-foreground"
			>{initial?.archived
				? 'Archivé'
				: frozen
					? 'Version figée après ouverture d’une salle'
					: pending
						? 'Enregistrement…'
						: pendingCommand
							? 'Enregistrement à confirmer'
							: dirty
								? 'Modifications non enregistrées'
								: revision > 0
									? 'Enregistré'
									: 'Nouveau brouillon'}</span
		>
	</div>
	{#if needsReview && !initial?.archived}<Alert.Root
			><CircleAlert /><Alert.Title>Quiz importé à vérifier</Alert.Title><Alert.Description
				>Relisez les questions, les bonnes réponses et les paramètres, puis enregistrez pour autoriser son lancement.</Alert.Description
			></Alert.Root
		>{/if}
	{#if initial?.archived}<Alert.Root>
			<CircleAlert /><Alert.Title>Quiz archivé</Alert.Title><Alert.Description
				>Vous pouvez consulter les questions et les paramètres. Pour réutiliser le quiz, restaurez-le dans la
				bibliothèque.</Alert.Description
			>
		</Alert.Root>{:else if frozen}<Alert.Root
			><CircleAlert /><Alert.Title>Cette version est figée</Alert.Title><Alert.Description
				>Une salle a déjà été ouverte. Les questions et paramètres restent consultables ; le rattrapage réutilise cette
				même version.</Alert.Description
			></Alert.Root
		>{/if}
	{#if lineMismatch}<Alert.Root
			><CircleAlert /><Alert.Title>Barème à ajuster</Alert.Title><Alert.Description
				>Ce quiz comporte {$formData.content.questions.length} question{$formData.content.questions.length > 1
					? 's'
					: ''}. La ligne choisie doit avoir le même maximum ({line?.maxPoints ?? 'aucune ligne'} actuellement).<Button
					variant="outline"
					size="sm"
					class="mt-3"
					href={resolve('/enseignant/modules/[moduleId]/bareme', {
						moduleId: snapshot.data.module.id
					})}>Ouvrir le barème</Button
				></Alert.Description
			></Alert.Root
		>{/if}
	{#if errorMessage || errorMessages.length}<Alert.Root variant="destructive" role="alert"
			><CircleAlert /><Alert.Title>Enregistrement à vérifier</Alert.Title><Alert.Description
				>{#if errorMessage}<p>{errorMessage}</p>{/if}{#if errorMessages.length}<ul
						class="mt-2 list-disc space-y-1 pl-4"
					>
						{#each errorMessages as message (message)}<li>{message}</li>{/each}
					</ul>{/if}{#if conflict && quizId}<Button
						variant="outline"
						class="mt-3"
						onclick={() => {
							confirmKind = 'reload';
							confirmOpen = true;
						}}>Recharger la version enregistrée</Button
					>{/if}</Alert.Description
			></Alert.Root
		>{/if}
	<ActionNotice message={notice} />
	<form
		method="POST"
		id={formId}
		use:transport.enhance
		onsubmit={transport.handleSubmit(save)}
		novalidate
		class="space-y-4"
	>
		<div class="overflow-hidden rounded-xl bg-card">
			<ol class="divide-y">
				{#each $formData.content.questions as item, index (item.id)}<li
						class="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-4 p-4 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:p-5"
					>
						<span class="mt-1 w-6 shrink-0 text-sm text-muted-foreground tabular-nums">{index + 1}</span>
						<div class="min-w-0 flex-1 space-y-2">
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant="secondary">{typeLabels[item.type]}</Badge><span class="text-xs text-muted-foreground"
									>1 point</span
								>
							</div>
							<p class="max-w-prose font-medium break-words whitespace-pre-wrap">
								{item.prompt || 'Question à rédiger'}
							</p>
							{#if item.code}
								<!-- Scrollable code must be reachable by keyboard. -->
								<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
								<pre
									tabindex="0"
									role="region"
									aria-label={`Code de la question ${index + 1}`}
									class="max-h-28 overflow-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><code
										>{item.code}</code
									></pre>{/if}
							<p class="text-sm text-muted-foreground">
								{item.options.length} choix · {item.correctOptionIds.length} bonne{item.correctOptionIds.length > 1
									? 's'
									: ''} réponse{item.correctOptionIds.length > 1 ? 's' : ''}
							</p>
						</div>
						<div class="col-start-2 flex flex-wrap items-center gap-1 self-center sm:col-start-auto">
							<Button variant="outline" size="sm" type="button" onclick={() => editQuestion(item.id)}
								>{frozen ? 'Consulter' : 'Modifier'}<span class="sr-only"> la question {index + 1}</span></Button
							>{#if !frozen}<Button
									variant="ghost"
									size="icon"
									type="button"
									disabled={index === 0}
									aria-label={`Remonter la question ${index + 1}`}
									onclick={() => moveQuestion(index, -1)}><ArrowUp /></Button
								><Button
									variant="ghost"
									size="icon"
									type="button"
									disabled={index === $formData.content.questions.length - 1}
									aria-label={`Descendre la question ${index + 1}`}
									onclick={() => moveQuestion(index, 1)}><ArrowDown /></Button
								>{/if}
						</div>
					</li>{/each}
			</ol>
		</div>
		{#if !frozen}<Button
				variant="outline"
				type="button"
				disabled={$formData.content.questions.length >= 200}
				onclick={addQuestion}><Plus data-icon="inline-start" />Ajouter une question</Button
			>{/if}
	</form>
</section>

<Sheet.Root bind:open={settingsOpen}
	><Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
		><Sheet.Header
			><Sheet.Title>Paramètres du quiz</Sheet.Title><Sheet.Description
				>{classLabel}. Les questions et réponses sont toujours mélangées individuellement.</Sheet.Description
			></Sheet.Header
		>
		<div class="space-y-5 px-4 pb-6">
			{@render sheetFeedback()}
			<CorrectionField
				{form}
				name="content.title"
				id={`${formId}-title`}
				label="Titre du quiz"
				maxlength={200}
				disabled={frozen}
				required
				{formId}
			/>
			<Form.Field {form} name="content.durationSeconds"
				><Form.Control
					>{#snippet children({ props })}<Form.Label>Durée du quiz</Form.Label>
						<InputGroup.Root class="h-11">
							<InputGroup.Input
								{...props}
								form={formId}
								type="text"
								inputmode="text"
								class="text-center tabular-nums"
								value={durationInput}
								disabled={frozen}
								oninput={(event) => updateDuration(event.currentTarget.value)}
								onblur={() => {
									if (durationSeconds !== null) durationInput = formatDurationInput(durationSeconds);
								}}
							/>
							<InputGroup.Addon class="py-0"
								><Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="Retirer 30 secondes"
									disabled={frozen || (durationSeconds !== null && durationSeconds <= 30)}
									onclick={() => stepDuration(-1)}><Minus /></Button
								></InputGroup.Addon
							>
							<InputGroup.Addon align="inline-end" class="py-0"
								><Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="Ajouter 30 secondes"
									disabled={frozen || (durationSeconds !== null && durationSeconds >= 14400)}
									onclick={() => stepDuration(1)}><Plus /></Button
								></InputGroup.Addon
							>
						</InputGroup.Root>{/snippet}</Form.Control
				><Form.Description
					>Minutes:secondes, de 0:30 à 240:00, par pas de 30 secondes (ex. 1:30). L’échéance est commune à la classe ;
					un supplément individuel peut être accordé.</Form.Description
				><Form.FieldErrors /></Form.Field
			>
			<CorrectionField
				{form}
				name="lessonId"
				id={`${formId}-lesson`}
				label="Séance"
				options={lessonOptions}
				disabled={frozen}
				required
				{formId}
				description="Le quiz apparaît dans cette séance du cours publié."
			/>
			<Form.Field {form} name="lineId"
				><Form.Control
					>{#snippet children({ props })}<Form.Label>Ligne du barème</Form.Label><NativeSelect.Root
							{...props}
							form={formId}
							class="w-full"
							value={$formData.lineId}
							disabled={frozen}
							onchange={(event) => changeLine(event.currentTarget.value)}
							><NativeSelect.Option value="">Choisir une ligne de quiz notée</NativeSelect.Option
							>{#each availableLines as option (option.id)}<NativeSelect.Option value={option.id}
									>{option.sectionTitle} · {option.label} / {option.maxPoints}</NativeSelect.Option
								>{/each}</NativeSelect.Root
						>{/snippet}</Form.Control
				><Form.Description
					>Une ligne par quiz. Le maximum doit être de {$formData.content.questions.length} point{$formData.content
						.questions.length > 1
						? 's'
						: ''}, soit un point par question.</Form.Description
				><Form.FieldErrors /></Form.Field
			>
			<Button
				variant="outline"
				href={resolve('/enseignant/modules/[moduleId]/bareme', {
					moduleId: snapshot.data.module.id
				})}>Gérer les lignes du barème</Button
			>
			{#if !frozen}<Button type="submit" form={formId} disabled={pending || conflict}
					>{pendingCommand ? 'Réessayer l’enregistrement' : 'Enregistrer le quiz'}</Button
				>{/if}
		</div></Sheet.Content
	></Sheet.Root
>

<Sheet.Root bind:open={questionOpen}
	><Sheet.Content class="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
		><Sheet.Header
			><Sheet.Title>Question {questionIndex + 1}</Sheet.Title><Sheet.Description
				>Un point si toutes les bonnes réponses sont choisies, sans réponse supplémentaire.</Sheet.Description
			></Sheet.Header
		>{#if question}<div class="space-y-6 px-4 pb-6">
				{@render sheetFeedback()}
				<Form.Field {form} name={`content.questions[${questionIndex}].type`}
					><Form.Control
						>{#snippet children({ props })}<Form.Label>Type de question</Form.Label><NativeSelect.Root
								{...props}
								form={formId}
								class="w-full"
								value={question.type}
								disabled={frozen}
								onchange={(event) => updateQuestionType(question, event.currentTarget.value)}
								>{#each Object.entries(typeLabels) as [value, label] (value)}<NativeSelect.Option {value}
										>{label}</NativeSelect.Option
									>{/each}</NativeSelect.Root
							>{/snippet}</Form.Control
					><Form.Description
						>Passer à Vrai / Faux recrée les deux choix et efface la bonne réponse précédente.</Form.Description
					><Form.FieldErrors /></Form.Field
				>
				<CorrectionField
					{form}
					name={`content.questions[${questionIndex}].prompt`}
					id={`${question.id}-prompt`}
					label="Énoncé"
					multiline
					required
					maxlength={10000}
					disabled={frozen}
					{formId}
				/>
				<Form.Fieldset {form} name={`content.questions[${questionIndex}].options`} class="space-y-4"
					><Form.Legend>Choix proposés</Form.Legend>{#each question.options as option, optionIndex (option.id)}<div
							class="flex min-w-0 items-end gap-2"
						>
							<div class="min-w-0 flex-1">
								<CorrectionField
									{form}
									name={`content.questions[${questionIndex}].options[${optionIndex}].text`}
									id={`${option.id}-text`}
									label={`Réponse ${optionIndex + 1}`}
									multiline
									required
									maxlength={10000}
									disabled={frozen}
									{formId}
								/>
							</div>
							{#if !frozen && question.type !== 'true_false'}<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled={question.options.length <= 2}
									aria-label={`Retirer la réponse ${optionIndex + 1}`}
									onclick={() => removeOption(option.id)}><Trash /></Button
								>{/if}
						</div>{/each}<Form.FieldErrors />{#if !frozen && question.type !== 'true_false'}<Button
							type="button"
							variant="outline"
							disabled={question.options.length >= 12}
							onclick={() =>
								updateQuestion({
									...question,
									options: [...question.options, { id: crypto.randomUUID(), text: '' }]
								})}><Plus data-icon="inline-start" />Ajouter un choix</Button
						>{/if}</Form.Fieldset
				>
				<Form.Fieldset {form} name={`content.questions[${questionIndex}].correctOptionIds`} class="space-y-3"
					><Form.Legend>{question.type === 'multiple' ? 'Bonnes réponses' : 'Bonne réponse'}</Form.Legend
					><Form.Description
						>{question.type === 'multiple'
							? 'Cochez tous les choix attendus.'
							: 'Choisissez une seule réponse. Une nouvelle sélection remplace la précédente.'}</Form.Description
					>{#each question.options as option, index (option.id)}<Field.Field orientation="horizontal"
							><Checkbox
								id={`${option.id}-correct`}
								aria-invalid={$allErrors.some(
									(entry) => entry.path === `content.questions[${questionIndex}].correctOptionIds`
								) || undefined}
								aria-describedby={`${question.id}-correct-errors`}
								form={formId}
								disabled={frozen}
								checked={question.correctOptionIds.includes(option.id)}
								onCheckedChange={(checked) =>
									updateQuestion(selectQuizCorrectOption(question, option.id, checked === true))}
							/><Field.FieldLabel for={`${option.id}-correct`} class="min-w-0 break-words"
								>{option.text || `Réponse ${index + 1}`}</Field.FieldLabel
							></Field.Field
						>{/each}<Form.FieldErrors id={`${question.id}-correct-errors`} /></Form.Fieldset
				>
				<div class="space-y-4 border-t pt-5">
					<CorrectionField
						{form}
						name={`content.questions[${questionIndex}].code`}
						id={`${question.id}-code`}
						label="Extrait de code"
						required={false}
						description="Affiché comme du texte. Le code n’est jamais exécuté."
						multiline
						maxlength={20000}
						disabled={frozen}
						{formId}
					/><CorrectionField
						{form}
						name={`content.questions[${questionIndex}].codeLanguage`}
						id={`${question.id}-language`}
						label="Langage"
						required={false}
						description="Par exemple : JavaScript, SQL ou HTML."
						maxlength={50}
						disabled={frozen}
						{formId}
					/>
				</div>
				{#if !frozen}<div class="flex flex-wrap justify-between gap-3 border-t pt-5">
						<Button
							type="button"
							variant="outline"
							disabled={$formData.content.questions.length <= 1}
							onclick={() => {
								$formData.content.questions = $formData.content.questions.filter((entry) => entry.id !== question.id);
								questionOpen = false;
							}}><Trash data-icon="inline-start" />Retirer la question</Button
						><Button type="submit" form={formId} disabled={pending || conflict}
							>{pendingCommand ? 'Réessayer l’enregistrement' : 'Enregistrer le quiz'}</Button
						>
					</div>{/if}
			</div>{/if}</Sheet.Content
	></Sheet.Root
>

<AlertDialog.Root bind:open={confirmOpen}
	><AlertDialog.Content
		><AlertDialog.Header
			><AlertDialog.Title
				>{confirmKind === 'reload' ? 'Recharger le quiz enregistré ?' : 'Quitter cet éditeur ?'}</AlertDialog.Title
			><AlertDialog.Description
				>{confirmKind === 'reload'
					? 'Vos saisies actuelles seront remplacées par la version enregistrée sur le serveur.'
					: pendingCommand
						? 'Un enregistrement reste non confirmé. Réessayez-le avant de partir pour connaître son résultat. Quitter abandonne les saisies affichées.'
						: 'Les modifications non enregistrées seront perdues.'}</AlertDialog.Description
			></AlertDialog.Header
		><AlertDialog.Footer
			><AlertDialog.Cancel>Continuer à modifier</AlertDialog.Cancel><AlertDialog.Action
				disabled={pending}
				onclick={confirmDiscard}
				>{confirmKind === 'reload'
					? 'Recharger la version enregistrée'
					: 'Quitter sans enregistrer'}</AlertDialog.Action
			></AlertDialog.Footer
		></AlertDialog.Content
	></AlertDialog.Root
>

{#snippet sheetFeedback()}
	{#if errorMessage}<Alert.Root variant="destructive" role="alert"
			><CircleAlert /><Alert.Title>Enregistrement à vérifier</Alert.Title><Alert.Description
				>{errorMessage}{#if conflict && quizId}<Button
						variant="outline"
						class="mt-3"
						onclick={() => {
							confirmKind = 'reload';
							confirmOpen = true;
						}}>Recharger la version enregistrée</Button
					>{/if}</Alert.Description
			></Alert.Root
		>{/if}
{/snippet}
