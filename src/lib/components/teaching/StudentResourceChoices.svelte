<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import type { ModuleEditorInput } from './module-editor-input.js';

	let {
		form,
		name,
		resources,
		selected,
		onchange
	}: {
		form: SuperForm<ModuleEditorInput, string>;
		name: `studentContent.exercises[${number}].resourceIds` | `studentContent.dossiers[${number}].resourceIds`;
		resources: ModuleEditorInput['resources'];
		selected: string[];
		onchange: (ids: string[]) => void;
	} = $props();
</script>

{#if resources.length}
	<Form.Fieldset {form} {name}>
		<Form.Legend>Fichiers et liens associés</Form.Legend>
		{#each resources as resource (resource.id)}
			<Form.Control id={`${name}-${resource.id}`}>
				{#snippet children({ props })}
					<div class="flex min-h-11 items-center gap-3">
						<Checkbox
							{...props}
							checked={selected.includes(resource.id)}
							onCheckedChange={(checked) =>
								onchange(checked ? [...selected, resource.id] : selected.filter((id) => id !== resource.id))}
						/>
						<Form.Label>{resource.label || 'Support sans intitulé'}</Form.Label>
					</div>
				{/snippet}
			</Form.Control>
		{/each}
		<Form.FieldErrors />
	</Form.Fieldset>
{/if}
