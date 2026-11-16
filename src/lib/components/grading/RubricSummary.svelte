<script lang="ts">
	import { untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import { Button } from '#lib/components/ui/button/index.js';
	import { sectionPointsRule } from '#lib/domain/rubric-points.js';
	import { rubricSectionMaximum, syncRubricSections, type RubricEditorInput } from '#lib/grading/rubric-form.js';
	import RubricField from './RubricField.svelte';

	let { form }: { form: SuperForm<RubricEditorInput, string> } = $props();
	const { form: formData } = untrack(() => form);
	let preview = $state(false);
	const simple = $derived($formData.calculationMode === 'sections');
	// Field proxies mutate plain store objects. Refresh each keyed row's identity so its type,
	// title and maximum control update together, even without adding/removing a criterion.
	const sections = $derived(
		$formData.assessments.filter((item) => item.purpose === 'graded').map((item) => ({ ...item }))
	);
	const maxima = $derived(sections.map((item) => rubricSectionMaximum(item, $formData.quizMaxima)));
	const total = $derived(
		maxima.some((maximum) => maximum === null) ? null : maxima.reduce<number>((sum, maximum) => sum + maximum!, 0)
	);
	const canCalculate = $derived(total !== null && total > 0);
	const number = (value: number) =>
		Number.isFinite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) : 'N/D';
	function useSections() {
		// This is an explicit draft choice, never an automatic conversion of existing results.
		formData.update((input) => syncRubricSections({ ...input, calculationMode: 'sections' }));
		preview = false;
	}
	async function revalidate() {
		const checkedDraft = JSON.stringify($formData);
		const validated = await form.validateForm({ update: false, focusOnError: false });
		if (JSON.stringify($formData) === checkedDraft) form.errors.set(validated.errors);
	}
	function useIndependentResults() {
		formData.update((input) => {
			const rule = sectionPointsRule(
				input.assessments,
				input.quizMaxima.filter((maximum) =>
					input.assessments.some((item) => item.id === maximum.assessmentId && item.purpose === 'graded')
				)
			);
			return {
				...input,
				calculationMode: 'custom',
				results: input.results.map((result) => ({
					...result,
					kind: 'weighted',
					components: rule.components.map((component, index) => ({
						...component,
						id: `${result.id}-${index}`
					}))
				}))
			};
		});
	}
</script>

