<script lang="ts">
	import { onMount } from 'svelte';
	import CodeBlock from '#lib/components/shared/CodeBlock.svelte';
	import { formatDurationSeconds } from '#lib/teaching/duration.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import type { QuizSessionReview } from '#lib/domain/quiz-session.js';
	let { review, onexpire }: { review: QuizSessionReview; onexpire: () => void } = $props();
	const consultationDurationMs = 15 * 60 * 1000;
	let remainingSeconds = $state(consultationDurationMs / 1000);
	let startedAt: { wall: number; monotonic: number } | null = null;
	let expired = false;
	let expandedQuestionId = $state<string | null>(null);
	const updateRemaining = () => {
		if (!startedAt || expired) return;
		// Wall time includes sleep; monotonic time keeps clock changes from extending the review.
		const elapsed = Math.max(Date.now() - startedAt.wall, performance.now() - startedAt.monotonic);
		remainingSeconds = Math.max(0, Math.ceil((consultationDurationMs - elapsed) / 1000));
		if (remainingSeconds === 0) {
			expired = true;
			onexpire();
		}
	};
	const hideCorrection = () => {
		expandedQuestionId = null;
	};
	const hideOnCaptureShortcut = (event: KeyboardEvent) => {
		if (event.key === 'PrintScreen' || (event.metaKey && event.shiftKey && event.key.toLowerCase() === 's')) {
			hideCorrection();
		}
	};
	const toggleCorrection = (questionId: string) => {
		updateRemaining();
		if (expired) return;
		expandedQuestionId = expandedQuestionId === questionId ? null : questionId;
	};
	onMount(() => {
		startedAt = { wall: Date.now(), monotonic: performance.now() };
		const clock = setInterval(updateRemaining, 1000);
		const deadline = setTimeout(updateRemaining, consultationDurationMs);
		return () => {
			clearInterval(clock);
			clearTimeout(deadline);
		};
	});
</script>

<svelte:window
	onblur={hideCorrection}
	onbeforeprint={hideCorrection}
	onkeydown={hideOnCaptureShortcut}
	onfocus={updateRemaining}
	onpageshow={updateRemaining}
/>
<svelte:document
	onvisibilitychange={() => {
		if (document.visibilityState === 'hidden') hideCorrection();
		updateRemaining();
	}}
/>

<section aria-labelledby="quiz-review-title" class="quiz-review mx-auto flex max-w-3xl min-w-0 flex-col gap-8">
	<header class="border-b pb-6">
		<h2
			id="quiz-review-title"
			tabindex="-1"
			class="text-2xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
		>
			Votre correction
		</h2>
		<p class="mt-3 text-xl font-semibold tabular-nums">{review.points} / {review.maxPoints}</p>
		<p class="mt-3 text-sm font-medium">
			Temps de consultation restant <span
				class="ml-2 tabular-nums"
				role="timer"
				aria-label={`Temps de consultation restant : ${formatDurationSeconds(remainingSeconds)}`}
				>{formatDurationSeconds(remainingSeconds)}</span
			>
		</p>
		<p class="mt-1 text-sm text-muted-foreground">Retour automatique au module à la fin du temps.</p>
		{#if review.status === 'interrupted'}<p class="mt-2 text-sm text-destructive">
				L’enseignant a arrêté votre participation : la note de ce quiz est zéro.
			</p>{/if}
		<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
			Ouvrez une correction à la fois. Le corrigé disparaît si vous quittez ou rechargez cette page.
		</p>
	</header>
	{#each review.questions as question, index (question.id)}
		{@const expanded = expandedQuestionId === question.id}
		<section aria-labelledby={`review-${question.id}`} class="min-w-0 border-b pb-8 last:border-b-0">
			<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
				<p>Question {index + 1}</p>
			</div>
			<h3 id={`review-${question.id}`} class="text-lg font-medium wrap-anywhere whitespace-pre-wrap">
				{question.prompt}
			</h3>
			{#if question.code}
				<div class="my-4">
					<CodeBlock label={`Code de la question ${index + 1}`}>{question.code}</CodeBlock>
				</div>{/if}
			<Button
				type="button"
				variant="outline"
				class="mt-4 w-full justify-between gap-3 print:hidden"
				aria-label={`${expanded ? 'Masquer' : 'Afficher'} la correction de la question ${index + 1}`}
				aria-expanded={expanded}
				aria-controls={`review-correction-${question.id}`}
				onclick={() => toggleCorrection(question.id)}
			>
				{expanded ? 'Masquer la correction' : 'Afficher la correction'}
				<ChevronDownIcon data-icon="inline-end" class={expanded ? 'rotate-180' : undefined} aria-hidden="true" />
			</Button>
			<div id={`review-correction-${question.id}`} hidden={!expanded} class="print:hidden">
				{#if expanded}
					<p class="mt-4 text-sm text-muted-foreground tabular-nums">{question.points} / 1 point</p>
					<ul class="mt-4 grid grid-cols-2 gap-2">
						{#each question.options as option (option.id)}
							{@const correct = question.correctOptionIds.includes(option.id)}
							{@const selected = question.selectedOptionIds.includes(option.id)}
							<li
								class="review-option flex min-w-0 flex-col gap-2 rounded-control border p-3 sm:flex-row sm:gap-3"
								data-correct={correct}
								data-incorrect={selected && !correct}
							>
								{#if correct}<CircleCheckIcon class="mt-1 size-4 shrink-0" aria-hidden="true" />
								{:else if selected}<CircleXIcon class="mt-1 size-4 shrink-0" aria-hidden="true" />
								{:else}<span class="size-4 shrink-0" aria-hidden="true"></span>{/if}
								<div class="min-w-0">
									<p class="wrap-anywhere whitespace-pre-wrap">{option.text}</p>
									{#if correct || selected}<p class="mt-1 text-sm font-medium">
											{#if correct}Bonne réponse{#if selected}
													· Votre choix{/if}{:else}Votre choix · Réponse incorrecte{/if}
										</p>{/if}
								</div>
							</li>
						{/each}
					</ul>
					{#if !question.selectedOptionIds.length}<p class="mt-3 text-sm text-muted-foreground">
							Vous n’avez pas répondu à cette question.
						</p>{/if}
				{/if}
			</div>
		</section>
	{/each}
</section>

<style>
	.review-option[data-correct='true'] {
		color: var(--quiz-correct);
		border-color: var(--quiz-correct);
	}
	.review-option[data-incorrect='true'] {
		color: var(--destructive);
		border-color: var(--destructive);
	}
</style>
