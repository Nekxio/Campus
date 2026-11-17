<script lang="ts">
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Button } from '#lib/components/ui/button/index.js';
	let {
		status,
		canArchive,
		canPurge,
		canRead,
		empty,
		choice = $bindable(null)
	}: {
		status: 'active' | 'archived' | 'purged';
		canArchive: boolean;
		canPurge: boolean;
		canRead: boolean;
		empty: boolean;
		choice?: 'archive' | 'close' | 'history' | null;
	} = $props();
</script>

<section aria-labelledby="annual-choice-title" class="annual-decision">
	<div class="decision-introduction">
		<h2 id="annual-choice-title" class="panel-title">Choisir la suite de l’année</h2>
		<p>Consultez les dossiers à tout moment. Une décision sur l’année demande une vérification distincte.</p>
	</div>
	<div class="annual-decision-options">
		<div>
			<Button
				variant={choice === 'history' ? 'secondary' : 'outline'}
				disabled={!canRead}
				aria-expanded={choice === 'history'}
				aria-controls="annual-choice-details"
				onclick={() => (choice = 'history')}
				><HistoryIcon data-icon="inline-start" />Consulter l’historique et les PDF</Button
			>
			<p>Retrouvez les calendriers, les résultats enregistrés et les exports disponibles sans modifier l’année.</p>
		</div>
		{#if status !== 'purged'}
			<div>
				<Button
					variant={choice === 'archive' ? 'secondary' : 'outline'}
					disabled={!canArchive}
					aria-expanded={choice === 'archive'}
					aria-controls="annual-choice-details"
					onclick={() => (choice = 'archive')}><ArchiveIcon data-icon="inline-start" />Archiver sans supprimer</Button
				>
				<p>Retire l’année du travail actif et conserve ses données en lecture seule. Vous pourrez la rouvrir.</p>
			</div>
			<div>
				<Button
					variant="destructive-outline"
					disabled={!canPurge}
					aria-expanded={choice === 'close'}
					aria-controls="annual-choice-details"
					onclick={() => (choice = 'close')}><Trash2Icon data-icon="inline-start" />Préparer la clôture</Button
				>
				<p>
					Conserve les modules et supprime définitivement les données étudiantes de cette année, après vérification des
					PDF et confirmation.
				</p>
			</div>
		{/if}
		{#if empty}<p>
				Aucune classe ni aucun suivi de module pour cette année. Il n’y a rien à archiver ni à clôturer.
			</p>{/if}
	</div>
</section>

<style>
	.annual-decision {
		display: grid;
		gap: 1.5rem;
		min-width: 0;
	}
	p {
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.65;
		max-width: 65ch;
	}
	.decision-introduction p {
		margin-top: var(--space-label);
	}
	.annual-decision-options {
		display: grid;
		gap: 0;
		min-width: 0;
	}
	.annual-decision-options > div {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
		padding: 1.25rem 0;
		border-top: 1px solid var(--border);
	}
	.annual-decision-options :global(button) {
		min-height: 2.75rem;
		height: auto;
		white-space: normal;
		text-align: left;
	}
	@media (min-width: 70rem) {
		.annual-decision {
			grid-template-columns: 15rem minmax(0, 1fr);
			gap: 3rem;
		}
	}
</style>
