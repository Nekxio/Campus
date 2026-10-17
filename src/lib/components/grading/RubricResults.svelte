<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import type { RubricEditorInput } from '#lib/grading/rubric-form.js';
	import type { RubricAssessment } from '#lib/domain/grading.js';
	import RubricField from './RubricField.svelte';
	import RubricAssessmentPicker from './RubricAssessmentPicker.svelte';

	let {
		form,
		assessment
	}: { form: SuperForm<RubricEditorInput, string>; assessment?: RubricAssessment } = $props();
	const { form: formData } = untrack(() => form);
	const assessments = $derived(
		$formData.assessments.map((assessment) => ({
			...assessment,
			lines: assessment.lines.map((line) => ({ ...line }))
		}))
	);
	const results = $derived(
		$formData.results.map((result) => ({
			...result,
			components: result.components.map((component) => ({ ...component }))
		}))
	);
	const kinds = [
		{ value: 'weighted', label: 'Moyenne pondérée' },
		{ value: 'points_ratio', label: 'Cumul des points' }
	];
	async function revalidate() {
		const checkedDraft = JSON.stringify($formData);
		const validated = await form.validateForm({ update: false, focusOnError: false });
		if (JSON.stringify($formData) === checkedDraft) form.errors.set(validated.errors);
	}
	function addResult() {
		formData.update((data) => ({
			...data,
			results: [
				...data.results,
				{
					id: crypto.randomUUID(),
					title: '',
					kind: 'weighted',
					assessmentIds: [],
					components: [{ id: crypto.randomUUID(), assessmentIds: [], weight: 100 }]
				}
			]
		}));
	}
	function removeResult(id: string) {
		formData.update((data) => ({
			...data,
			results: data.results.filter((result) => result.id !== id)
		}));
		revalidate();
	}
	function changeKind(id: string, kind: string) {
		formData.update((data) => ({
			...data,
			results: data.results.map((result) => {
				if (result.id !== id) return result;
				if (kind === 'weighted' && result.components.length === 0)
					return {
						...result,
						components: [
							{ id: crypto.randomUUID(), assessmentIds: [...result.assessmentIds], weight: 100 }
						]
					};
				if (kind === 'points_ratio' && result.assessmentIds.length === 0)
					return {
						...result,
						assessmentIds: result.components.flatMap((component) => component.assessmentIds)
					};
				return result;
			})
		}));
	}
	function addComponent(id: string) {
		formData.update((data) => ({
			...data,
			results: data.results.map((result) =>
				result.id === id
					? {
							...result,
							components: [
								...result.components,
								{ id: crypto.randomUUID(), assessmentIds: [], weight: 1 }
							]
						}
					: result
			)
		}));
	}
	function removeComponent(resultId: string, id: string) {
		formData.update((data) => ({
			...data,
			results: data.results.map((result) =>
				result.id === resultId
					? { ...result, components: result.components.filter((component) => component.id !== id) }
					: result
			)
		}));
		revalidate();
	}
	function selectedNames(ids: string[]) {
		return (
			ids
				.map(
					(id) =>
						assessments.find((assessment) => assessment.id === id)?.title || 'Évaluation sans nom'
				)
				.join(' + ') || 'Choisir les évaluations'
		);
	}
</script>

