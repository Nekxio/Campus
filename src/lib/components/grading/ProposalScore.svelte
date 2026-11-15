<script lang="ts">
	import { fromStore } from 'svelte/store';
	import { formFieldProxy, type SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { RubricAssessment } from '#lib/domain/grading.js';
	import type { ProposalPointsDraft } from '#lib/grading/proposal-form.js';
	import { proposedPointsDiffer } from '#lib/grading/proposal-comparison.js';
	let {
		form,
		index,
		line,
		recorded,
		proposed,
		initial,
		required,
		disabled
	}: {
		form: SuperForm<ProposalPointsDraft, string>;
		index: number;
		line: RubricAssessment['lines'][number];
		recorded: number | null;
		proposed: number | null | undefined;
		initial: string;
		required: boolean;
		disabled: boolean;
	} = $props();
	const name = $derived(`scores[${index}].points` as const);
	const proxy = $derived(formFieldProxy(form, name));
	const value = $derived(fromStore(proxy.value));
	const adjusted = $derived(value.current !== initial);
	const proposedDifferent = $derived(proposedPointsDiffer(recorded, proposed));
	function update(raw: string) {
		formFieldProxy(form, name).value.set(raw);
	}
</script>

<div role="row" class="proposal-score min-w-0 border-b">
	<Form.ElementField {form} {name} role="presentation">
		{#snippet children({ errors })}
			<Field.Field
				role="presentation"
				data-invalid={errors.length > 0}
				data-disabled={disabled}
				class="comparison-line min-w-0 gap-0"
			>
				<Form.Control id={`proposal-score-${line.id}`}>
					{#snippet children({ props })}
						<div role="rowheader" class="criterion-name flex min-w-0 flex-wrap items-center gap-2">
							<Form.Label
								>{line.label}{required ? '' : ' (optionnel)'}<span class="sr-only">, points retenus</span></Form.Label
							>
							{#if proposedDifferent}<Badge variant="secondary" class="h-auto max-w-full whitespace-normal"
									>Points proposés différents</Badge
								>{/if}
							{#if adjusted}<Badge variant="outline">Ajusté</Badge>{/if}
						</div>
						<div role="cell" class="criterion-description min-w-0">
							<Form.Description>
								{line.description}
								<span class="sr-only"
									>Maximum : {line.maxPoints} points. Saisissez un entier entre zéro et {line.maxPoints}. Un champ vide
									reste non noté.</span
								>
							</Form.Description>
						</div>
						<div role="cell" class="comparison-value tabular-nums">
							<span class="mobile-label text-xs text-muted-foreground">Enregistré</span>
							<span
								>{recorded ?? 'N/D'}
								<span class="text-xs text-muted-foreground">/ {line.maxPoints}</span></span
							>
						</div>
						<div role="cell" class="comparison-value tabular-nums">
							<span class="mobile-label text-xs text-muted-foreground">Proposé</span>
							{#if proposed === undefined}<span class="text-xs text-muted-foreground">Non proposé</span>
							{:else}<span class={proposedDifferent ? 'font-semibold' : undefined}
									>{proposed ?? 'N/D'}
									<span class="text-xs text-muted-foreground">/ {line.maxPoints}</span></span
								>{/if}
						</div>
						<div role="cell" class="retained-value comparison-value tabular-nums">
							<span class="mobile-label text-xs text-muted-foreground">Retenu</span>
							<div class="flex flex-wrap items-center gap-2">
								<Input
									{...props}
									{required}
									aria-required={required || undefined}
									{name}
									type="text"
									inputmode="numeric"
									autocomplete="off"
									value={value.current}
									{disabled}
									density="compact"
									class="w-16 text-center"
									oninput={(event) => update(event.currentTarget.value)}
									onchange={() => form.validate(name, { update: 'errors' })}
								/>
								<span class="text-xs text-muted-foreground">/ {line.maxPoints}</span>
							</div>
						</div>
					{/snippet}
				</Form.Control>
				{#if errors.length}<div role="cell" class="line-errors"><Form.FieldErrors /></div>{/if}
			</Field.Field>
		{/snippet}
	</Form.ElementField>
</div>

<style>
	.proposal-score {
		padding: 1rem 0.5rem;
	}
	.proposal-score:nth-child(even) {
		background: color-mix(in oklab, var(--muted) 45%, var(--card));
	}
	.proposal-score:focus-within {
		background: var(--accent);
	}
	.proposal-score :global(.comparison-line) {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		align-items: center;
		gap: 0.75rem;
	}
	.criterion-name,
	.criterion-description,
	.line-errors {
		grid-column: 1 / -1;
		overflow-wrap: anywhere;
	}
	.comparison-value {
		display: flex;
		flex-direction: column;
		align-items: start;
		gap: 0.25rem;
		font-size: 0.875rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.retained-value {
		align-self: start;
	}
	@container comparison (min-width: 41rem) {
		.proposal-score {
			padding-block: 0;
		}
		.proposal-score :global(.comparison-line) {
			grid-template-columns:
				minmax(7rem, 1.3fr) minmax(8rem, 2fr) repeat(2, minmax(4rem, 0.8fr))
				minmax(6rem, 1fr);
			gap: 0.75rem;
			min-height: 2.75rem;
		}
		.criterion-name,
		.criterion-description {
			grid-column: auto;
		}
		.comparison-value {
			align-items: center;
		}
		.retained-value {
			align-self: center;
		}
		.mobile-label {
			display: none;
		}
		.line-errors {
			padding-block: 0.25rem 0.75rem;
		}
	}
	@media (pointer: coarse) {
		.retained-value :global([data-slot='input']) {
			font-size: 1rem;
		}
	}
</style>
