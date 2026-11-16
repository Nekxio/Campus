<script lang="ts">
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { tick } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { navigating, page } from '$app/state';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import {
		proposalDecisionActionSchema,
		proposalDecisionReceiptSchema,
		type ProposalDecisionReceipt,
		type ProposalReviewData,
		type ProposalSummary
	} from '#lib/domain/proposals.js';
	import { retryDecision, type DecisionRetry } from '#lib/grading/proposal-form.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { followRowLink } from '#lib/client/table-row-link.js';
	import ProposalReviewDraft from './ProposalReviewDraft.svelte';
	let { data }: { data: ProposalReviewData } = $props();
	const fallbackForm = superForm(
		defaults(
			{
				proposalId: '00000000-0000-4000-8000-000000000000',
				decision: { action: 'reject', expectedRevision: 1, requestId: '00000000-0000-4000-8000-000000000000' }
			},
			zod4Client(proposalDecisionActionSchema)
		),
		{
			id: 'proposal-unavailable-decision',
			dataType: 'json',
			validators: zod4Client(proposalDecisionActionSchema),
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false
		}
	);
	const fallbackTransport = createFormActionTransport(fallbackForm);
	let query = $state('');
	let queueFilter = $state('all');
	const filteredQueue = $derived(
		data.queue.filter((item) => {
			if (queueFilter === 'points' && item.state !== 'pending') return false;
			if (queueFilter === 'comments' && item.commentState !== 'pending') return false;
			const text = [item.studentName, item.className, item.academicYear, item.moduleTitle, item.assessmentTitle]
				.join(' ')
				.toLocaleLowerCase('fr');
			return text.includes(query.trim().toLocaleLowerCase('fr'));
		})
	);
	const resetFilters = () => {
		query = '';
		queueFilter = 'all';
	};
	const selection = $derived(data.selected);
	const contextId = $derived(page.url.searchParams.get('contexte') ?? selection?.contextId);
	const gradingPath = $derived(
		resolve('/enseignant/notation') + (contextId ? '?' + new URLSearchParams({ contexte: contextId }) : '')
	);
	const available = $derived(selection?.rubric.assessments.some((item) => item.id === selection.assessmentId));
	const loading = $derived(navigating.to?.route.id === '/enseignant/propositions');
	let refreshing = $state(false);
	let errorMessage = $state('');
	let decisionMessage = $state('');
	let errorSummary = $state<HTMLDivElement | null>(null);
	async function focusError() {
		notify(errorMessage, 'error');
		await tick();
		errorSummary?.focus();
	}
	let deciding = $state(false);
	let decisionReceipt = $state.raw<ProposalDecisionReceipt | null>(null);
	const decisionRetries: Record<string, DecisionRetry | undefined> = {};
	const fallbackProposal = $derived(
		decisionReceipt &&
			selection &&
			decisionReceipt.id === selection.proposal.id &&
			decisionReceipt.revision >= selection.proposal.revision
			? { ...selection.proposal, ...decisionReceipt }
			: selection?.proposal
	);
	const decideUnavailable = async (action: 'reject' | 'keep_comment') => {
		if (
			!selection ||
			!fallbackProposal ||
			(action === 'reject' && fallbackProposal.state !== 'pending') ||
			(action === 'keep_comment' && fallbackProposal.commentState !== 'pending') ||
			deciding ||
			refreshing
		)
			return;
		deciding = true;
		errorMessage = '';
		decisionMessage = '';
		const id = selection.proposal.id;
		const retryKey = `${id}:${action}`;
		const acceptedComment = fallbackProposal.commentState === 'accepted';
		try {
			const request = retryDecision({ action, expectedRevision: fallbackProposal.revision }, decisionRetries[retryKey]);
			decisionRetries[retryKey] = request.retry;
			const result = await fallbackTransport.submit(
				resolve('/enseignant/propositions') + '?/decideProposal',
				{ proposalId: id, decision: request.decision },
				(value) => proposalDecisionReceiptSchema.refine((receipt) => receipt.id === id).parse(value)
			);
			decisionReceipt = result;
			decisionMessage =
				action === 'keep_comment'
					? 'Votre commentaire enregistré est conservé.'
					: acceptedComment
						? 'Proposition refusée. Les points enregistrés sont conservés ; le commentaire déjà repris reste enregistré.'
						: 'Proposition refusée. Les points enregistrés et votre commentaire actuel sont conservés.';
			try {
				await refresh();
			} catch {
				errorMessage = 'La décision est enregistrée, mais l’actualisation a échoué. Actualisez les références.';
			}
		} catch (error) {
			errorMessage =
				error instanceof TeachingRequestError
					? error.message
					: 'Décision impossible. Réessayez ; les points et le commentaire enregistrés restent conservés.';
		} finally {
			deciding = false;
			if (errorMessage) await focusError();
		}
	};
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
			await focusError();
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
				: item.commentState === 'pending'
					? 'Points refusés · commentaire à examiner'
					: 'Refusée';
	}
