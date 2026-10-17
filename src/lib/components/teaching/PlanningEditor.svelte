<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import type { ClassSummary } from '#lib/teaching/types.js';
	import type { ModuleEditorInput } from './ModuleDraftEditor.svelte';
	import EditorFields from './EditorFields.svelte';

	let {
		form,
		classes,
		persistedIds,
		persistedLessonIds
	}: {
		form: SuperForm<ModuleEditorInput, string>;
		classes: ClassSummary[];
		persistedIds: string[];
		persistedLessonIds: string[];
	} = $props();
	// The keyed editor owns one stable Superform instance for its lifetime.
	const { form: formData } = untrack(() => form);
	// Display metadata is a fresh snapshot; all editable values remain in the shared store.
	const contexts = $derived(
		$formData.contexts.map((context) => ({
			id: context.id,
			classId: context.classId,
			lessons: context.lessons.map(({ id, title }) => ({ id, title }))
		}))
	);
	const availableClasses = $derived($formData.contexts.length ? [] : classes);
	const classOptions = $derived([
		{ value: '', label: 'Choisir une classe' },
		...availableClasses.map((item) => ({
			value: item.id,
			label: `${item.name} · ${item.academicYear}`
		}))
	]);
	function addClass() {
		if (
			!availableClasses.some((item) => item.id === $formData.addClassId) ||
			$formData.contexts.length >= 1
		)
			return;
		formData.update((data) => ({
			...data,
			addClassId: '',
			contexts: [
				...data.contexts,
				{ id: crypto.randomUUID(), classId: data.addClassId, lessons: [] }
			]
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
		return item ? `${item.name} · ${item.academicYear}` : 'Classe associée';
	}
</script>

<Form.Fieldset {form} name="contexts" class="flex min-w-0 flex-col gap-8">
	<Form.Legend class="sr-only">Classes et planning</Form.Legend>
	{#if $formData.contexts.length === 0}
		<Empty.Root class="border border-dashed py-7">
			<Empty.Header
				><Empty.Title>Aucune classe associée</Empty.Title><Empty.Description
					>Le brouillon peut être enregistré maintenant. Vous pourrez rattacher une classe et
					planifier les séances plus tard.</Empty.Description
				></Empty.Header
			>
		</Empty.Root>
	{/if}
	{#each contexts as context, contextIndex (context.id)}
		<Form.Fieldset
			{form}
			name={`contexts[${contextIndex}]`}
			aria-describedby={`${context.id}-class-name`}
			class="flex min-w-0 flex-col gap-6"
		>
			<Form.Legend class="mb-2 text-muted-foreground">Classe associée</Form.Legend>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p id={`${context.id}-class-name`} class="min-w-0 text-base font-medium wrap-anywhere">
					{classLabel(context.classId)}
				</p>
				{#if !persistedIds.includes(context.id)}<Badge variant="secondary">À enregistrer</Badge>
					<Button
						type="button"
						variant="ghost"
						class="min-h-11"
						onclick={() => removeContext(context.id)}
						><TrashIcon data-icon="inline-start" aria-hidden="true" />Retirer la classe</Button
					>{/if}
			</div>
			<Form.FieldErrors />
			<Form.Fieldset
				{form}
				name={`contexts[${contextIndex}].lessons`}
				class="flex min-w-0 flex-col gap-6"
			>
				<Form.Legend class="sr-only">Séances de {classLabel(context.classId)}</Form.Legend>
				{#if context.lessons.length === 0}<p class="text-sm text-muted-foreground">
						Aucune séance planifiée pour cette classe.
					</p>{/if}
				{#each context.lessons as lesson, lessonIndex (lesson.id)}
					<Form.Fieldset
						{form}
						name={`contexts[${contextIndex}].lessons[${lessonIndex}]`}
						class="flex min-w-0 flex-col gap-4"
					>
						<Form.Legend class="mb-0 min-w-0 [overflow-wrap:anywhere]"
							>{lesson.title || `Séance ${lessonIndex + 1}`}</Form.Legend
						>
						<div class="flex justify-end">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="size-11 shrink-0"
								aria-label={`${persistedLessonIds.includes(lesson.id) ? 'Retirer' : 'Annuler'} ${lesson.title || `la nouvelle séance ${lessonIndex + 1}`}`}
								onclick={() => removeLesson(context.id, lesson.id)}
								>{#if persistedLessonIds.includes(lesson.id)}<TrashIcon
										aria-hidden="true"
									/>{:else}<XIcon aria-hidden="true" />{/if}</Button
							>
						</div>
						<div class="flex flex-col gap-4">
							<EditorFields
								{form}
								name={`contexts[${contextIndex}].lessons[${lessonIndex}].title`}
								id={`${lesson.id}-title`}
								label="Intitulé de la séance"
								required
								maxlength={200}
								element
							/>
							<div class="grid min-w-0 gap-4 xl:grid-cols-2">
								<EditorFields
									{form}
									name={`contexts[${contextIndex}].lessons[${lessonIndex}].startsAt`}
									id={`${lesson.id}-startsAt`}
									label="Début"
									type="datetime-local"
									required
									element
								/>
								<EditorFields
									{form}
									name={`contexts[${contextIndex}].lessons[${lessonIndex}].endsAt`}
									id={`${lesson.id}-endsAt`}
									label="Fin"
									type="datetime-local"
									required
									element
								/>
							</div>
							<EditorFields
								{form}
								name={`contexts[${contextIndex}].lessons[${lessonIndex}].recap`}
								id={`${lesson.id}-recap`}
								label="Récapitulatif"
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
								description="Consignes visibles dans le cours étudiant si le calendrier est publié."
								multiline
								maxlength={10000}
								element
							/>
						</div>
						<Form.FieldErrors />
					</Form.Fieldset>
					<Separator />
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
		<Separator />
	{/each}
	<Form.FieldErrors />
	{#if availableClasses.length > 0 && $formData.contexts.length < 100}
		<div class="flex flex-col gap-4">
			<EditorFields
				{form}
				name="addClassId"
				id="module-add-class"
				label="Classe à associer"
				options={classOptions}
			/>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 self-start"
				disabled={!$formData.addClassId}
				onclick={addClass}
				><PlusIcon data-icon="inline-start" aria-hidden="true" />Associer cette classe</Button
			>
		</div>
	{:else if classes.length === 0}<p class="text-sm text-muted-foreground">
			Créez une classe depuis l’espace Classes pour l’associer à ce module.
		</p>
	{:else}<p class="text-sm text-muted-foreground">
			{$formData.contexts.length >= 100
				? 'Limite de 100 classes atteinte.'
				: 'Toutes les classes disponibles sont déjà associées.'}
		</p>{/if}
</Form.Fieldset>
