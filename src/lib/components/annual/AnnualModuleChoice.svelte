<script lang="ts">
	import { fromStore } from 'svelte/store';
	import { formFieldProxy, type SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import type { AnnualAction } from '#lib/domain/annual.js';
	let {
		form,
		index,
		moduleId,
		title,
		disabled
	}: {
		form: SuperForm<AnnualAction>;
		index: number;
		moduleId: string;
		title: string;
		disabled: boolean;
	} = $props();
	const name = $derived(`moduleChoices[${index}].decision` as const);
	const proxy = $derived(formFieldProxy(form, name));
	const decision = $derived(fromStore(proxy.value));
</script>

<Form.Field {form} {name} class="annual-module-choice min-w-0">
	<Form.Control id={`annual-module-${moduleId}`}>
		{#snippet children({ props })}
			<Form.Label class="min-w-0 wrap-anywhere">{title}</Form.Label>
			<NativeSelect.Root
				{...props}
				{name}
				class="w-full"
				value={decision.current}
				{disabled}
				onchange={(event) => {
					const value = event.currentTarget.value;
					if (value === 'continue' || value === 'pause') proxy.value.set(value);
					void form.validate(name, { update: 'errors' });
				}}
			>
				<NativeSelect.Option value="pause">Mettre de côté · privé, lien public désactivé</NativeSelect.Option>
				<NativeSelect.Option value="continue">Reprendre · conserver le lien public</NativeSelect.Option>
			</NativeSelect.Root>
		{/snippet}
	</Form.Control>
	<Form.Description
		>Le contenu pédagogique est toujours conservé. La reprise ne copie aucun étudiant, score ou calendrier.</Form.Description
	>
	<Form.FieldErrors />
</Form.Field>

<style>
	:global(.annual-module-choice) {
		padding-block: 1rem;
		border-block-start: 1px solid var(--border);
	}
</style>
