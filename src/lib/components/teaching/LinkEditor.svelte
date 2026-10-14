<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import type { ModuleEditorInput } from './ModuleDraftEditor.svelte';
	import EditorFields from './EditorFields.svelte';

	let { form, student = false }: { form: SuperForm<ModuleEditorInput, string>; student?: boolean } =
		$props();
	// The keyed editor owns one stable Superform instance for its lifetime.
	const { form: formData } = untrack(() => form);
	// Fresh display snapshots propagate child-field writes from the Superforms store.
	const rows = $derived(
		(student ? $formData.resources : $formData.preparation.sourceLinks).map(({ id, label }) => ({
			id,
			label
		}))
	);
	const prefix = $derived(student ? 'resources' : 'preparation.sourceLinks');
	const limit = $derived(student ? 200 : 100);
	const kinds = [
		{ value: 'course', label: 'Cours' },
		{ value: 'instructions', label: 'Consignes' },
		{ value: 'rubric', label: 'Grille d’évaluation' },
		{ value: 'resource', label: 'Ressource' }
	];
	function addLink() {
		if (rows.length >= limit) return;
		const row = { id: crypto.randomUUID(), label: '', url: '' };
		formData.update((data) =>
			student
				? { ...data, resources: [...data.resources, { ...row, kind: 'resource' }] }
				: {
						...data,
						preparation: {
							...data.preparation,
							sourceLinks: [...data.preparation.sourceLinks, row]
						}
					}
		);
	}
	function removeLink(id: string) {
		formData.update((data) =>
			student
				? { ...data, resources: data.resources.filter((row) => row.id !== id) }
				: {
						...data,
						preparation: {
							...data.preparation,
							sourceLinks: data.preparation.sourceLinks.filter((row) => row.id !== id)
						}
					}
		);
		// Revalidate after structural edits so indexed errors follow the current rows.
		void form.validateForm({ update: true, focusOnError: false });
	}
</script>

<Form.Fieldset {form} name={prefix} class="flex min-w-0 flex-col gap-6">
	<Form.Legend class={student ? 'sr-only' : ''}
		>{student ? 'Liens étudiants' : 'Références privées'}</Form.Legend
	>
	{#if !student}<Form.Description
			>Des liens HTTPS vers vos documents de préparation.</Form.Description
		>{/if}
	{#if rows.length === 0}
		<Empty.Root class="border border-dashed py-7">
			<Empty.Header>
				<Empty.Title>{student ? 'Aucun lien étudiant' : 'Aucune référence privée'}</Empty.Title>
				<Empty.Description
					>{student
						? 'Ajoutez les supports choisis pour ce module.'
						: 'Ajoutez un lien vers vos documents de préparation si nécessaire.'}</Empty.Description
				>
			</Empty.Header>
		</Empty.Root>
	{/if}
	{#each rows as row, index (row.id)}
		<section class="flex min-w-0 flex-col gap-4" aria-labelledby={`${row.id}-heading`}>
			<div class="flex items-center justify-between gap-3">
				<h3
					id={`${row.id}-heading`}
					class="min-w-0 text-base font-semibold [overflow-wrap:anywhere]"
				>
					{row.label || (student ? 'Nouveau support' : 'Nouvelle référence')}
				</h3>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-11 shrink-0"
					aria-label={`Retirer ${row.label || 'ce lien'}`}
					onclick={() => removeLink(row.id)}><TrashIcon aria-hidden="true" /></Button
				>
			</div>
			<div class="flex flex-col gap-4">
				<EditorFields
					{form}
					name={`${prefix}[${index}].label`}
					id={`${row.id}-label`}
					label="Intitulé"
					required
					maxlength={200}
					element
				/>
				<EditorFields
					{form}
					name={`${prefix}[${index}].url`}
					id={`${row.id}-url`}
					label="Lien HTTPS"
					type="url"
					required
					description="Collez le lien de partage du document choisi."
					element
				/>
				{#if student}<EditorFields
						{form}
						name={`resources[${index}].kind`}
						id={`${row.id}-kind`}
						label="Type de support"
						options={kinds}
						element
					/>{/if}
			</div>
		</section>
		<Separator />
	{/each}
	<Form.FieldErrors />
	<div class="flex flex-wrap items-center gap-3">
		<Button
			type="button"
			variant="outline"
			class="min-h-11"
			disabled={rows.length >= limit}
			onclick={addLink}
			><PlusIcon data-icon="inline-start" aria-hidden="true" />{student
				? 'Ajouter un support'
				: 'Ajouter une référence'}</Button
		>
		{#if rows.length >= limit}<p class="text-sm text-muted-foreground">
				Limite de {limit} liens atteinte.
			</p>{/if}
	</div>
</Form.Fieldset>
