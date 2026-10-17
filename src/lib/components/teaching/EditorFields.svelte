<script lang="ts">
	import { fromStore } from 'svelte/store';
	import { formFieldProxy, type FormPathLeaves, type SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import type { ModuleEditorInput } from './ModuleDraftEditor.svelte';

	let {
		form,
		name,
		id,
		label,
		description = '',
		multiline = false,
		required = false,
		maxlength,
		type = 'text',
		options,
		element = false
	}: {
		form: SuperForm<ModuleEditorInput, string>;
		name: FormPathLeaves<ModuleEditorInput, string>;
		id: string;
		label: string;
		description?: string;
		multiline?: boolean;
		required?: boolean;
		maxlength?: number;
		type?: 'text' | 'url' | 'datetime-local';
		options?: readonly { value: string; label: string }[];
		element?: boolean;
	} = $props();
	// Formsnap's snippet value uses a top-level lookup; the typed proxy resolves nested paths.
	// Recreate it when deleting an earlier row changes this field's array index.
	const proxy = $derived(
		formFieldProxy<ModuleEditorInput, FormPathLeaves<ModuleEditorInput, string>, string>(form, name)
	);
	const fieldValue = $derived(fromStore(proxy.value));
	function updateValue(value: string) {
		proxy.value.set(value);
	}
	const FieldComponent = $derived(element ? Form.ElementField : Form.Field);

	async function validateField() {
		await form.validate(name, { update: 'errors' });
	}
</script>

<FieldComponent {form} {name} class="flex flex-col gap-2">
	{#snippet children({ errors })}
		<div class="flex flex-col gap-2" data-invalid={errors.length > 0}>
			<Form.Control {id}>
				{#snippet children({ props })}
					<Form.Label>{label}{required ? ' (obligatoire)' : ''}</Form.Label>
					{#if options}
						<NativeSelect.Root
							{...props}
							{name}
							value={fieldValue.current}
							class="w-full"
							onchange={(event) => {
								updateValue(event.currentTarget.value);
								void validateField();
							}}
						>
							{#each options as option (option.value)}<NativeSelect.Option value={option.value}
									>{option.label}</NativeSelect.Option
								>{/each}
						</NativeSelect.Root>
					{:else if multiline}
						<Textarea
							{...props}
							{name}
							value={fieldValue.current}
							{required}
							{maxlength}
							class="min-h-28"
							oninput={(event) => updateValue(event.currentTarget.value)}
							onchange={validateField}
						/>
					{:else}
						<Input
							{...props}
							{name}
							{type}
							value={fieldValue.current}
							{required}
							{maxlength}
							oninput={(event) => updateValue(event.currentTarget.value)}
							onchange={validateField}
						/>
					{/if}
				{/snippet}
			</Form.Control>
			{#if description}<Form.Description>{description}</Form.Description>{/if}
			<Form.FieldErrors />
		</div>
	{/snippet}
</FieldComponent>
