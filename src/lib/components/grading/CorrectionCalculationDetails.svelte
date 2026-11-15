<script lang="ts">
	let {
		assessments,
		results
	}: {
		assessments: {
			id: string;
			title: string;
			kind: string;
			points: string;
			mark: string;
			raw: string;
			weight: string;
			delay: string;
		}[];
		results: { id: string; title: string; mark: string; pending: boolean; explanation: string }[];
	} = $props();
</script>

<div class="assessment-summary">
	<table class="w-full table-fixed text-xs tabular-nums">
		<caption class="sr-only">Points, notes normalisées, coefficients et retard des évaluations</caption>
		<thead
			><tr
				><th scope="col">Évaluation</th><th scope="col">Base de calcul</th><th scope="col">Note sur 20</th><th
					scope="col">Poids</th
				><th scope="col">Retard et calcul</th></tr
			></thead
		>
		<tbody>
			{#each assessments as item (item.id)}<tr
					><th scope="row">{item.title}</th><td>{item.points}</td><td>{item.raw}{item.mark}</td><td>{item.weight}</td
					><td>{item.delay}</td></tr
				>{/each}
			{#each results as result (result.id)}<tr class="result-row"
					><th scope="row">{result.title}</th><td>N/D</td><td>{result.mark}</td><td>100 %</td><td
						>{result.explanation}</td
					></tr
				>{/each}
		</tbody>
	</table>
</div>
<div class="mobile-summary flex flex-col gap-3">
	{#each assessments as item (item.id)}<div class="border-b pb-3">
			<h3 class="font-medium">{item.title} · {item.mark}</h3>
			<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
				<dt class="text-muted-foreground">{item.kind === 'quiz' ? 'Calcul' : 'Points bruts'}</dt>
				<dd class="tabular-nums">{item.points}</dd>
				<dt class="text-muted-foreground">Poids</dt>
				<dd class="wrap-anywhere">{item.weight}</dd>
				<dt class="text-muted-foreground">Retard</dt>
				<dd class="wrap-anywhere">{item.delay}</dd>
			</dl>
		</div>{/each}
	{#each results as result (result.id)}<div class="flex flex-col gap-1">
			<p class="font-medium">{result.title} · {result.mark}</p>
			{#if result.pending}<p class="text-sm wrap-anywhere text-muted-foreground">
					{result.explanation}
				</p>{/if}
		</div>{/each}
</div>
{#if results.length === 0}<p class="text-sm text-muted-foreground">
		Aucun résultat de module défini. Les évaluations restent indépendantes.
	</p>{/if}

<style>
	.assessment-summary {
		display: none;
	}
	@media (min-width: 48rem) {
		.mobile-summary {
			display: none;
		}
		.assessment-summary {
			display: block;
		}
		th,
		td {
			padding: 0.5rem 0.75rem;
			border-bottom: 1px solid var(--border);
			text-align: left;
			overflow-wrap: anywhere;
		}
		thead {
			background: var(--muted);
			color: var(--muted-foreground);
			font-size: 0.75rem;
		}
		th {
			font-weight: 500;
		}
		.result-row {
			background: var(--muted);
		}
		th:nth-child(1) {
			width: 18%;
		}
		th:nth-child(2) {
			width: 15%;
		}
		th:nth-child(3) {
			width: 20%;
		}
		th:nth-child(4) {
			width: 15%;
		}
		th:nth-child(5) {
			width: 32%;
		}
	}
</style>