</script>

<form
	hidden
	method="POST"
	use:fallbackTransport.enhance
	onsubmit={fallbackTransport.handleSubmit((event) => event.preventDefault())}
></form>

<ActionNotice message={decisionMessage} />
{#if errorMessage}<Alert.Root variant="destructive" class="mb-4" bind:ref={errorSummary} tabindex={-1}
		><CircleAlertIcon aria-hidden="true" /><Alert.Title>Propositions indisponibles</Alert.Title><Alert.Description
			>{errorMessage}</Alert.Description
		></Alert.Root
	>{/if}

{#if selection && available && page.url.searchParams.has('proposition')}
	<Button href={resolve('/enseignant/propositions')} onclick={resetFilters} variant="ghost" class="mb-4"
		>Toutes les propositions</Button
	>
	{#key selection.proposal.id}<ProposalReviewDraft {selection} queue={data.queue} onrefresh={refresh} />{/key}
{:else}
	<div class="page-sections" aria-busy={loading || refreshing || deciding}>
		<div class="flex flex-col items-start gap-3">
			<Button href={gradingPath} variant="outline" class="min-h-11">Retour à la grille</Button>
			<div class="flex flex-col gap-2">
				<h1 class="page-title">Propositions de correction</h1>
				<p class="max-w-prose text-sm text-muted-foreground">
					Examinez les points proposés pour chaque étudiant, puis enregistrez votre décision. Le commentaire se décide
					séparément.
				</p>
			</div>
		</div>
		{#if loading || refreshing}<p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
				<Spinner />Ouverture des propositions…
			</p>{/if}

		{#if selection && !available && page.url.searchParams.has('proposition')}<Alert.Root
				><CircleAlertIcon aria-hidden="true" /><Alert.Title>Évaluation indisponible</Alert.Title><Alert.Description
					><div class="flex flex-col gap-2">
						<p>
							Cette évaluation ne figure plus dans le barème actuel. Les points enregistrés sont conservés. Demandez une
							nouvelle proposition à partir du barème actuel.
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
								onclick={() => decideUnavailable('reject')}
								>{#if deciding}<Spinner data-icon="inline-start" />{/if}Refuser la proposition</Button
							>{:else if fallbackProposal?.state === 'rejected'}<p role="status">
								Cette proposition a été refusée. Les points enregistrés sont conservés.
							</p>{/if}
						{#if fallbackProposal?.commentState === 'pending'}<Button
								type="button"
								variant="outline"
								class="min-h-11 self-start"
								disabled={refreshing || deciding}
								onclick={() => decideUnavailable('keep_comment')}
								>{#if deciding}<Spinner data-icon="inline-start" />{/if}Conserver mon commentaire</Button
							>{:else if fallbackProposal?.commentState === 'kept'}<p role="status">
								Votre commentaire enregistré est conservé.
							</p>{/if}
					</div></Alert.Description
				></Alert.Root
			>{/if}
		{#if data.queue.length}
			<div class="queue-toolbar">
				<Field.FieldGroup
					><Field.Field>
						<Field.FieldLabel for="proposal-search">Rechercher une proposition</Field.FieldLabel>
						<Input id="proposal-search" type="search" bind:value={query} placeholder="Étudiant, classe, module…" />
					</Field.Field></Field.FieldGroup
				>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					spacing={1}
					class="max-w-full min-w-0"
					value={queueFilter}
					onValueChange={(value) => (queueFilter = value || 'all')}
					aria-label="Filtrer les propositions"
				>
					<ToggleGroup.Item value="all" class="max-w-full min-w-0 whitespace-normal">Toutes</ToggleGroup.Item>
					<ToggleGroup.Item value="points" class="max-w-full min-w-0 whitespace-normal"
						>Points à examiner</ToggleGroup.Item
					>
					<ToggleGroup.Item value="comments" class="max-w-full min-w-0 whitespace-normal"
						>Commentaires à examiner</ToggleGroup.Item
					>
				</ToggleGroup.Root>
				<p role="status" class="text-sm text-muted-foreground">
					{filteredQueue.length} proposition{filteredQueue.length > 1 ? 's' : ''}
				</p>
			</div>
		{/if}
		{#if !data.queue.length}<Empty.Root variant="surface"
				><Empty.Header
					><Empty.Media variant="icon"><ClipboardCheckIcon aria-hidden="true" /></Empty.Media><Empty.Title
						>Aucune proposition à examiner</Empty.Title
					><Empty.Description
						>Une application autorisée peut vous soumettre des points et un commentaire privé à examiner. Vous pouvez
						aussi corriger directement depuis la notation.</Empty.Description
					></Empty.Header
				><Empty.Content class="gap-3"
					><Button href={gradingPath}>Corriger depuis la notation</Button>
					<Button href={resolve('/enseignant/applications')} variant="outline">Voir les applications connectées</Button>
					<Button type="button" variant="ghost" class="min-h-11" disabled={refreshing || deciding} onclick={retry}
						>Actualiser</Button
					></Empty.Content
				></Empty.Root
			>
		{:else if !filteredQueue.length}<Empty.Root variant="surface">
				<Empty.Header
					><Empty.Media variant="icon"><SearchXIcon aria-hidden="true" /></Empty.Media><Empty.Title
						>Aucune proposition pour ces filtres</Empty.Title
					><Empty.Description>Modifiez le nom recherché ou affichez toutes les propositions.</Empty.Description
					></Empty.Header
				>
				<Empty.Content
					><Button variant="outline" onclick={resetFilters}>Réinitialiser les filtres</Button></Empty.Content
				>
			</Empty.Root>
		{:else}<section aria-label="Liste des propositions" class="proposal-queue min-w-0">
				<Table.Root
					><Table.Caption class="sr-only">Propositions de correction par étudiant et évaluation</Table.Caption
					><Table.Header
						><Table.Row
							><Table.Head>Étudiant</Table.Head><Table.Head>Classe et module</Table.Head><Table.Head
								>Évaluation</Table.Head
							><Table.Head>Décision</Table.Head><Table.Head><span class="sr-only">Ouvrir</span></Table.Head></Table.Row
						></Table.Header
					><Table.Body
						>{#each filteredQueue as item (item.id)}<Table.Row
								class="cursor-pointer focus-within:bg-muted"
								onclick={followRowLink}
								><Table.Cell class="proposal-student wrap-anywhere whitespace-normal">{item.studentName}</Table.Cell
								><Table.Cell class="wrap-anywhere whitespace-normal"
									>{item.className} · {item.academicYear}<br />{item.moduleTitle}</Table.Cell
								><Table.Cell class="wrap-anywhere whitespace-normal">{item.assessmentTitle}</Table.Cell><Table.Cell
									><Badge
										variant={item.state === 'pending' || item.commentState === 'pending' ? 'secondary' : 'outline'}
										>{stateLabel(item)}</Badge
									></Table.Cell
								><Table.Cell
									><Button
										href={resolve('/enseignant/propositions') + `?proposition=${item.id}&contexte=${item.contextId}`}
										variant="outline"
										data-row-link
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

<style>
	.queue-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 1rem 1.5rem;
		padding-block: 1.25rem;
		border-block: 1px solid var(--border);
	}
	.queue-toolbar :global([data-slot='field-group']) {
		flex: 1 1 18rem;
	}
	.queue-toolbar :global([data-slot='toggle-group']) {
		flex-wrap: wrap;
	}

	.proposal-queue {
		border-radius: var(--radius);
		background: var(--card);
		overflow: hidden;
	}
	.proposal-queue :global(.proposal-student) {
		font-weight: 600;
	}
	@media (max-width: 47.99rem) {
		.proposal-queue :global([data-slot='table-container']) {
			overflow: visible;
		}
		.proposal-queue :global(table),
		.proposal-queue :global(tbody) {
			display: block;
		}
		.proposal-queue :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.proposal-queue :global(tbody tr) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 0.5rem 1rem;
			padding: 1rem;
		}
		.proposal-queue :global(td) {
			padding: 0;
			white-space: normal;
		}
		.proposal-queue :global(td:nth-child(1)),
		.proposal-queue :global(td:nth-child(2)),
		.proposal-queue :global(td:nth-child(3)) {
			grid-column: 1 / -1;
		}
		.proposal-queue :global(td:nth-child(2)),
		.proposal-queue :global(td:nth-child(3)) {
			color: var(--muted-foreground);
		}
	}
</style>
