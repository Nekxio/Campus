<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import type { SuperForm } from 'sveltekit-superforms';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import type { ClassSummary, EditorData } from '#lib/teaching/types.js';
	import type { ModuleEditorInput } from './module-editor-input.js';
	import EditorFields from './EditorFields.svelte';
	import { currentAcademicYear } from '#lib/domain/academic-year.js';

	let {
		form,
		classes,
		persistedIds,
		persistedLessonIds,
		disabled = false,
		managedLessons = []
	}: {
		form: SuperForm<ModuleEditorInput, string>;
		classes: ClassSummary[];
		persistedIds: string[];
		persistedLessonIds: string[];
		disabled?: boolean;
		managedLessons?: EditorData['managedLessons'];
	} = $props();
	// The keyed editor owns one stable Superform instance for its lifetime.
	const { form: formData } = untrack(() => form);
	const managedById = $derived(new Map(managedLessons.map((lesson) => [lesson.id, lesson])));
	const managedLabels = {
		active: 'Séance de l’école',
		cancelled: 'Annulée par l’école',
		missing: 'Absente du flux · à vérifier',
		disconnected: 'Synchronisation déconnectée'
	} as const;
	const managedDescriptions = {
		active: 'L’école gère l’intitulé et les horaires. Votre récapitulatif et vos consignes restent modifiables.',
		cancelled: 'Cette séance est exclue du calendrier. Votre récapitulatif et vos consignes sont conservés.',
		missing: 'Cette séance n’est plus dans le flux reçu. Elle reste au calendrier en attendant votre vérification.',
		disconnected: 'La synchronisation est suspendue. Les horaires reçus et vos contenus sont conservés.'
	} as const;
	// Display metadata is a fresh snapshot; all editable values remain in the shared store.
	const contexts = $derived(
		$formData.contexts.map((context) => ({
			id: context.id,
			classId: context.classId,
			lessons: context.lessons.map(({ id, title }) => ({ id, title }))
		}))
	);
	const availableClasses = $derived(
		$formData.contexts.length ? [] : classes.filter((item) => item.academicYear === currentAcademicYear())
	);
	const classOptions = $derived([
		{ value: '', label: 'Choisir une classe' },
		...availableClasses.map((item) => ({
			value: item.id,
			label: item.name
		}))
	]);
	function addClass() {
		if (!availableClasses.some((item) => item.id === $formData.addClassId) || $formData.contexts.length >= 1) return;
		formData.update((data) => ({
			...data,
			addClassId: '',
			contexts: [...data.contexts, { id: crypto.randomUUID(), classId: data.addClassId, lessons: [] }]
		}));
	}
	function removeContext(id: string) {
		if (persistedIds.includes(id)) return;
		formData.update((data) => ({
			...data,
			contexts: data.contexts.filter((context) => context.id !== id)
		}));
		void form.validateForm({ update: true, focusOnError: false });
	}
	function addLesson(contextId: string) {
		formData.update((data) => ({
			...data,
			contexts: data.contexts.map((context) =>
				context.id === contextId && context.lessons.length < 200
					? {
							...context,
							lessons: [
								...context.lessons,
								{
									id: crypto.randomUUID(),
									title: '',
									startsAt: '',
									endsAt: '',
									recap: '',
									toDo: ''
								}
							]
						}
					: context
			)
		}));
	}
	function removeLesson(contextId: string, lessonId: string) {
		if (managedById.has(lessonId)) return;
		formData.update((data) => ({
			...data,
			contexts: data.contexts.map((context) =>
				context.id === contextId
					? { ...context, lessons: context.lessons.filter((lesson) => lesson.id !== lessonId) }
					: context
			)
		}));
		void form.validateForm({ update: true, focusOnError: false });
	}
	function classLabel(id: string) {
		const item = classes.find((value) => value.id === id);
		return item
			? item.academicYear === currentAcademicYear()
				? item.name
				: `${item.name} · ${item.academicYear}`
			: 'Classe associée';
	}
</script>

