<script lang="ts">
	import { fromStore } from 'svelte/store';
	import { formFieldProxy, type FormPathLeaves, type SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import type { RubricEditorInput } from '#lib/grading/rubric-form.js';

	let {
		form,
		name,
		id,
		label,
		description = '',
		multiline = false,
		compact = false,
		hideLabel = false,
		type = 'text',
		maxlength,
		min,
		max,
		step = 1,
		options,
		onvaluechange
	}: {
		form: SuperForm<RubricEditorInput, string>;
		name: FormPathLeaves<RubricEditorInput, string | number>;
		id: string;
		label: string;
		description?: string;
		multiline?: boolean;
		compact?: boolean;
		hideLabel?: boolean;
		type?: 'text' | 'number' | 'datetime-local';
		maxlength?: number;
		min?: number;
		max?: number;
		step?: number;
		options?: { value: string; label: string }[];
		onvaluechange?: (value: string) => void;
	} = $props();
	const proxy = $derived(
		formFieldProxy<RubricEditorInput, typeof name, string | number>(form, name)
	);
	const value = $derived(fromStore(proxy.value));
	function update(next: string) {
		proxy.value.set(type === 'number' ? (next === '' ? Number.NaN : Number(next)) : next);
		onvaluechange?.(next);
	}
	async function validate() {
		await form.validate(name, { update: 'errors' });
	}
</script>

<Form.Field {form} {name} class="min-w-0">
	{#snippet children({ errors })}
		<div class="flex min-w-0 flex-col gap-2" data-invalid={errors.length > 0}>
			<Form.Control {id}>
				{#snippet children({ props })}
					<Form.Label class={hideLabel ? 'sr-only' : compact ? 'compact-label' : ''}
						>{label}</Form.Label
					>
					{#if options}
						<NativeSelect.Root
							{...props}
							{name}
							value={String(value.current)}
							class="w-full"
							size={compact ? 'sm' : 'default'}
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
							{...props}
							{name}
							value={String(value.current)}
							{maxlength}
							class="min-h-24"
							oninput={(event) => update(event.currentTarget.value)}
							onchange={validate}
						/>
					{:else if type === 'number'}
						<Input
							{...props}
							{name}
							type="number"
							value={Number.isFinite(value.current) ? Number(value.current) : undefined}
							{min}
							{max}
							{step}
							inputmode={step === 1 ? 'numeric' : 'decimal'}
							density={compact || hideLabel ? 'compact' : 'default'}
							oninput={(event) => update(event.currentTarget.value)}
							onchange={validate}
						/>
					{:else}
						<Input
							{...props}
							{name}
							{type}
							value={String(value.current)}
							{maxlength}
							density={compact || hideLabel ? 'compact' : 'default'}
							oninput={(event) => update(event.currentTarget.value)}
							onchange={validate}
						/>
					{/if}
				{/snippet}
			</Form.Control>
			{#if description}<Form.Description>{description}</Form.Description>{/if}
			<Form.FieldErrors />
		</div>
	{/snippet}
</Form.Field>

<style>
	:global(.compact-label) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@container criteria (max-width: 35rem) {
		:global(.compact-label) {
			position: static;
			width: auto;
			height: auto;
			margin: 0;
			overflow: visible;
			clip: auto;
			white-space: normal;
		}
	}
</style>
