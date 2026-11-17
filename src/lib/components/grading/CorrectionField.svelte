<script lang="ts" generics="T extends Record<string, unknown>">
	import { fromStore } from 'svelte/store';
	import { formFieldProxy, type FormPathLeaves, type SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	let {
		form,
		name,
		id,
		label,
		description = '',
		type = 'text',
		multiline = false,
		options,
		disabled = false,
		required,
		maxlength,
		formId
	}: {
		form: SuperForm<T, string>;
		name: FormPathLeaves<T, string>;
		id: string;
		label: string;
		description?: string;
		type?: 'text' | 'url' | 'datetime-local';
		multiline?: boolean;
		options?: readonly { value: string; label: string }[];
		disabled?: boolean;
		required?: boolean;
		maxlength?: number;
		formId?: string;
	} = $props();
	const proxy = $derived(formFieldProxy<T, FormPathLeaves<T, string>, string>(form, name));
	const value = $derived(fromStore(proxy.value));
	const fieldErrors = $derived(fromStore(proxy.errors));
	const validate = async () => {
		await form.validate(name, { update: 'errors' });
	};
	const update = (raw: string) => {
		const field = formFieldProxy<T, FormPathLeaves<T, string>, string>(form, name);
		field.value.set(raw);
		if (fieldErrors.current?.length) void validate();
	};
</script>

<Form.Field {form} {name} class="flex min-w-0 flex-col gap-1">
	{#snippet children({ errors })}
		<Field.Field data-invalid={errors.length > 0} data-disabled={disabled} class="gap-1">
			<Form.Control {id}>
				{#snippet children({ props })}
					{@const controlProps = {
						...props,
						'aria-required': required === undefined ? props['aria-required'] : required || undefined
					}}
					<Form.Label>{label}{required === false ? ' (optionnel)' : ''}</Form.Label>
					{#if options}
						<NativeSelect.Root
							{...controlProps}
							form={formId}
							{name}
							{disabled}
							{required}
							value={value.current}
							class="w-full"
							onchange={(event) => {
								update(event.currentTarget.value);
								void validate();
							}}
						>
							{#each options as option (option.value)}<NativeSelect.Option value={option.value}
									>{option.label}</NativeSelect.Option
								>{/each}
						</NativeSelect.Root>
					{:else if multiline}
						<Textarea
							{...controlProps}
							form={formId}
							{name}
							{disabled}
							{required}
							{maxlength}
							value={value.current}
							class="min-h-28"
							oninput={(event) => update(event.currentTarget.value)}
							onblur={validate}
						/>
					{:else}
						<Input
							{...controlProps}
							form={formId}
							{name}
							{type}
							{disabled}
							{required}
							{maxlength}
							value={value.current}
							oninput={(event) => update(event.currentTarget.value)}
							onblur={validate}
						/>
					{/if}
				{/snippet}
			</Form.Control>
			{#if description}<Form.Description>{description}</Form.Description>{/if}
			{#if errors.length}<Form.FieldErrors />{/if}
		</Field.Field>
	{/snippet}
</Form.Field>
