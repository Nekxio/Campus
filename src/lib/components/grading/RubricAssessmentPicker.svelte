<script lang="ts">
	import { fromStore } from 'svelte/store';
	import { arrayProxy, type FormPathArrays, type SuperForm } from 'sveltekit-superforms';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import type { RubricEditorInput } from '#lib/grading/rubric-form.js';

	let {
		form,
		name,
		assessments,
		label = 'Sections comptabilisées'
	}: {
		form: SuperForm<RubricEditorInput, string>;
		name: FormPathArrays<RubricEditorInput, string[]>;
		assessments: RubricEditorInput['assessments'];
		label?: string;
	} = $props();
	const helpId = $props.id();
	const proxy = $derived(arrayProxy(form, name));
	const values = $derived(fromStore(proxy.values));
	async function validateSelection() {
		const checkedDraft = JSON.stringify(form.capture().data);
		const validated = await form.validateForm({ update: false, focusOnError: false });
		if (JSON.stringify(form.capture().data) === checkedDraft) form.errors.set(validated.errors);
	}
	function toggle(id: string, checked: boolean) {
		proxy.values.set(checked ? [...values.current, id] : values.current.filter((value) => value !== id));
		void validateSelection();
	}
</script>

<Form.Fieldset {form} {name} aria-describedby={helpId} class="flex min-w-0 flex-col gap-2">
	<Form.Legend class="text-sm">{label}</Form.Legend>
	<Field.FieldGroup class="assessment-options gap-0">
		{#each assessments as assessment (assessment.id)}
			{@const selected = values.current.includes(assessment.id)}
			<Field.Field orientation="horizontal" class="min-h-11 gap-3">
				<Form.Control>
					{#snippet children({ props })}
						<Checkbox
							{...props}
							{name}
							value={assessment.id}
							checked={selected}
							disabled={assessment.purpose === 'formative' && !selected}
							onCheckedChange={(checked) => toggle(assessment.id, checked)}
						/>
						<Form.Label class="min-w-0 flex-1 leading-relaxed break-words">
							{assessment.title || 'Section sans nom'}
							<span class="text-muted-foreground"
								>{assessment.purpose === 'formative'
									? ' · formative'
									: assessment.kind === 'quiz'
										? ' · quiz à poids égal'
										: ` · maximum brut : ${assessment.lines.reduce((sum, line) => sum + (Number.isFinite(line.maxPoints) ? line.maxPoints : 0), 0)} pts`}</span
							>
						</Form.Label>
					{/snippet}
				</Form.Control>
			</Field.Field>
		{:else}<p class="text-sm text-muted-foreground">Ajoutez d’abord une section.</p>{/each}
	</Field.FieldGroup>
	<Form.Description id={helpId}>Les sections formatives restent hors résultats.</Form.Description>
	<Form.FieldErrors />
</Form.Fieldset>

<style>
	:global(.assessment-options) {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
	}
	:global(.assessment-options > [data-slot='field']) {
		padding: 0.75rem 0.75rem;
	}
	:global(.assessment-options > [data-slot='field'] + [data-slot='field']) {
		border-top: 1px solid var(--border);
	}
	:global(.assessment-options > [data-slot='field']:has([data-state='checked'])) {
		background: var(--accent);
	}
	:global(.assessment-options > [data-slot='field']:focus-within) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
</style>
