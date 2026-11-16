<script lang="ts">
	import SectionHeader from '#lib/components/shared/SectionHeader.svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import type { ModuleEditorInput } from './module-editor-input.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import EditorFields from './EditorFields.svelte';
	import LinkEditor from './LinkEditor.svelte';
	let {
		form,
		referencesOpen = $bindable(false),
		privateReferenceCount,
		retainActionPointer
	}: {
		form: SuperForm<ModuleEditorInput, string>;
		referencesOpen: boolean;
		privateReferenceCount: number;
		retainActionPointer: (event: PointerEvent) => void;
	} = $props();
</script>

<SectionHeader
	title="Notes privées"
	description="Vos notes et références de travail restent dans l’espace enseignant."
/>
<Field.FieldGroup class="mt-6 gap-6">
	<EditorFields
		id="module-framing"
		label="Cadrage pédagogique"
		required={false}
		multiline
		compact
		{form}
		name="preparation.framing"
		maxlength={20000}
	/>
	<EditorFields
		id="module-nextSteps"
		label="Prochaines étapes"
		required={false}
		multiline
		compact
		{form}
		name="preparation.nextSteps"
		maxlength={20000}
	/>
	<details bind:open={referencesOpen} class="private-references group min-w-0">
		<summary
			class="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			onpointerdown={retainActionPointer}
		>
			<span class="font-medium">Dossier et références privées</span>
			<span class="text-xs text-muted-foreground">
				{privateReferenceCount
					? `${privateReferenceCount} élément${privateReferenceCount > 1 ? 's' : ''} renseigné${privateReferenceCount > 1 ? 's' : ''}`
					: 'Facultatifs'}
			</span>
			<ChevronDownIcon
				class="ml-auto size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
				aria-hidden="true"
			/>
		</summary>
		<Field.FieldGroup class="mt-4 gap-6">
			<EditorFields
				id="module-sourcePath"
				label="Dossier source local"
				required={false}
				{form}
				name="sourcePath"
				maxlength={2000}
				description="Une référence textuelle privée vers votre dossier de travail. Campus n’ouvre pas les fichiers de votre ordinateur."
			/>
			<LinkEditor {form} />
		</Field.FieldGroup>
	</details>
</Field.FieldGroup>

<style>
	.private-references {
		padding-block-start: 1.5rem;
		border-block-start: 1px solid var(--border);
	}
</style>
