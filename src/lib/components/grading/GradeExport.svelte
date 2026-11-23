<script lang="ts">
	import { browser } from '$app/env';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { z } from 'zod';
	import { onDestroy, onMount, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import type { GradeGridData } from '#lib/domain/grading.js';
	import { gradeExportStatus, finalGradeExportSchema } from '#lib/domain/grade-export.js';

	let {
		data,
		compact = false
	}: {
		data: GradeGridData;
		compact?: boolean;
	} = $props();
	let expanded = $state(false);
	const status = $derived(gradeExportStatus(data));
	let pending = $state(false);
	let hydrated = $state(false);
	let disposed = false;
	onDestroy(() => {
		disposed = true;
	});
	onMount(() => {
		hydrated = true;
	});
	let refreshing = $state(false);
	let feedback = $state('');
	let failed = $state(false);
	let errorSummary = $state<HTMLDivElement | null>(null);
	const focusError = async () => {
		notify(feedback, 'error');
		expanded = true;
		await tick();
		errorSummary?.focus();
	};
	let feedbackContext = $state<string | null>(null);
	let staleContext = $state<string | null>(null);
	const needsRefresh = $derived(data.contextId !== null && staleContext === data.contextId);
	const ready = $derived(status.ready && !needsRefresh);
	const currentFeedback = $derived(feedbackContext === data.contextId ? feedback : '');
	const download = async () => {
		if (!browser) return;
		if (pending || !ready || !data.contextId) return;
		const contextId = data.contextId;
		pending = true;
		feedback = '';
		feedbackContext = contextId;
		failed = false;
		let problem = 'Impossible de préparer le PDF. Réessayez.';
		try {
			const response = await fetch(resolve('/api/teaching/contexts/[contextId]/export', { contextId }), {
				cache: 'no-store'
			});
			const payload = await response.json();
			if (disposed || data.contextId !== contextId) return;
			if (!response.ok) {
				if (response.status === 409 || response.status === 404) staleContext = contextId;
				const parsed = z.object({ message: z.string() }).safeParse(payload);
				problem = parsed.success ? parsed.data.message : 'Export indisponible. Réessayez.';
				throw new Error(problem);
			}
			const { document } = z.strictObject({ document: finalGradeExportSchema }).parse(payload);
			if (disposed || data.contextId !== contextId) return;
			const { downloadGradePdf } = await import('#lib/client/grade-pdf.js');
			if (disposed || data.contextId !== contextId) return;
			await downloadGradePdf(document);
			feedback = `PDF préparé pour les ${document.students.length} étudiants de ${document.className}.`;
		} catch {
			if (disposed || data.contextId !== contextId) return;
			failed = true;
			feedback = problem;
			await focusError();
		} finally {
			pending = false;
		}
	};
	const refresh = async () => {
		if (refreshing) return;
		refreshing = true;
		const contextId = data.contextId;
		feedbackContext = contextId;
		try {
			await invalidateAll();
			if (disposed || data.contextId !== contextId) return;
			staleContext = null;
			feedback = '';
			notify('Résultats actualisés.', 'info');
		} catch {
			if (disposed || data.contextId !== contextId) return;
			failed = true;
			feedback = 'Impossible d’actualiser la grille. Réessayez.';
			await focusError();
		} finally {
			refreshing = false;
		}
	};
</script>

<ActionNotice message={failed ? '' : currentFeedback} />

{#snippet downloadButton()}
	<Button
		type="button"
		variant={compact ? 'outline' : 'default'}
		class="export-download min-h-11"
		disabled={!hydrated || !ready || pending || refreshing}
		onclick={download}
		aria-describedby="pdf-scope"
	>
		{#if pending}<Spinner data-icon="inline-start" />{:else}<DownloadIcon data-icon="inline-start" />{/if}
		{pending ? 'Préparation du PDF…' : 'Télécharger le PDF'}
	</Button>
{/snippet}

<div class="grade-export flex min-w-0 flex-col gap-3" data-compact={compact}>
	{#if compact}
		<section aria-label="Export PDF du module" class="flex min-w-0 flex-wrap items-center gap-3">
			<details class="min-w-0 flex-1 basis-64" bind:open={expanded}>
				<summary class="export-summary flex min-h-11 cursor-pointer items-center gap-3 text-sm">
					<DownloadIcon class="size-4 shrink-0" aria-hidden="true" />
					<span class="min-w-0 flex-1 wrap-anywhere">PDF de la classe · {status.complete}/{status.total} étudiants</span
					>
					<span class="text-xs text-muted-foreground"
						>{needsRefresh ? 'À actualiser' : ready ? 'Disponible' : 'Indisponible'}</span
					>
					<ChevronDownIcon class="export-chevron size-4 shrink-0" aria-hidden="true" />
				</summary>
				<div class="flex flex-wrap items-center justify-between gap-3 pt-3">
					<p class="min-w-0 flex-1 basis-64 text-sm wrap-anywhere text-muted-foreground" aria-live="polite">
						{needsRefresh
							? 'Les résultats ont changé. Actualisez la grille avant l’export.'
							: ready
								? 'Toute la classe, même avec une recherche ou un filtre.'
								: status.reason}
					</p>
					{#if !ready}{@render downloadButton()}{/if}
				</div>
			</details>
			{#if ready}{@render downloadButton()}{/if}
			<p id="pdf-scope" class="sr-only">
				Grille complète de la classe, sans détail des critères ni commentaires privés.
			</p>
		</section>
	{:else}
		<Alert.Root role="region" aria-label="Export PDF du module" class="flex flex-wrap items-center gap-4">
			{#if ready}<CheckIcon aria-hidden="true" />{:else}<ClockIcon aria-hidden="true" />{/if}
			<div class="min-w-0 flex-1" aria-live="polite">
				<Alert.Title
					>{needsRefresh
						? 'Résultats à actualiser'
						: status.total
							? `${status.complete}/${status.total} étudiants · ${ready ? 'résultats requis définitifs' : 'export en attente'}`
							: 'Export du module'}</Alert.Title
				>
				<Alert.Description
					>{needsRefresh
						? 'Les résultats ont changé. Actualisez la grille avant l’export.'
						: ready
							? 'Toute la classe, même avec une recherche ou un filtre.'
							: status.reason}</Alert.Description
				>
			</div>
			{@render downloadButton()}
			<p id="pdf-scope" class="sr-only">
				Grille complète de la classe, sans détail des critères ni commentaires privés.
			</p>
		</Alert.Root>
	{/if}
	{#if currentFeedback}
		{#if failed}
			<Alert.Root variant="destructive" bind:ref={errorSummary} tabindex={-1}
				><CircleAlertIcon aria-hidden="true" /><Alert.Title>PDF indisponible</Alert.Title><Alert.Description>
					<p>{currentFeedback}</p>
					<Button
						type="button"
						variant="outline"
						class="mt-3 min-h-11"
						disabled={refreshing || pending}
						onclick={refresh}>{refreshing ? 'Actualisation…' : 'Actualiser la grille'}</Button
					>
				</Alert.Description></Alert.Root
			>
		{/if}
	{/if}
</div>

<style>
	.export-summary {
		border-radius: var(--radius-control);
		list-style: none;
	}
	.export-summary:hover {
		color: var(--primary);
	}
	.export-summary::-webkit-details-marker {
		display: none;
	}
	.export-summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
	}
	details[open] :global(.export-chevron) {
		transform: rotate(180deg);
	}
	@media (max-width: 39.99rem) {
		.grade-export:not([data-compact='true']) :global(.export-download) {
			width: 100%;
		}
	}
</style>
