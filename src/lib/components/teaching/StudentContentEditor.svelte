<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import type { EditorData } from '#lib/teaching/types.js';
	import type { ModuleEditorInput } from './module-editor-input.js';
	import EditorFields from './EditorFields.svelte';
	import StudentDossiersEditor from './StudentDossiersEditor.svelte';
	import StudentResourceChoices from './StudentResourceChoices.svelte';
	let {
		form,
		assessments
	}: { form: SuperForm<ModuleEditorInput, string>; assessments: NonNullable<EditorData['dossierAssessments']> } =
		$props();
	const { form: data } = untrack(() => form);
	const assignLesson = (contextId: string, exerciseId: string, lessonId: string) => {
		$data.contexts = $data.contexts.map((context) =>
			context.id !== contextId
				? context
				: {
						...context,
						lessons: context.lessons.map((lesson) => {
							const ids = lesson.exerciseIds ?? [];
							if (lesson.id === lessonId && !ids.includes(exerciseId))
								return { ...lesson, exerciseIds: [...ids, exerciseId] };
							if (lesson.id !== lessonId && ids.includes(exerciseId))
								return { ...lesson, exerciseIds: ids.filter((id) => id !== exerciseId) };
							return lesson;
						})
					}
		);
	};
	const removeExercise = (exerciseId: string) => {
		for (const context of $data.contexts) assignLesson(context.id, exerciseId, '');
		$data.studentContent.exercises = $data.studentContent.exercises.filter((exercise) => exercise.id !== exerciseId);
	};
	function add() {
		data.update((value) => ({
			...value,
			studentContent: {
				...value.studentContent,
				exercises: [
					...value.studentContent.exercises,
					{ id: crypto.randomUUID(), title: '', instructions: '', solution: '', code: '' }
				]
			}
		}));
	}
</script>

<Form.Fieldset {form} name="studentContent" class="student-content-editor flex min-w-0 flex-col gap-6">
	<Form.Legend variant="panel">Consignes et exercices</Form.Legend>
	<Form.Description
		>Ces contenus seront accessibles avec leurs corrigés après votre publication, sans compte ni verrou de date. Les
		quiz Wayground restent externes.</Form.Description
	>
	<Field.FieldGroup class="gap-6">
		<EditorFields
			{form}
			name="studentContent.instructions"
			id="module-instructions"
			label="Consignes du module"
			required={false}
			multiline
			maxlength={20000}
		/>
		<EditorFields
			{form}
			name="studentContent.projectInstructions"
			id="project-instructions"
			label="Consignes du projet, si pertinent"
			required={false}
			multiline
			maxlength={20000}
		/>
		<StudentDossiersEditor {form} {assessments} />
		{#each $data.studentContent.exercises as exercise, index (exercise.id)}
			<Form.Fieldset
				{form}
				name={`studentContent.exercises[${index}]`}
				class="exercise-fields flex min-w-0 flex-col gap-4 border-t pt-6"
			>
				<Form.Legend variant="item">Exercice non noté {index + 1}</Form.Legend>
				<div class="grid gap-4 sm:grid-cols-2">
					<Form.Field {form} name={`studentContent.exercises[${index}].semester`}>
						<Form.Control id={`exercise-${exercise.id}-semester`}>
							{#snippet children({ props })}
								<Form.Label>Semestre de l’atelier</Form.Label>
								<NativeSelect.Root
									{...props}
									value={exercise.semester ?? ''}
									class="w-full"
									onchange={(event) => {
										const value = event.currentTarget.value;
										$data.studentContent.exercises[index].semester = value === 'S1' || value === 'S2' ? value : null;
									}}
								>
									<NativeSelect.Option value="">Aucun semestre</NativeSelect.Option>
									<NativeSelect.Option value="S1">Semestre 1</NativeSelect.Option>
									<NativeSelect.Option value="S2">Semestre 2</NativeSelect.Option>
								</NativeSelect.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					{#each $data.contexts as context, contextIndex (context.id)}
						{#if context.lessons.length}
							<Form.Field {form} name={`contexts[${contextIndex}].lessons`}>
								<Form.Control id={`exercise-${exercise.id}-lesson-${context.id}`}>
									{#snippet children({ props })}
										<Form.Label>Séance de l’atelier</Form.Label>
										<NativeSelect.Root
											{...props}
											class="w-full"
											value={context.lessons.find((lesson) => lesson.exerciseIds?.includes(exercise.id))?.id ?? ''}
											onchange={(event) => assignLesson(context.id, exercise.id, event.currentTarget.value)}
										>
											<NativeSelect.Option value="">Aucune séance</NativeSelect.Option>
											{#each context.lessons as lesson (lesson.id)}
												<NativeSelect.Option value={lesson.id}
													>{lesson.title || 'Séance sans intitulé'}{lesson.startsAt
														? ` · ${lesson.startsAt.replace('T', ' ')}`
														: ''}</NativeSelect.Option
												>
											{/each}
										</NativeSelect.Root>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						{/if}
					{/each}
				</div>
				<div class="exercise-workspace">
					<div class="exercise-prompt">
						<EditorFields
							{form}
							name={`studentContent.exercises[${index}].title`}
							id={`exercise-${exercise.id}-title`}
							label="Titre de l’exercice"
							required
							maxlength={200}
						/>
						<EditorFields
							{form}
							name={`studentContent.exercises[${index}].instructions`}
							id={`exercise-${exercise.id}-instructions`}
							label="Consigne"
							required={false}
							multiline
							maxlength={20000}
						/>
					</div>
					<div class="exercise-solution">
						<EditorFields
							{form}
							name={`studentContent.exercises[${index}].solution`}
							id={`exercise-${exercise.id}-solution`}
							label="Corrigé librement accessible"
							required={false}
							multiline
							maxlength={20000}
						/>
						<EditorFields
							{form}
							name={`studentContent.exercises[${index}].code`}
							id={`exercise-${exercise.id}-code`}
							label="Code du corrigé"
							required={false}
							multiline
							maxlength={20000}
						/>
					</div>
				</div>
				<StudentResourceChoices
					{form}
					name={`studentContent.exercises[${index}].resourceIds`}
					resources={$data.resources}
					selected={exercise.resourceIds ?? []}
					onchange={(ids) => {
						$data.studentContent.exercises[index].resourceIds = ids;
					}}
				/>
				<Button type="button" variant="destructive-outline" onclick={() => removeExercise(exercise.id)}
					>Retirer cet exercice</Button
				>
			</Form.Fieldset>
		{/each}
		<Button type="button" variant="outline" disabled={$data.studentContent.exercises.length >= 100} onclick={add}
			>Ajouter un exercice non noté</Button
		>
	</Field.FieldGroup>
</Form.Fieldset>

<style>
	.exercise-workspace {
		display: grid;
		gap: 1.5rem;
		min-width: 0;
	}
	.exercise-prompt,
	.exercise-solution {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	@media (min-width: 80rem) {
		.exercise-workspace {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 2rem;
		}
		.exercise-solution {
			padding-inline-start: 2rem;
			border-inline-start: 1px solid var(--border);
		}
	}

	:global(.exercise-fields > button) {
		align-self: flex-start;
	}
</style>
