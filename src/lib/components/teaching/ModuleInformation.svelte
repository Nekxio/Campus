<script lang="ts">
	import type { Snippet } from 'svelte';
	import SectionHeader from '#lib/components/shared/SectionHeader.svelte';
	import * as Field from '#lib/components/ui/field/index.js';
	let {
		moduleId,
		moduleName,
		optionalInformation
	}: {
		moduleId: string | null;
		moduleName: Snippet;
		optionalInformation: Snippet<[boolean]>;
	} = $props();
</script>

<SectionHeader
	title="Informations"
	description={moduleId
		? 'Ces informations identifient le module et peuvent être publiées après vérification.'
		: 'Seul le nom est nécessaire pour créer le brouillon.'}
/>
<div class="mt-6 min-w-0">
	<Field.FieldGroup class="min-w-0 gap-6">
		{@render moduleName()}
		{@render optionalInformation(false)}
	</Field.FieldGroup>
</div>