<section aria-labelledby="rubric-summary-heading" class="rubric-summary flex min-w-0 flex-col gap-4">
	<div class="flex flex-col gap-2">
		<h2 id="rubric-summary-heading" class="panel-title">
			{simple ? 'Total du barème' : 'Résultats calculés configurés'}
		</h2>
		{#if simple}
			<p class="text-sm text-muted-foreground">
				Ajoutez les sections utiles à ce module. Leurs maxima déterminent leur part dans la note sur 20.
			</p>
		{:else}
			<p class="text-sm text-muted-foreground">
				{$formData.results.length
					? $formData.results.map((result) => `${result.title || 'Résultat sans nom'} /20`).join(' · ')
					: 'Aucun résultat final configuré.'}
			</p>
			{#if $formData.results.length > 1}
				<p class="text-sm text-muted-foreground">
					Ces résultats restent indépendants. Leur configuration est conservée ci-dessous.
				</p>
			{:else if !preview}
				<Button
					type="button"
					variant="outline"
					class="min-h-11 self-start whitespace-normal"
					onclick={() => {
						formData.update(syncRubricSections);
						preview = true;
					}}>Prévisualiser le calcul par sections</Button
				>
			{/if}
		{/if}
	</div>
	{#if simple || preview}
		{#if preview}<p class="text-sm">
				Aperçu : les maxima ci-dessous remplaceront la règle actuelle{#if $formData.results[0]}
					de « {$formData.results[0].title} »{/if}. L’application reste un brouillon jusqu’à l’enregistrement du barème.
			</p>{/if}
		<dl class="section-maxima flex min-w-0 flex-col divide-y">
			{#each sections as section (section.id)}
				{@const quizIndex = $formData.quizMaxima.findIndex((item) => item.assessmentId === section.id)}
				{@const maximum = rubricSectionMaximum(section, $formData.quizMaxima)}
				<div class="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
					<dt class="min-w-0 basis-40 break-words">{section.title || 'Section sans nom'}</dt>
					<dd class="flex min-w-0 flex-wrap items-center gap-4">
						{#if section.kind === 'quiz' && quizIndex >= 0}
							<div class="w-56 max-w-full">
								<RubricField
									{form}
									name={`quizMaxima[${quizIndex}].maxPoints`}
									id={`quiz-section-${section.id}-maximum`}
									label={`Maximum de la section ${section.title || 'Quiz'} (pts)`}
									type="number"
									min={1}
									max={1000000}
									step={1}
									onvaluechange={revalidate}
									description="Chaque quiz est normalisé, puis leur moyenne à poids égal est convertie sur ce maximum."
								/>
							</div>
						{:else}<span class="font-medium tabular-nums"
								>{maximum === null ? 'Maximum à corriger' : `${number(maximum)} pts`}</span
							>{/if}
						<span class="w-20 text-right text-sm text-muted-foreground tabular-nums"
							>{canCalculate && maximum !== null ? `${number((100 * maximum) / total!)} %` : 'Part à calculer'}</span
						>
					</dd>
				</div>
			{:else}<p class="py-3 text-sm text-muted-foreground">
					Aucune section notée. Un dossier seul suffit ; ajoutez les autres sections seulement si nécessaire.
				</p>{/each}
			<div class="maxima-total flex flex-wrap items-center justify-between gap-3 py-4 font-semibold">
				<dt>Total des maxima</dt>
				<dd>
					<output aria-label="Total des maxima" class="tabular-nums"
						>{total === null ? 'Maximum à corriger' : `${number(total)} pts`}</output
					>
				</dd>
			</div>
		</dl>
		{#if sections.length && canCalculate}<p class="text-sm text-muted-foreground">
				Note du module = total obtenu ÷ {number(total!)} × 20. Le retard éventuel du projet est appliqué à sa note sur 20
				avant sa contribution au total.
			</p>{/if}
		{#if preview}<div class="flex flex-wrap gap-3">
				<Button type="button" variant="outline" class="min-h-11" onclick={() => (preview = false)}
					>Conserver la règle actuelle</Button
				><Button type="button" class="min-h-11 whitespace-normal" disabled={!canCalculate} onclick={useSections}
					>Utiliser ce calcul dans le brouillon</Button
				>
			</div>{/if}
	{/if}
	<p class="text-sm text-muted-foreground">
		Une modification numérique conserve les points saisis et signale les sections à revoir. Un score vide reste en
		attente.
	</p>
	{#if simple && sections.length > 0}
		<details class="text-sm">
			<summary class="min-h-11 cursor-pointer py-3 font-medium">Résultats indépendants</summary>
			<div class="flex flex-col items-start gap-3">
				<p class="text-muted-foreground">
					Pour un module qui exige plusieurs notes finales, conservez le calcul actuel et gérez ensuite chaque résultat
					séparément. Les maxima ne mettront plus les poids à jour automatiquement.
				</p>
				<Button
					type="button"
					variant="outline"
					class="min-h-11 whitespace-normal"
					disabled={!canCalculate}
					onclick={useIndependentResults}>Configurer des résultats indépendants</Button
				>
			</div>
		</details>
	{/if}
</section>

<style>
	.rubric-summary {
		overflow-wrap: anywhere;
	}
	.section-maxima {
		font-size: 0.875rem;
	}
	.section-maxima > div {
		gap: 0.5rem 1rem;
	}
	.maxima-total output {
		font-size: 1.25rem;
		letter-spacing: -0.02em;
	}
	.rubric-summary details {
		border-top: 1px solid var(--border);
		padding-top: 0.25rem;
	}
	.rubric-summary summary {
		outline-offset: 4px;
	}
	.rubric-summary :global(button) {
		height: auto;
		min-height: 2.75rem;
	}
</style>
