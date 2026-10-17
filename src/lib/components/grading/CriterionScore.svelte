<script lang="ts">
	import { fromStore } from 'svelte/store';
	import { formFieldProxy, type SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { RubricAssessment } from '#lib/domain/grading.js';
	import type { CorrectionDraft } from '#lib/grading/correction-form.js';
	let {
		form,
		assessmentIndex,
		scoreIndex,
		line,
		disabled
	}: {
		form: SuperForm<CorrectionDraft, string>;
		assessmentIndex: number;
		scoreIndex: number;
		line: RubricAssessment['lines'][number];
		disabled: boolean;
	} = $props();
	const name = $derived(`assessments[${assessmentIndex}].scores[${scoreIndex}].points` as const);
	const proxy = $derived(formFieldProxy(form, name));
	const value = $derived(fromStore(proxy.value));
	function update(raw: string) {
		const field = formFieldProxy(form, name);
		field.value.set(raw);
	}
</script>

<Form.ElementField {form} {name} class="flex min-w-0 flex-col gap-1 border-b px-3 py-2">
	{#snippet children({ errors })}
		<Field.Field data-invalid={errors.length > 0} data-disabled={disabled} class="gap-0">
			<Form.Control id={`score-${line.id}`}>
				{#snippet children({ props })}
					<div class="criterion-control">
						<div class="criterion-copy">
							<Form.Label>{line.label}</Form.Label>
							<Form.Description
								>{line.description}<span class="sr-only">
									Maximum : {line.maxPoints} points. Saisissez un entier entre zéro et {line.maxPoints}.
									Un champ vide reste non noté.</span
								></Form.Description
							>
						</div>
						<div class="flex shrink-0 items-center gap-2 tabular-nums">
							<Input
								{...props}
								{name}
								type="text"
								inputmode="numeric"
								value={value.current}
								{disabled}
								density="compact"
								class="w-16 text-center"
								oninput={(event) => update(event.currentTarget.value)}
								onchange={() => form.validate(name, { update: 'errors' })}
							/>
							<span class="text-sm text-muted-foreground"
								>/ {line.maxPoints}<span class="sr-only"> points</span></span
							>
						</div>
					</div>
				{/snippet}
			</Form.Control>
			{#if errors.length}<Form.FieldErrors class="pt-1" />{/if}
		</Field.Field>
	{/snippet}
</Form.ElementField>

<style>
	.criterion-control {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
	}
	.criterion-copy {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (min-width: 80rem) {
		.criterion-copy {
			flex-direction: row;
			align-items: baseline;
			gap: 1.25rem;
		}
		.criterion-copy :global([data-slot='form-label']) {
			min-width: 11rem;
			flex-shrink: 0;
			max-width: 18rem;
		}
	}
	@media (max-width: 30rem) {
		.criterion-control {
			align-items: start;
		}
	}
</style>
