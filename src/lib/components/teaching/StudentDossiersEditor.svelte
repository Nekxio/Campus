<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import type { EditorData } from '#lib/teaching/types.js';
	import type { ModuleEditorInput } from './module-editor-input.js';
	import EditorFields from './EditorFields.svelte';
	import StudentResourceChoices from './StudentResourceChoices.svelte';

	let {
		form,
		assessments
	}: {
		form: SuperForm<ModuleEditorInput, string>;
		assessments: NonNullable<EditorData['dossierAssessments']>;
	} = $props();
	const { form: data } = untrack(() => form);
	const dossiers = $derived($data.studentContent.dossiers ?? []);
	const available = $derived(
		assessments.filter((assessment) => !dossiers.some((dossier) => dossier.assessmentId === assessment.id))
	);
	let chosen = $state('');
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});
	const addDossier = () => {
		if (!available.some((assessment) => assessment.id === chosen)) return;
		$data.studentContent.dossiers = [...dossiers, { assessmentId: chosen, instructions: '', resourceIds: [] }];
		chosen = '';
	};
</script>

<Form.Fieldset {form} name="studentContent.dossiers" class="gap-4">
	<Form.Legend variant="item">Dossiers à remettre</Form.Legend>
	{#each dossiers as dossier, index (dossier.assessmentId)}
		<Form.Fieldset {form} name={`studentContent.dossiers[${index}]`} class="gap-4 border-t pt-4">
			<Form.Legend
				>{assessments.find((assessment) => assessment.id === dossier.assessmentId)?.title ??
					'Évaluation indisponible'}</Form.Legend
			>
			<EditorFields
				{form}
				name={`studentContent.dossiers[${index}].instructions`}
				id={`dossier-${dossier.assessmentId}-instructions`}
				label="Consignes du dossier"
				required={false}
				multiline
				maxlength={20000}
			/>
			<StudentResourceChoices
				{form}
				name={`studentContent.dossiers[${index}].resourceIds`}
				resources={$data.resources}
				selected={dossier.resourceIds}
				onchange={(ids) => {
					$data.studentContent.dossiers = dossiers.map((item) =>
						item.assessmentId === dossier.assessmentId ? { ...item, resourceIds: ids } : item
					);
				}}
			/>
			<Button
				type="button"
				variant="destructive-outline"
				class="self-start"
				onclick={() => {
					$data.studentContent.dossiers = dossiers.filter((item) => item.assessmentId !== dossier.assessmentId);
				}}>Retirer la fiche du dossier</Button
			>
			<Form.FieldErrors />
		</Form.Fieldset>
	{/each}
	{#if available.length && dossiers.length < 100}
		<Form.Control id="dossier-assessment">
			{#snippet children({ props })}
				<Form.Label>Évaluation du dossier</Form.Label>
				<div class="flex flex-wrap items-center gap-3">
					<NativeSelect.Root
						{...props}
						disabled={!ready}
						value={chosen}
						onchange={(event) => {
							chosen = event.currentTarget.value;
						}}
						class="w-full sm:w-auto"
					>
						<NativeSelect.Option value="">Choisir une évaluation</NativeSelect.Option>
						{#each available as assessment (assessment.id)}
							<NativeSelect.Option value={assessment.id}>{assessment.title}</NativeSelect.Option>
						{/each}
					</NativeSelect.Root>
					<Button type="button" variant="outline" disabled={!chosen} onclick={addDossier}>Ajouter le dossier</Button>
				</div>
			{/snippet}
		</Form.Control>
	{:else if assessments.length === 0 && dossiers.length === 0}
		<Form.Description>Enregistrez un barème d’évaluation pour lui associer une fiche de dossier.</Form.Description>
	{/if}
	<Form.FieldErrors />
</Form.Fieldset>
