<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { ModuleEditorInput } from './ModuleDraftEditor.svelte';
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

<Form.Fieldset {form} name="studentContent" class="flex flex-col gap-6">
	<Form.Legend>Consignes et exercices publics</Form.Legend>
	<Form.Description
		>Ces contenus seront accessibles avec leurs corrigés après votre publication, sans compte ni
		verrou de date. Les quiz Wayground restent externes.</Form.Description
	>
	<Field.FieldGroup class="gap-6">
		<EditorFields
			{form}
			name="studentContent.instructions"
			id="module-instructions"
			label="Consignes du module"
			multiline
			maxlength={20000}
		/>
		<EditorFields
			{form}
			name="studentContent.projectInstructions"
			id="project-instructions"
			label="Consignes du projet, si pertinent"
			multiline
			maxlength={20000}
		/>
		{#each $data.studentContent.exercises as exercise, index (exercise.id)}
			<Form.Fieldset
				{form}
				name={`studentContent.exercises[${index}]`}
				class="flex flex-col gap-4 border-t pt-5"
			>
				<Form.Legend>Exercice non noté {index + 1}</Form.Legend>
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
					multiline
					maxlength={20000}
				/>
				<EditorFields
					{form}
					name={`studentContent.exercises[${index}].solution`}
					id={`exercise-${exercise.id}-solution`}
					label="Corrigé librement accessible"
					multiline
					maxlength={20000}
				/>
				<EditorFields
					{form}
					name={`studentContent.exercises[${index}].code`}
					id={`exercise-${exercise.id}-code`}
					label="Code du corrigé (facultatif)"
					multiline
					maxlength={20000}
				/>
				<Button
					type="button"
					variant="outline"
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
		<Button
			type="button"
			variant="outline"
			disabled={$data.studentContent.exercises.length >= 100}
			onclick={add}>Ajouter un exercice non noté</Button
		>
	</Field.FieldGroup>
</Form.Fieldset>