<Form.Fieldset {form} name="contexts" class="planning-editor flex min-w-0 flex-col gap-8">
	<Form.Legend class="sr-only">Classe et planning</Form.Legend>
	{#if managedLessons.length > 0}
		<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
			Ces séances ont été importées du calendrier de l’école.
			<a
				class="font-medium text-foreground underline underline-offset-4 aria-disabled:pointer-events-none aria-disabled:opacity-50"
				href={disabled ? undefined : resolve('/enseignant/applications#calendrier')}
				aria-disabled={disabled || undefined}
				role={disabled ? 'link' : undefined}
				tabindex={disabled ? -1 : undefined}>Gérer l’abonnement dans Applications</a
			>.
		</p>
	{/if}
	{#if $formData.contexts.length === 0}
		<Empty.Root>
			<Empty.Header
				><Empty.Title>Aucune classe associée</Empty.Title><Empty.Description
					>Le brouillon peut être enregistré maintenant. Vous pourrez rattacher une classe et planifier les séances plus
					tard.</Empty.Description
				></Empty.Header
			>
			{#if !availableClasses.length}
				<Empty.Content
					><p class="text-sm text-muted-foreground">
						Créez une classe dans <a
							class="text-primary underline underline-offset-4"
							href={resolve('/enseignant/classes')}>l’espace Classes</a
						> pour l’associer à ce module.
					</p></Empty.Content
				>
			{/if}
		</Empty.Root>
	{/if}
	{#each contexts as context, contextIndex (context.id)}
		<Form.Fieldset
			{form}
			name={`contexts[${contextIndex}]`}
			aria-describedby={`${context.id}-class-name`}
			class="planning-context flex min-w-0 flex-col gap-6"
		>
			<Form.Legend class="mb-2 text-muted-foreground">Classe associée</Form.Legend>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p id={`${context.id}-class-name`} class="min-w-0 text-base font-medium wrap-anywhere">
					{classLabel(context.classId)}
				</p>
				{#if !persistedIds.includes(context.id)}<Badge variant="secondary">À enregistrer</Badge>
					<Button type="button" variant="destructive-outline" class="min-h-11" onclick={() => removeContext(context.id)}
						><TrashIcon data-icon="inline-start" aria-hidden="true" />Retirer la classe</Button
					>{/if}
			</div>
			<Form.FieldErrors />
			<Form.Fieldset {form} name={`contexts[${contextIndex}].lessons`} class="flex min-w-0 flex-col gap-6">
				<Form.Legend class="sr-only">Séances de {classLabel(context.classId)}</Form.Legend>
				{#if context.lessons.length === 0}<p class="text-sm text-muted-foreground">
						Aucune séance planifiée pour cette classe.
					</p>{/if}
				{#each context.lessons as lesson, lessonIndex (lesson.id)}
					{@const managed = managedById.get(lesson.id)}
					<Form.Fieldset
						{form}
						name={`contexts[${contextIndex}].lessons[${lessonIndex}]`}
						aria-describedby={managed ? `${lesson.id}-source` : undefined}
						class="planning-lesson flex min-w-0 flex-col gap-4"
					>
						<Form.Legend class="sr-only">{lesson.title || `Séance ${lessonIndex + 1}`}</Form.Legend>
						<div class="lesson-heading">
							<h3 class="min-w-0 item-title wrap-anywhere">{lesson.title || `Séance ${lessonIndex + 1}`}</h3>
							{#if !managed}
								<Button
									type="button"
									variant={persistedLessonIds.includes(lesson.id) ? 'destructive-ghost' : 'ghost'}
									size="icon"
									class="size-11 shrink-0"
									aria-label={`${persistedLessonIds.includes(lesson.id) ? 'Retirer' : 'Annuler'} ${lesson.title || `la nouvelle séance ${lessonIndex + 1}`}`}
									onclick={() => removeLesson(context.id, lesson.id)}
									>{#if persistedLessonIds.includes(lesson.id)}<TrashIcon aria-hidden="true" />{:else}<XIcon
											aria-hidden="true"
										/>{/if}</Button
								>
							{/if}
						</div>
						{#if managed}
							<div class="flex flex-col items-start gap-2">
								<Badge variant="secondary">{managedLabels[managed.status]}</Badge>
								<p id={`${lesson.id}-source`} class="max-w-prose text-sm leading-relaxed text-muted-foreground">
									{managedDescriptions[managed.status]}
								</p>
							</div>
						{/if}
						<div class="lesson-workspace">
							<div class="lesson-time">
								<EditorFields
									{form}
									name={`contexts[${contextIndex}].lessons[${lessonIndex}].title`}
									id={`${lesson.id}-title`}
									label="Intitulé de la séance"
									required
									maxlength={200}
									readonly={Boolean(managed)}
									element
								/>
								<div class="lesson-dates">
									<EditorFields
										{form}
										name={`contexts[${contextIndex}].lessons[${lessonIndex}].startsAt`}
										id={`${lesson.id}-startsAt`}
										label="Début"
										readonly={Boolean(managed)}
										type="datetime-local"
										required
										element
									/>
									<EditorFields
										{form}
										name={`contexts[${contextIndex}].lessons[${lessonIndex}].endsAt`}
										id={`${lesson.id}-endsAt`}
										label="Fin"
										readonly={Boolean(managed)}
										type="datetime-local"
										required
										element
									/>
								</div>
							</div>
							<div class="lesson-content">
								<EditorFields
									{form}
									name={`contexts[${contextIndex}].lessons[${lessonIndex}].recap`}
									id={`${lesson.id}-recap`}
									label="Récapitulatif"
									required={false}
									description="Visible dans le cours étudiant si le calendrier est publié."
									multiline
									maxlength={10000}
									element
								/>
								<EditorFields
									{form}
									name={`contexts[${contextIndex}].lessons[${lessonIndex}].toDo`}
									id={`${lesson.id}-toDo`}
									label="À faire"
									required={false}
									description="Consignes visibles dans le cours étudiant si le calendrier est publié."
									multiline
									maxlength={10000}
									element
								/>
							</div>
						</div>
						<Form.FieldErrors />
					</Form.Fieldset>
				{/each}
				<Form.FieldErrors />
			</Form.Fieldset>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 self-start"
				disabled={context.lessons.length >= 200}
				onclick={() => addLesson(context.id)}
				><PlusIcon data-icon="inline-start" aria-hidden="true" />Ajouter une séance</Button
			>
			{#if context.lessons.length >= 200}<p class="text-sm text-muted-foreground">
					Limite de 200 séances atteinte.
				</p>{/if}
		</Form.Fieldset>
	{/each}
	<Form.FieldErrors class="empty:hidden" />
	{#if availableClasses.length > 0}
		<div class="flex flex-col gap-4">
			<EditorFields
				{form}
				name="addClassId"
				id="module-add-class"
				label="Classe à associer"
				required={false}
				options={classOptions}
			/>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 self-start"
				disabled={!$formData.addClassId}
				onclick={addClass}><PlusIcon data-icon="inline-start" aria-hidden="true" />Associer cette classe</Button
			>
		</div>
	{:else if $formData.contexts.length > 0}<p class="max-w-prose text-sm text-muted-foreground">
			Un module est associé à une seule classe. Pour une autre classe, créez une copie pédagogique indépendante.
		</p>
	{/if}
</Form.Fieldset>

<style>
	.lesson-workspace {
		display: grid;
		min-width: 0;
		gap: 1.5rem;
	}
	.lesson-time,
	.lesson-dates,
	.lesson-content {
		display: grid;
		min-width: 0;
		gap: 1rem;
	}
	.lesson-dates {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
	}
	.lesson-heading {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	@container lesson (min-width: 38rem) {
		.lesson-content {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@container lesson (min-width: 46rem) {
		.lesson-time {
			grid-template-columns: minmax(0, 1fr) repeat(2, minmax(14rem, 1fr));
		}
		.lesson-dates {
			display: contents;
		}
	}

	:global(.planning-context) {
		padding-block: 0.5rem;
	}
	:global(.planning-editor [data-fs-field-errors]:empty) {
		display: none;
	}
	:global(.planning-lesson) {
		container: lesson / inline-size;
		padding-block-start: 1rem;
	}
	:global(.planning-lesson + .planning-lesson) {
		border-top: 1px solid var(--border);
		padding-block-start: 1.5rem;
	}
</style>