<aside class="calculation-panel flex min-w-0 flex-col gap-4" aria-labelledby="results-heading">
	<div class="flex flex-col gap-2">
		<h2 id="results-heading" class="text-xl font-semibold tracking-tight">
			Résultats indépendants
		</h2>
		<p class="text-sm leading-relaxed text-muted-foreground">
			Résultats indépendants, ramenés sur 20.
		</p>
	</div>
	<Form.Fieldset {form} name="results" class="results-fieldset flex min-w-0 flex-col gap-4">
		<Form.Legend class="sr-only">Résultats calculés</Form.Legend>
		{#each results as result, resultIndex (result.id)}
			<Form.Fieldset
				{form}
				name={`results[${resultIndex}]`}
				class="result-editor flex min-w-0 flex-col gap-3"
			>
				<Form.Legend class="sr-only">{result.title || `Résultat ${resultIndex + 1}`}</Form.Legend>
				<Field.FieldGroup class="gap-3">
					<div class="flex min-w-0 items-end gap-2">
						<div class="min-w-0 flex-1">
							<RubricField
								{form}
								name={`results[${resultIndex}].title`}
								id={`result-${result.id}-title`}
								label="Nom du résultat"
								maxlength={200}
							/>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="min-h-11 min-w-11 shrink-0"
							aria-label={`Retirer le résultat ${result.title || resultIndex + 1}`}
							onclick={() => removeResult(result.id)}><TrashIcon aria-hidden="true" /></Button
						>
					</div>
					<RubricField
						{form}
						name={`results[${resultIndex}].kind`}
						id={`result-${result.id}-kind`}
						label="Règle de calcul"
						options={kinds}
						onvaluechange={(kind) => changeKind(result.id, kind)}
					/>
				</Field.FieldGroup>
				{#if result.kind === 'points_ratio'}
					<RubricAssessmentPicker
						{form}
						name={`results[${resultIndex}].assessmentIds`}
						{assessments}
					/>
					{#if resultIndex === 0 && !result.assessmentIds.every((id) => assessments.find((item) => item.id === id)?.kind === 'quiz')}{@render maxima()}{/if}
					<p class="text-sm leading-relaxed text-muted-foreground">
						{#if result.assessmentIds.length && result.assessmentIds.every((id) => assessments.find((item) => item.id === id)?.kind === 'quiz')}
							Les sections Quiz sont normalisées sur 20 puis moyennées à poids égal.
						{:else}
							Addition des points obtenus et des maxima, puis conversion sur 20. Dans chaque section
							Quiz, les quiz sont d’abord normalisés et moyennés à poids égal.
						{/if}
					</p>
				{:else}
					<Form.Fieldset
						{form}
						name={`results[${resultIndex}].components`}
						class="components-fieldset flex min-w-0 flex-col gap-2"
					>
						<Form.Legend class="text-sm">Composantes et poids (%)</Form.Legend>
						{#each result.components as component, componentIndex (component.id)}
							<Form.Fieldset
								{form}
								name={`results[${resultIndex}].components[${componentIndex}]`}
								class="component-editor min-w-0"
							>
								<Form.Legend class="sr-only">Composante {componentIndex + 1}</Form.Legend>
								<div class="flex min-w-0 items-start gap-2">
									<details class="min-w-0 flex-1" open={component.assessmentIds.length === 0}>
										<summary
											class="min-h-11 cursor-pointer py-3 text-sm leading-relaxed break-words"
											>{selectedNames(component.assessmentIds)}</summary
										>
										<RubricAssessmentPicker
											{form}
											name={`results[${resultIndex}].components[${componentIndex}].assessmentIds`}
											{assessments}
											label={`Évaluations de la composante ${componentIndex + 1}`}
										/>
									</details>
									<div class="w-20 shrink-0">
										<RubricField
											{form}
											name={`results[${resultIndex}].components[${componentIndex}].weight`}
											id={`component-${component.id}-weight`}
											label={`Poids ${componentIndex + 1} (%)`}
											hideLabel
											type="number"
											min={0.01}
											max={100}
											step={0.01}
										/>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class="min-h-11 min-w-11 shrink-0"
										disabled={result.components.length <= 1}
										aria-label={`Retirer la composante ${componentIndex + 1} · ${selectedNames(component.assessmentIds)}`}
										onclick={() => removeComponent(result.id, component.id)}
										><TrashIcon aria-hidden="true" /></Button
									>
								</div>
								<Form.FieldErrors />
							</Form.Fieldset>
						{/each}
						<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
							<span>Total des poids</span><output
								class="font-semibold tabular-nums"
								aria-label="Total des poids"
								>{result.components
									.reduce(
										(sum, component) =>
											sum + (Number.isFinite(component.weight) ? component.weight : 0),
										0
									)
									.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</output
							>
						</div>
						{#if resultIndex === 0}{@render maxima()}{/if}
						<Button
							type="button"
							variant="outline"
							class="min-h-11 whitespace-normal"
							disabled={result.components.length >= 100}
							onclick={() => addComponent(result.id)}
							><PlusIcon data-icon="inline-start" />Ajouter une composante</Button
						>
						<Form.Description
							>Chaque composante moyenne ses notes sur 20 à poids égal. Les poids des composantes
							doivent totaliser 100 %.</Form.Description
						>
						<Form.FieldErrors />
					</Form.Fieldset>
				{/if}
				<Form.FieldErrors />
			</Form.Fieldset>
		{:else}
			<Empty.Root class="px-0 py-5"
				><Empty.Header
					><Empty.Title>Aucun résultat calculé</Empty.Title><Empty.Description
						>Ajoutez un résultat, ou gardez seulement vos évaluations formatives.</Empty.Description
					></Empty.Header
				></Empty.Root
			>
			{@render maxima()}
		{/each}
		<Button
			type="button"
			variant="outline"
			class="min-h-11 whitespace-normal"
			disabled={results.length >= 100}
			onclick={addResult}
			><PlusIcon data-icon="inline-start" />Ajouter un résultat indépendant</Button
		>
		<Form.FieldErrors />
	</Form.Fieldset>
	<details class="text-sm leading-relaxed text-muted-foreground">
		<summary class="min-h-11 cursor-pointer py-3 font-medium"
			>Modifier un barème déjà utilisé</summary
		>
		<p>
			Les points bruts sont conservés. Une modification numérique marque les évaluations concernées
			à revoir ; les nouvelles lignes restent à noter et les dépassements sont signalés.
		</p>
	</details>
</aside>

{#snippet maxima()}
	{#if assessment}
		<section aria-label="Maximums calculés" class="border-t pt-3">
			<h3 class="text-sm font-semibold break-words">
				Maximums · {assessment.title || 'Évaluation'}
			</h3>
			<dl class="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
				{#each assessment.groups as group (group.id)}<div class="flex min-w-0 items-start gap-1">
						<dt class="break-words">{group.title || 'Groupe sans nom'}</dt>
						<dd class="shrink-0 tabular-nums">
							{assessment.lines.reduce(
								(sum, line) =>
									sum +
									(line.groupId === group.id && Number.isFinite(line.maxPoints)
										? line.maxPoints
										: 0),
								0
							)} pts
						</dd>
					</div>{/each}
				<div class="flex gap-1 font-semibold">
					<dt>Total</dt>
					<dd class="tabular-nums">
						{assessment.lines.reduce(
							(sum, line) => sum + (Number.isFinite(line.maxPoints) ? line.maxPoints : 0),
							0
						)} pts
					</dd>
				</div>
			</dl>
		</section>
	{/if}
{/snippet}

<style>
	:global(.result-editor + .result-editor) {
		border-top: 1px solid var(--border);
		padding-top: 1.5rem;
	}
	:global(.result-editor > *),
	:global(.components-fieldset > *),
	:global(.component-editor > *),
	:global(.results-fieldset > *) {
		margin-block: 0;
	}
	:global(.component-editor) {
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.5rem;
	}
	summary {
		outline-offset: 3px;
	}
</style>
