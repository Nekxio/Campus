<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { ModuleEditorInput } from './module-editor-input.js';
	import EditorFields from './EditorFields.svelte';
	let { form }: { form: SuperForm<ModuleEditorInput, string> } = $props();
	const { form: data } = untrack(() => form);
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
		{#each $data.studentContent.exercises as exercise, index (exercise.id)}
			<Form.Fieldset
				{form}
				name={`studentContent.exercises[${index}]`}
				class="exercise-fields flex min-w-0 flex-col gap-4 border-t pt-6"
			>
				<Form.Legend variant="item">Exercice non noté {index + 1}</Form.Legend>
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
				<Button
					type="button"
					variant="destructive-outline"
					onclick={() =>
						data.update((value) => ({
							...value,
							studentContent: {
								...value.studentContent,
								exercises: value.studentContent.exercises.filter((item) => item.id !== exercise.id)
							}
						}))}>Retirer cet exercice</Button
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
