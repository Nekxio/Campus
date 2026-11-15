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
		absent,
		required,
		disabled
	}: {
		form: SuperForm<CorrectionDraft, string>;
		assessmentIndex: number;
		scoreIndex: number;
		line: RubricAssessment['lines'][number];
		absent: boolean;
		required: boolean;
		disabled: boolean;
	} = $props();
	const name = $derived(`assessments[${assessmentIndex}].scores[${scoreIndex}].points` as const);
	const proxy = $derived(formFieldProxy(form, name));
	const value = $derived(fromStore(proxy.value));
	const fieldErrors = $derived(fromStore(proxy.errors));
	$effect(() => {
		if (absent) proxy.errors.set(undefined);
	});
	const update = (raw: string) => {
		const field = formFieldProxy(form, name);
		field.value.set(raw);
		if (fieldErrors.current?.length) void form.validate(name, { update: 'errors' });
	};
</script>

<Form.ElementField {form} {name} class="criterion-score flex min-w-0 flex-col gap-1 border-b px-3 py-3">
	{#snippet children({ errors })}
		<Field.Field data-invalid={errors.length > 0} data-disabled={disabled} class="gap-0">
			<Form.Control id={`score-${line.id}`}>
				{#snippet children({ props })}
					<div class="criterion-control">
						<div class="criterion-copy">
							<Form.Label>{line.label}{required ? '' : ' (optionnel)'}</Form.Label>
							<Form.Description
								>{line.description}<span class="sr-only">
									Maximum : {line.maxPoints} points. Saisissez un entier entre zéro et {line.maxPoints}. Un champ vide
									reste non noté.</span
								></Form.Description
							>
						</div>
						<div class="flex shrink-0 items-center gap-2 tabular-nums">
							<Input
								{...props}
								{required}
								aria-required={required || undefined}
								{name}
								type="text"
								inputmode="numeric"
								value={value.current}
								{disabled}
								class="h-11 min-h-11 w-16 text-center sm:h-9 sm:min-h-9"
								oninput={(event) => update(event.currentTarget.value)}
								onblur={() => form.validate(name, { update: 'errors' })}
							/>
							<span class="text-sm text-muted-foreground">/ {line.maxPoints}<span class="sr-only"> points</span></span>
						</div>
					</div>
				{/snippet}
			</Form.Control>
			{#if errors.length}<Form.FieldErrors class="pt-1" />{/if}
		</Field.Field>
	{/snippet}
</Form.ElementField>

<style>
	:global(.criterion-score:nth-child(even)) {
		background: color-mix(in oklab, var(--muted) 45%, var(--card));
	}
	:global(.criterion-score:focus-within) {
		background: var(--accent);
	}
	.criterion-control {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-width: 0;
		max-width: 48rem;
	}
	.criterion-copy {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (min-width: 80rem) {
		.criterion-copy {
			gap: 0.25rem;
		}
		.criterion-copy :global([data-slot='form-label']) {
			min-width: 0;
			flex-shrink: 0;
			max-width: 42rem;
		}
	}
	@media (max-width: 30rem) {
		.criterion-control {
			align-items: start;
		}
	}
</style>
