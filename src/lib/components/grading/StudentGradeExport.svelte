<script lang="ts">
	import { browser } from '$app/env';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { resolve } from '$app/paths';
	import { z } from 'zod';
	import { onDestroy, onMount, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { RubricData, StudentGrading } from '#lib/domain/grading.js';
	import { calculateStudent } from '#lib/domain/grade-calculation.js';
	import { studentGradeExportSchema } from '#lib/domain/student-export.js';
	let {
		rubric,
		contextId,
		student,
		disabled = false
	}: {
		rubric: RubricData;
		contextId: string;
		student: StudentGrading;
		disabled?: boolean;
	} = $props();
	let failed = $state(false);
	let errorSummary = $state<HTMLDivElement | null>(null);
	async function focusError() {
		notify(message, 'error');
		await tick();
		errorSummary?.focus();
	}
	let pending = $state(false),
		message = $state('');
	let hydrated = $state(false),
		staleScope = $state(''),
		feedbackScope = $state('');
	const scope = $derived(contextId + '/' + student.id);
	let disposed = false;
	onDestroy(() => {
		disposed = true;
	});
	onMount(() => {
		hydrated = true;
	});
	const ready = $derived(
		calculateStudent(
			rubric.assessments,
			rubric.results,
			student,
			rubric.contexts.find((item) => item.id === contextId)?.deadlines
		).complete
	);
	async function download() {
		if (!browser) return;
		if (disabled || pending || !ready) return;
		const selected = scope;
		pending = true;
		message = '';
		feedbackScope = selected;
		failed = false;
		let problem = 'Impossible de préparer le PDF individuel. Réessayez.';
		try {
			const response = await fetch(
				resolve('/api/teaching/contexts/[contextId]/students/[studentId]/export', {
					contextId,
					studentId: student.id
				}),
				{ cache: 'no-store' }
			);
			const payload = await response.json();
			if (disposed || scope !== selected) return;
			if (!response.ok) {
				if (response.status === 404 || response.status === 409) staleScope = selected;
				problem = z.object({ message: z.string() }).safeParse(payload).data?.message ?? problem;
				throw new Error(problem);
			}
			const { document } = z.strictObject({ document: studentGradeExportSchema }).parse(payload);
			const { downloadStudentGradePdf } = await import('#lib/client/student-grade-pdf.js');
			if (disposed || scope !== selected) return;
			await downloadStudentGradePdf(document);
			message = 'PDF individuel préparé.';
		} catch {
			if (disposed || scope !== selected) return;
			failed = true;
			message = problem;
			await focusError();
		} finally {
			pending = false;
		}
	}
	async function refresh() {
		if (pending) return;
		pending = true;
		const selected = scope;
		feedbackScope = selected;
		try {
			await invalidateAll();
			if (disposed || scope !== selected) return;
			staleScope = '';
			message = '';
			notify('Résultats actualisés.', 'info');
		} catch {
			if (disposed || scope !== selected) return;
			failed = true;
			message = 'Actualisation impossible. Réessayez.';
			await focusError();
		} finally {
			pending = false;
		}
	}
</script>

<ActionNotice message={!failed && feedbackScope === scope ? message : ''} />

<div class="student-export flex flex-col gap-2">
	<Button
		type="button"
		variant="outline"
		disabled={!hydrated || disabled || pending || !ready || staleScope === scope}
		onclick={download}
		aria-label={`Télécharger le PDF individuel de ${student.name}`}
	>
		{#if pending}<Spinner data-icon="inline-start" aria-hidden="true" />{/if}PDF individuel
	</Button>
	{#if !ready}<p class="text-sm text-muted-foreground">
			PDF final en attente des résultats requis de cet étudiant.
		</p>{/if}
	{#if failed && message && feedbackScope === scope}<Alert.Root
			variant="destructive"
			bind:ref={errorSummary}
			tabindex={-1}
			><Alert.Title>PDF individuel indisponible</Alert.Title><Alert.Description>{message}</Alert.Description
			></Alert.Root
		>{/if}
	{#if staleScope === scope}<Button type="button" variant="outline" disabled={pending} onclick={refresh}
			>Actualiser les résultats</Button
		>{/if}
</div>

<style>
	.student-export {
		min-width: 0;
	}
	.student-export > :global(button) {
		white-space: normal;
		min-height: 2.75rem;
	}
</style>
