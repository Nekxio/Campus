<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ContentCard from '#lib/components/shared/ContentCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { readPublicQuizzes, type PublicQuizList } from '#lib/quizzes/student-client.js';
	import { formatDurationSeconds } from '#lib/teaching/duration.js';
	let {
		contextId,
		idPrefix,
		active,
		lessons = []
	}: { contextId: string; idPrefix: string; active: boolean; lessons?: { id: string; label: string }[] } = $props();
	let quizzes = $state.raw<PublicQuizList>([]);
	let loading = $state(true);
	let problem = $state('');
	let refreshing = $state(false);
	let disposed = false;
	let visibilityState = $state<DocumentVisibilityState>('hidden');
	const canRefresh = $derived(active && visibilityState === 'visible');
	const refresh = async () => {
		if (!canRefresh || refreshing || disposed) return;
		refreshing = true;
		try {
			const loaded = await readPublicQuizzes(`/api/quizzes/${contextId}`);
			if (!disposed) {
				quizzes = loaded;
				problem = '';
			}
		} catch {
			if (!disposed) problem = 'Les salles de quiz sont indisponibles pour le moment.';
		} finally {
			if (!disposed) {
				loading = false;
				refreshing = false;
			}
		}
	};
	$effect(() => {
		if (!canRefresh) return;
		void untrack(refresh);
		const polling = setInterval(() => void refresh(), 20_000);
		return () => clearInterval(polling);
	});
	onDestroy(() => {
		disposed = true;
	});
</script>

<svelte:document bind:visibilityState />

<section
	id={`${idPrefix}-quiz`}
	tabindex="-1"
	aria-labelledby={`${idPrefix}-quiz-title`}
	class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
>
	<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<h2 id={`${idPrefix}-quiz-title`} class="flex items-start gap-3 text-xl leading-[1.333] font-semibold">
			<CircleHelpIcon class="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />Quiz en classe
		</h2>
		<Button variant="ghost" class="min-h-11" onclick={refresh} disabled={refreshing}
			><RefreshCwIcon data-icon="inline-start" aria-hidden="true" />{refreshing
				? 'Actualisation…'
				: 'Actualiser les salles'}</Button
		>
	</div>
	{#if loading}<p role="status" class="text-sm text-muted-foreground">
			Recherche des salles ouvertes…
		</p>{:else if problem}<p role="status" class="text-sm text-muted-foreground">
			{problem} Réessayez avec « Actualiser les salles ».
		</p>{:else if quizzes.length === 0}<p class="text-sm text-muted-foreground">
			Aucun quiz disponible pour le moment.
		</p>{:else}<ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{#each quizzes as quiz (quiz.id)}{@const lesson = lessons.find(
					(entry) => entry.id === quiz.lessonId
				)}{@const isWaiting =
					quiz.status !== 'lobby' && quiz.status !== 'running' && quiz.status !== 'closed'}{@const isAvailable =
					Boolean(quiz.runId && (quiz.status === 'lobby' || quiz.status === 'running'))}
				<li class="min-w-0">
					<ContentCard
						kind="static"
						title={quiz.title}
						icon={CircleHelpIcon}
						tone={isAvailable ? 'practice' : 'neutral'}
						muted={!isAvailable}
					>
						{#snippet status()}
							<Badge variant={isAvailable ? 'secondary' : 'outline'}>
								{#if isWaiting}<ClockIcon data-icon="inline-start" aria-hidden="true" />{/if}
								{quiz.status === 'lobby'
									? 'Salle ouverte'
									: quiz.status === 'running'
										? 'En cours'
										: quiz.status === 'closed'
											? 'Terminé'
											: 'En attente d’ouverture'}
							</Badge>
						{/snippet}
						{#snippet metadata()}{formatDurationSeconds(quiz.durationSeconds)}{#if lesson}
								· {lesson.label}{/if}{/snippet}
						{#snippet actions()}
							{#if isAvailable && quiz.runId}<Button
									href={resolve('/modules/[contextId]/quiz/[runId]', {
										contextId,
										runId: quiz.runId
									})}
								>
									Rejoindre<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /><span class="sr-only">
										{quiz.title}</span
									>
								</Button>{/if}
						{/snippet}
					</ContentCard>
				</li>{/each}
		</ul>{/if}
</section>
