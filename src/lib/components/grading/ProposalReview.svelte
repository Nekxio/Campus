<script lang="ts">
	import { tick } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating } from '$app/state';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import {
		proposalDecisionReceiptSchema,
		type ProposalDecisionReceipt,
		type ProposalReviewData,
		type ProposalSummary
	} from '#lib/domain/proposals.js';
	import { retryDecision, type DecisionRetry } from '#lib/grading/proposal-form.js';
	import { saveTeaching, TeachingRequestError } from '#lib/teaching/api.js';
	import ProposalReviewDraft from './ProposalReviewDraft.svelte';
	let { data }: { data: ProposalReviewData } = $props();
	const selection = $derived(data.selected);
	const available = $derived(
		selection?.rubric.assessments.some((item) => item.id === selection.assessmentId)
	);
	const loading = $derived(navigating.to?.route.id === '/enseignant/propositions');
	let refreshing = $state(false);
	let errorMessage = $state('');
	let refusalMessage = $state('');
	let deciding = $state(false);
	let refusalReceipt = $state.raw<ProposalDecisionReceipt | null>(null);
	const refusals: Record<string, DecisionRetry | undefined> = {};
	const fallbackProposal = $derived(
		refusalReceipt &&
			selection &&
			refusalReceipt.id === selection.proposal.id &&
			refusalReceipt.revision >= selection.proposal.revision
			? { ...selection.proposal, ...refusalReceipt }
			: selection?.proposal
	);
	async function refuseUnavailable() {
		if (
			!selection ||
			!fallbackProposal ||
			fallbackProposal.state !== 'pending' ||
			deciding ||
			refreshing
		)
			return;
		deciding = true;
		errorMessage = '';
		refusalMessage = '';
		const id = selection.proposal.id;
		const acceptedComment = fallbackProposal.commentState === 'accepted';
		try {
			const request = retryDecision(
				{ action: 'reject', expectedRevision: fallbackProposal.revision },
				refusals[id]
			);
			refusals[id] = request.retry;
			const result = await saveTeaching<unknown>(
				`/api/teaching/proposals/${id}/decision`,
				request.decision,
				'POST',
				request.decision.requestId
			);
			refusalReceipt = proposalDecisionReceiptSchema.parse(result);
			refusalMessage = acceptedComment
				? 'Proposition refusée. Les points enregistrés sont conservés ; le commentaire déjà repris reste enregistré.'
				: 'Proposition refusée. Les points enregistrés et votre commentaire actuel sont conservés.';
			try {
				await refresh();
			} catch {
				errorMessage =
					'Le refus est enregistré, mais l’actualisation a échoué. Actualisez les références.';
			}
		} catch (error) {
			errorMessage =
				error instanceof TeachingRequestError
					? error.message
					: 'Refus impossible. Réessayez ; la correction enregistrée reste conservée.';
		} finally {
			deciding = false;
		}
	}
	async function refresh() {
		await refreshAll();
		await tick();
	}
	async function retry() {
		refreshing = true;
		errorMessage = '';
		try {
			await refresh();
		} catch {
			errorMessage = 'Actualisation impossible. Réessayez dans un instant.';
		} finally {
			refreshing = false;
		}
	}
	function stateLabel(item: ProposalSummary) {
		return item.state === 'pending'
			? 'À examiner'
			: item.state === 'accepted'
				? item.commentState === 'pending'
					? 'Points validés · commentaire à examiner'
					: 'Validée'
				: 'Refusée';
	}
</script>

