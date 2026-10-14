<script lang="ts">
	import { z } from 'zod';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CheckIcon from '@lucide/svelte/icons/circle-check';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import type { GradeGridData } from '#lib/domain/grading.js';
	import { gradeExportStatus, finalGradeExportSchema } from '#lib/domain/grade-export.js';

	let { data }: { data: GradeGridData } = $props();
	const status = $derived(gradeExportStatus(data));
	let pending = $state(false);
	let refreshing = $state(false);
	let feedback = $state('');
	let failed = $state(false);
	let feedbackContext = $state<string | null>(null);
	let staleContext = $state<string | null>(null);
	const needsRefresh = $derived(data.contextId !== null && staleContext === data.contextId);
	const ready = $derived(status.ready && !needsRefresh);
	const currentFeedback = $derived(feedbackContext === data.contextId ? feedback : '');
	async function download() {
		if (pending || !ready || !data.contextId) return;
		const contextId = data.contextId;
		pending = true;
		feedback = '';
		feedbackContext = contextId;
		failed = false;
		let problem = 'Impossible de préparer le PDF. Réessayez.';
		try {
			const response = await fetch(
				resolve('/api/teaching/contexts/[contextId]/export', { contextId }),
				{ cache: 'no-store' }
			);
			const payload = await response.json();
			if (!response.ok) {
				if (response.status === 409 || response.status === 404) staleContext = contextId;
				const parsed = z.object({ message: z.string() }).safeParse(payload);
				problem = parsed.success ? parsed.data.message : 'Export indisponible. Réessayez.';
				throw new Error(problem);
			}
			const { document } = z.strictObject({ document: finalGradeExportSchema }).parse(payload);
			if (data.contextId !== contextId) return;
			const { downloadGradePdf } = await import('#lib/client/grade-pdf.js');
			if (data.contextId !== contextId) return;
			await downloadGradePdf(document);
			feedback = `PDF préparé pour les ${document.students.length} étudiants de ${document.className}.`;
		} catch {
			failed = true;
			feedback = problem;
		} finally {
			pending = false;
		}
	}
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
			staleContext = null;
			feedback = '';
		} catch {
			failed = true;
			feedback = 'Impossible d’actualiser la grille. Réessayez.';
		} finally {
			refreshing = false;
		}
	}
</script>

<div class="flex min-w-0 flex-col gap-3">
	<Alert.Root
		role="region"
		aria-label="Export PDF du module"
		class="flex flex-wrap items-center gap-4"
	>
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
		<Button
			type="button"
			class="export-download min-h-11"
			disabled={!ready || pending || refreshing}
			onclick={download}
			aria-describedby="pdf-scope"
		>
			{#if pending}<Spinner data-icon="inline-start" />{:else}<DownloadIcon
					data-icon="inline-start"
				/>{/if}
			{pending ? 'Préparation du PDF…' : 'Télécharger le PDF'}
		</Button>
		<p id="pdf-scope" class="sr-only">
			Grille complète de la classe et de l’année sélectionnées, sans détail des critères ni
			commentaires privés.
		</p>
	</Alert.Root>
	{#if currentFeedback}
		{#if failed}
			<Alert.Root variant="destructive"
				><CircleAlertIcon aria-hidden="true" /><Alert.Title>PDF indisponible</Alert.Title
				><Alert.Description>
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
		{:else}<p role="status" class="text-sm text-muted-foreground">{currentFeedback}</p>{/if}
	{/if}
</div>

<style>
	@media (max-width: 39.99rem) {
		:global(.export-download) {
			width: 100%;
		}
	}
</style>