{#if selection && available}
	{#key selection.proposal.id}<ProposalReviewDraft
			{selection}
			queue={data.queue}
			onrefresh={refresh}
		/>{/key}
{:else}
	<div class="flex min-w-0 flex-col gap-6" aria-busy={loading || refreshing || deciding}>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex flex-col gap-2">
				<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
					Propositions de correction
				</h1>
				<p class="max-w-prose text-sm text-muted-foreground">
					Examinez les points proposés pour chaque étudiant, puis enregistrez votre décision. Le
					commentaire se décide séparément.
				</p>
			</div>
			<Button href={resolve('/enseignant/notation')} variant="outline" class="min-h-11"
				>Retour à la grille</Button
			>
		</div>
		{#if loading || refreshing}<p
				role="status"
				class="flex items-center gap-2 text-sm text-muted-foreground"
			>
				<Spinner />Ouverture des propositions…
			</p>{/if}
		{#if errorMessage}<Alert.Root variant="destructive"
				><CircleAlertIcon aria-hidden="true" /><Alert.Title>Propositions indisponibles</Alert.Title
				><Alert.Description>{errorMessage}</Alert.Description></Alert.Root
			>{/if}
		{#if selection && !available}<Alert.Root
				><CircleAlertIcon aria-hidden="true" /><Alert.Title>Évaluation indisponible</Alert.Title
				><Alert.Description
					><div class="flex flex-col gap-2">
						<p>
							Cette évaluation ne figure plus dans le barème actuel. Les points enregistrés sont
							conservés. Demandez une nouvelle proposition à partir du barème actuel.
						</p>
						<Button
							type="button"
							variant="outline"
							class="min-h-11 self-start"
							disabled={refreshing || deciding}
							onclick={retry}>Actualiser les références</Button
						>
						{#if fallbackProposal?.state === 'pending'}<Button
								type="button"
								variant="outline"
								class="min-h-11 self-start"
								disabled={refreshing || deciding}
								onclick={refuseUnavailable}
								>{#if deciding}<Spinner data-icon="inline-start" />{/if}Refuser la proposition</Button
							>{:else if fallbackProposal?.state === 'rejected'}<p role="status">
								{refusalMessage ||
									'Cette proposition a été refusée. Les points enregistrés sont conservés.'}
							</p>{/if}
					</div></Alert.Description
				></Alert.Root
			>{/if}
		{#if !data.queue.length}<Empty.Root
				><Empty.Header
					><Empty.Title>Aucune proposition à examiner</Empty.Title><Empty.Description
						>Les propositions de correction apparaîtront ici après leur préparation par l’agent
						local.</Empty.Description
					></Empty.Header
				><Empty.Content
					><Button
						type="button"
						variant="outline"
						class="min-h-11"
						disabled={refreshing || deciding}
						onclick={retry}>Actualiser</Button
					></Empty.Content
				></Empty.Root
			>
		{:else}<section aria-label="Liste des propositions" class="min-w-0">
				<Table.Root
					><Table.Caption class="sr-only"
						>Propositions de correction par étudiant et évaluation</Table.Caption
					><Table.Header
						><Table.Row
							><Table.Head>Étudiant</Table.Head><Table.Head>Classe et module</Table.Head><Table.Head
								>Évaluation</Table.Head
							><Table.Head>Décision</Table.Head><Table.Head
								><span class="sr-only">Ouvrir</span></Table.Head
							></Table.Row
						></Table.Header
					><Table.Body
						>{#each data.queue as item (item.id)}<Table.Row
								><Table.Cell class="wrap-anywhere whitespace-normal">{item.studentName}</Table.Cell
								><Table.Cell class="wrap-anywhere whitespace-normal"
									>{item.className} · {item.academicYear}<br />{item.moduleTitle}</Table.Cell
								><Table.Cell class="wrap-anywhere whitespace-normal"
									>{item.assessmentTitle}</Table.Cell
								><Table.Cell
									><Badge
										variant={item.state === 'pending' || item.commentState === 'pending'
											? 'secondary'
											: 'outline'}>{stateLabel(item)}</Badge
									></Table.Cell
								><Table.Cell
									><Button
										href={resolve('/enseignant/propositions') +
											`?proposition=${item.id}&contexte=${item.contextId}`}
										variant="outline"
										class="min-h-11"
										aria-label={`Examiner la proposition pour ${item.studentName}, ${item.assessmentTitle}`}
										>Examiner</Button
									></Table.Cell
								></Table.Row
							>{/each}</Table.Body
					></Table.Root
				>
			</section>{/if}
	</div>
{/if}
