<script lang="ts">
	import { tick, untrack, onMount } from 'svelte';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		defaults,
		setError,
		superForm,
		type FormPathLeavesWithErrors
	} from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LockKeyholeIcon from '@lucide/svelte/icons/lock-keyhole';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import {
		publicationDecisionSchema,
		publicationReceiptSchema,
		publicationSections,
		type PublicationDecision,
		type PublicationReceipt,
		type PublicationReviewData,
		type PublicationSelection
	} from '#lib/domain/publication.js';
	import { saveTeaching, TeachingRequestError } from '#lib/teaching/api.js';
	import PublicCourse from './PublicCourse.svelte';

	let { data }: { data: PublicationReviewData } = $props();
	// The reviewed projection changes only after deliberate navigation or refresh.
	let review = $state.raw(untrack(() => data));
	const selected = $derived(review.selected);
	const preview = $derived(selected?.draft ?? selected?.published ?? null);
	const idPrefix = $derived(`review-${selected?.context.id ?? review.module.id}`);
	const sections = publicationSections;
	const returnSection = $derived(
		['information', 'preparation', 'resources', 'planning'].includes(
			page.url.searchParams.get('section') ?? ''
		)
			? page.url.searchParams.get('section')
			: null
	);
	const returnQuery = $derived(
		new URLSearchParams({
			...(selected?.context.classId
				? { classe: selected.context.classId, contexte: selected.context.id }
				: {}),
			...(returnSection ? { section: returnSection } : {})
		}).toString()
	);
	const identityChanged = $derived(
		!!selected?.draft &&
			!!selected.published &&
			JSON.stringify([
				selected.draft.title,
				selected.draft.description,
				selected.draft.objectives
			]) !==
				JSON.stringify([
					selected.published.title,
					selected.published.description,
					selected.published.objectives
				])
	);
	const initialCommand = untrack(() =>
		commandFor(data.selected, 'publish', '00000000-0000-4000-8000-000000000000')
	);
	const decisionForm = superForm<PublicationDecision>(
		defaults(initialCommand, zod4Client(publicationDecisionSchema)),
		{
			id: 'publication-decision',
			validators: zod4Client(publicationDecisionSchema),
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const { form: commandData, errors: commandErrors, allErrors } = decisionForm;
	let activeSection = $state('supports');
	let pending = $state(false);
	let refreshing = $state(false);
	let changingContext = $state(false);
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
	const busy = $derived(pending || refreshing || changingContext);
	let confirmOpen = $state(false);
	let errorMessage = $state('');
	let status = $state('');
	let conflict = $state(false);
	let needsRefresh = $state(false);
	let receipt = $state.raw<PublicationReceipt | null>(null);
	let feedback = $state<HTMLDivElement | null>(null);
	let retry: { signature: string; command: PublicationDecision } | null = null;
	const canPublish = $derived(
		hydrated &&
			!!selected?.draft &&
			!selected.context.archived &&
			!busy &&
			!conflict &&
			!needsRefresh
	);
	const canUnpublish = $derived(
		hydrated && selected?.status === 'published' && !busy && !conflict && !needsRefresh
	);

	function commandFor(
		selection: PublicationSelection | null,
		action: PublicationDecision['action'],
		requestId: string
	): PublicationDecision {
		return {
			requestId,
			contextId: selection?.context.id ?? '00000000-0000-4000-8000-000000000000',
			action,
			expectedRevision: selection?.publicationRevision ?? 0,
			moduleRevision: selection?.moduleRevision ?? 1,
			contextRevision: selection?.contextRevision ?? 1,
			classRevision: selection?.classRevision ?? 0,
			confirm: true
		};
	}
	function date(value: string) {
		return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(
			new Date(value)
		);
	}
	function stateLabel(selection: PublicationSelection) {
		if (selection.status === 'published') return 'Publié';
		if (selection.status === 'unpublished') return 'Dépublié';
		if (selection.status === 'legacy') return 'À republier';
		return 'Non publié';
	}
	function sectionChanged(id: string) {
		if (!selected?.draft || !selected.published) return false;
		const before = selected.published;
		const after = selected.draft;
		if (
			id === 'supports' &&
			JSON.stringify(before.studentContent.exercises) !==
				JSON.stringify(after.studentContent.exercises)
		)
			return true;
		if (
			id === 'consignes' &&
			JSON.stringify([
				before.studentContent.instructions,
				before.studentContent.projectInstructions,
				before.rubric
			]) !==
				JSON.stringify([
					after.studentContent.instructions,
					after.studentContent.projectInstructions,
					after.rubric
				])
		)
			return true;
		if (id === 'remise')
			return JSON.stringify(before.deadlines) !== JSON.stringify(after.deadlines);
		if (id === 'suivi')
			return (
				JSON.stringify([before.recap, before.toDo, before.lessonNotes]) !==
				JSON.stringify([after.recap, after.toDo, after.lessonNotes])
			);
		const kinds =
			id === 'supports'
				? ['course']
				: id === 'consignes'
					? ['instructions', 'rubric']
					: ['resource'];
		return (
			JSON.stringify(before.resources.filter((link) => kinds.includes(link.kind))) !==
			JSON.stringify(after.resources.filter((link) => kinds.includes(link.kind)))
		);
	}
	function applyRequestErrors(fields: Record<string, string>) {
		const snapshot = defaults($commandData, zod4Client(publicationDecisionSchema));
		for (const [path, message] of Object.entries(fields)) {
			const field =
				path in publicationDecisionSchema.shape
					? (path as FormPathLeavesWithErrors<PublicationDecision>)
					: '';
			setError(snapshot, field, message, { overwrite: true });
		}
		$commandErrors = snapshot.errors;
	}
	async function focusFeedback() {
		await tick();
		feedback?.focus();
	}
	function applyReview() {
		review = data;
		activeSection = 'supports';
		$commandData = commandFor(review.selected, 'publish', '00000000-0000-4000-8000-000000000000');
		$commandErrors = {};
		retry = null;
		receipt = null;
		conflict = false;
		needsRefresh = false;
	}
	async function changeContext(contextId: string) {
		if (busy || contextId === selected?.context.id) return;
		changingContext = true;
		errorMessage = '';
		try {
			await goto(
				resolve(
					`/enseignant/modules/[moduleId]/publication?${new URLSearchParams({ contexte: contextId, ...(returnSection ? { section: returnSection } : {}) })}`,
					{ moduleId: review.module.id }
				)
			);
			await tick();
			applyReview();
			status = 'Contexte chargé. Vérifiez son contenu avant de publier.';
		} catch {
			errorMessage =
				'Cette classe n’a pas pu être ouverte. La vérification actuelle est conservée.';
			await focusFeedback();
		} finally {
			changingContext = false;
		}
	}
	async function refreshReview() {
		if (busy) return;
		refreshing = true;
		errorMessage = '';
		try {
			await refreshAll();
			await tick();
			applyReview();
			status = 'Version actuelle chargée. Vérifiez à nouveau le contenu avant de publier.';
		} catch {
			errorMessage = 'Actualisation impossible. La version que vous avez examinée est conservée.';
			await focusFeedback();
		} finally {
			refreshing = false;
		}
	}
	async function decide(action: PublicationDecision['action']) {
		if (!selected || (action === 'publish' ? !canPublish : !canUnpublish)) return;
		confirmOpen = false;
		pending = true;
		errorMessage = '';
		status = '';
		try {
			const base = commandFor(selected, action, '00000000-0000-4000-8000-000000000000');
			const signature = JSON.stringify(base);
			if (retry?.signature !== signature)
				retry = { signature, command: { ...base, requestId: crypto.randomUUID() } };
			$commandData = retry.command;
			const validated = await decisionForm.validateForm({ update: true, focusOnError: false });
			if (!validated.valid) {
				errorMessage =
					'La décision ne peut pas être envoyée. Actualisez les références puis vérifiez le contenu.';
				await focusFeedback();
				return;
			}
			const command = publicationDecisionSchema.parse(validated.data);
			const result = await saveTeaching<unknown>(
				`/api/teaching/modules/${review.module.id}/publication`,
				command,
				'POST',
				command.requestId
			);
			receipt = publicationReceiptSchema.parse(result);
			status =
				action === 'publish'
					? 'La page du module est publiée.'
					: 'La page du module est dépubliée.';
			needsRefresh = true;
			try {
				await refreshAll();
				await tick();
				applyReview();
			} catch {
				errorMessage =
					'La décision est enregistrée, mais l’actualisation a échoué. Actualisez les références avant une nouvelle décision.';
				await focusFeedback();
			}
		} catch (error) {
			if (error instanceof TeachingRequestError) {
				conflict = error.status === 409;
				applyRequestErrors(error.fields);
				errorMessage = conflict
					? 'Le module, cette classe ou sa publication a changé. Votre aperçu est conservé. Actualisez les références, puis vérifiez la nouvelle version avant de décider.'
					: error.message;
			} else
				errorMessage =
					'La réponse n’a pas pu être confirmée. Votre aperçu est conservé ; réessayez la même décision.';
			await focusFeedback();
		} finally {
			pending = false;
		}
	}
	async function publish(event: SubmitEvent) {
		event.preventDefault();
		await decide('publish');
	}
	async function copyLink(path: string) {
		try {
			await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
			status = 'Lien copié.';
		} catch {
			errorMessage = 'Le lien n’a pas pu être copié. Ouvrez la page et copiez son adresse.';
			await focusFeedback();
		}
	}
</script>

<div class="publication-review flex min-w-0 flex-col gap-5">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="flex min-w-0 flex-col gap-2">
			<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Publication du module</h1>
			<p class="text-sm text-muted-foreground">{review.module.title}</p>
		</div>
		<div class="flex items-center gap-2">
			<Button
				variant="ghost"
				class="min-h-11"
				href={`${resolve('/enseignant/modules/[moduleId]', { moduleId: review.module.id })}${returnQuery ? '?' + returnQuery : ''}`}
				disabled={busy}
			>
				<ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />Retour au module
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-11"
				disabled={busy}
				onclick={refreshReview}
				aria-label="Actualiser les références"
				title="Actualiser les références"
			>
				<RefreshCwIcon aria-hidden="true" />
			</Button>
		</div>
	</div>
	{#if errorMessage || $allErrors.length > 0}
		<Alert.Root
			variant="destructive"
			bind:ref={feedback}
			tabindex={-1}
			class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		>
			<CircleAlertIcon aria-hidden="true" />
			<Alert.Title
				>{conflict
					? 'Version à vérifier de nouveau'
					: receipt
						? 'Décision enregistrée'
						: 'Publication interrompue'}</Alert.Title
			>
			<Alert.Description>
				<div class="flex flex-col gap-3">
					<p>{errorMessage}</p>
					{#if $allErrors.length > 0}<ul class="flex list-disc flex-col gap-1 pl-5">
							{#each $allErrors as issue (issue.path)}{#each issue.messages as message (message)}<li
									>
										{message}
									</li>{/each}{/each}
						</ul>{/if}
					<Button
						type="button"
						variant="outline"
						class="self-start"
						disabled={busy}
						onclick={refreshReview}
					>
						<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />Actualiser les références
					</Button>
				</div>
			</Alert.Description>
		</Alert.Root>
	{/if}
	{#if !review.contexts.length || !selected}
		<Empty.Root>
			<Empty.Header>
				<Empty.Title>Aucune classe pour cette publication</Empty.Title>
				<Empty.Description
					>Rattachez le module à une classe et une année dans le module, puis revenez vérifier son
					contenu public.</Empty.Description
				>
			</Empty.Header>
			<Empty.Content
				><Button
					variant="outline"
					href={resolve('/enseignant/modules/[moduleId]', { moduleId: review.module.id })}
					>Modifier les classes du module</Button
				></Empty.Content
			>
		</Empty.Root>
	{:else}
		<form
			id="publication-decision"
			novalidate
			onsubmit={publish}
			aria-busy={busy}
			class="decision-form flex min-w-0 flex-col gap-5"
		>
			<Field.FieldGroup>
				<Field.Field data-invalid={!!$commandErrors.contextId?.length} data-disabled={busy}>
					<Form.Field form={decisionForm} name="contextId" class="context-field">
						<Form.Control id="publication-context">
							{#snippet children({ props })}
								<Form.Label>Classe et année</Form.Label>
								<NativeSelect.Root
									{...props}
									class="context-select"
									disabled={busy}
									bind:value={
										() => $commandData.contextId, (value) => void changeContext(String(value))
									}
								>
									{#each review.contexts as context (context.id)}<NativeSelect.Option
											value={context.id}
											>{context.className} · {context.academicYear}{context.archived
												? ' · classe archivée'
												: ''}</NativeSelect.Option
										>{/each}
								</NativeSelect.Root>
							{/snippet}
						</Form.Control>
						<Form.Description
							>Le module est réutilisable. Cette publication concerne uniquement la classe et
							l’année choisies.</Form.Description
						>
						<Form.FieldErrors aria-live="polite" />
					</Form.Field>
				</Field.Field>
			</Field.FieldGroup>
			{#if selected.context.archived}
				<Alert.Root
					><Alert.Title>Classe archivée</Alert.Title><Alert.Description
						>Sa publication peut rester consultable ou être dépubliée. Ce contexte ne peut plus
						recevoir de nouvelle publication.</Alert.Description
					></Alert.Root
				>
			{:else if selected.status === 'legacy'}
				<Alert.Root
					><Alert.Title>Une nouvelle vérification est nécessaire</Alert.Title><Alert.Description
						>L’ancienne publication n’est pas consultable. Vérifiez cet aperçu puis republiez le
						module pour cette classe.</Alert.Description
					></Alert.Root
				>
			{/if}
			<div class="review-layout grid min-w-0 gap-7">
				<aside
					class="review-rail flex min-w-0 flex-col gap-4"
					aria-label="Vérification de la publication"
				>
					<div class="flex flex-col gap-3">
						<h2 class="text-lg font-semibold tracking-tight">Contenu à vérifier</h2>
						<p class="text-xs text-muted-foreground">
							Ces sections servent à naviguer dans l’aperçu.
						</p>
						{#if identityChanged}<Badge variant="secondary"
								>Titre, description ou objectifs modifiés</Badge
							>{/if}
						<nav aria-label="Sections de l’aperçu" class="flex flex-col gap-1">
							{#each sections as section (section.id)}
								<a
									href={`#${idPrefix}`}
									aria-current={activeSection === section.id ? 'location' : undefined}
									onclick={() => (activeSection = section.id)}
									class={cn(
										'review-section-link flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
										activeSection === section.id && 'bg-muted font-medium'
									)}
								>
									<ChevronRightIcon class="size-4 shrink-0" aria-hidden="true" />
									<span class="min-w-0 flex-1"
										>{section.label}{#if section.id === 'suivi'}<span
												class="mt-1 block text-xs text-muted-foreground">Facultatif</span
											>{/if}</span
									>
									{#if sectionChanged(section.id)}<Badge variant="secondary">Modifié</Badge>{/if}
								</a>
							{/each}
						</nav>
					</div>
					<Separator />
					<div class="publication-state flex flex-col items-start gap-2">
						<Badge variant={selected.status === 'published' ? 'outline' : 'secondary'}>
							{stateLabel(selected)}{#if selected.status === 'published' && selected.publishedAt}
								le <time datetime={selected.publishedAt}>{date(selected.publishedAt)}</time
								>{:else if selected.status === 'unpublished' && selected.unpublishedAt}
								le <time datetime={selected.unpublishedAt}>{date(selected.unpublishedAt)}</time
								>{/if}
						</Badge>
						{#if selected.status === 'published'}
							<p class="state-copy text-muted-foreground">
								{selected.changed
									? 'Le brouillon a changé. La version publiée reste visible jusqu’à votre décision.'
									: 'Le brouillon enregistré correspond à la version publiée.'}
							</p>
						{:else if selected.status === 'unpublished'}
							<p class="state-copy text-muted-foreground">
								La page du module n’est plus consultable.
							</p>
						{:else if selected.status === 'draft'}
							<p class="state-copy text-muted-foreground">
								Ce module n’a pas encore de page publique pour cette classe.
							</p>
						{/if}
						<div class="flex max-w-full flex-wrap items-center gap-2">
							{#if selected.status === 'published'}
								<Button
									class="min-h-11"
									variant="outline"
									href={selected.publicPath}
									target="_blank"
									rel="noreferrer"
									><ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />Voir la page
									publiée<span class="sr-only"> · nouvel onglet</span></Button
								>
							{/if}
							{#if selected.status === 'published' || selected.classPath}
								<DropdownMenu.Root>
									<DropdownMenu.Trigger disabled={busy}>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="ghost"
												size={selected.status === 'published' ? 'icon' : 'default'}
												class={cn('min-h-11', selected.status === 'published' && 'size-11')}
												aria-label="Copier un lien"
												title="Copier un lien"
											>
												<CopyIcon
													data-icon="inline-start"
													aria-hidden="true"
												/>{#if selected.status !== 'published'}Copier un lien<ChevronDownIcon
														data-icon="inline-end"
														aria-hidden="true"
													/>{/if}
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="start">
										<DropdownMenu.Group>
											{#if selected.status === 'published'}<DropdownMenu.Item
													class="min-h-11"
													disabled={busy}
													onSelect={() => copyLink(selected.publicPath)}
													><CopyIcon aria-hidden="true" />Copier le lien du module</DropdownMenu.Item
												>{/if}
											{#if selected.classPath}<DropdownMenu.Item
													class="min-h-11"
													disabled={busy}
													onSelect={() => copyLink(selected.classPath!)}
													><CopyIcon aria-hidden="true" />Copier le lien de la classe</DropdownMenu.Item
												>{/if}
										</DropdownMenu.Group>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							{/if}
						</div>
					</div>
					<p class="text-xs leading-relaxed text-muted-foreground">
						Aucun nom d’étudiant, note individuelle ou commentaire privé ne figure dans cet aperçu.
					</p>
				</aside>
				<section
					class="preview-frame min-w-0 rounded-xl border"
					aria-label="Aperçu privé du contenu étudiant"
				>
					<div
						class="flex min-h-11 flex-wrap items-center gap-2 rounded-t-xl border-b bg-muted/50 px-5 py-2 text-xs text-muted-foreground"
					>
						<LockKeyholeIcon class="size-4" aria-hidden="true" />{selected.draft
							? 'Aperçu du brouillon enregistré · privé'
							: 'Aperçu de la dernière publication · privé'}{#if selected.changed}<Badge
								variant="secondary">Modifications à publier</Badge
							>{/if}
					</div>
					<div class="preview-content min-w-0 p-5 sm:px-7" data-course-scroll>
						{#if preview}<PublicCourse
								data={{
									contextId: selected.context.id,
									snapshot: preview,
									publishedAt: selected.publishedAt ?? '',
									classPath: selected.classPath
								}}
								preview
								bind:activeSection
							/>{:else}<Empty.Root
								><Empty.Header
									><Empty.Title>Aucun contenu à prévisualiser</Empty.Title><Empty.Description
										>Ce contexte archivé ne possède pas de publication consultable.</Empty.Description
									></Empty.Header
								></Empty.Root
							>{/if}
					</div>
				</section>
			</div>
			<footer class="decision-bar editor-save-bar flex flex-col gap-4">
				<Separator />
				<div class="decision-content flex flex-col gap-4">
					<div class="decision-copy min-w-0">
						<Form.Field form={decisionForm} name="action" class="action-field">
							<Form.Control id="publication-action">
								{#snippet children({ props })}
									<Form.Label class="sr-only">Décision de publication</Form.Label>
									<input {...props} type="hidden" bind:value={$commandData.action} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors aria-live="polite" />
						</Form.Field>
						<p class="text-xs leading-relaxed text-muted-foreground">
							{selected.context.archived
								? 'La page conservée reste indépendante de la classe archivée.'
								: `Publier met à jour cette page de ${selected.context.className} · ${selected.context.academicYear}.`}
							<br />Les droits Drive restent indépendants. Remplacer un fichier partagé change
							immédiatement son contenu depuis son lien.
						</p>
					</div>
					<div class="decision-actions flex flex-wrap items-center gap-2">
						{#if selected.status === 'published'}<Button
								type="button"
								variant="ghost"
								class="min-h-11"
								disabled={!canUnpublish}
								onclick={() => (confirmOpen = true)}>Dépublier</Button
							>{/if}
						{#if !selected.context.archived}<Button
								type="submit"
								class="min-h-11"
								disabled={!canPublish || (selected.status === 'published' && !selected.changed)}
							>
								{#if pending}<Spinner data-icon="inline-start" />{/if}{pending
									? 'Enregistrement…'
									: selected.status === 'published'
										? 'Publier la mise à jour'
										: 'Publier pour cette classe'}<ArrowRightIcon
									data-icon="inline-end"
									aria-hidden="true"
								/>
							</Button>{/if}
					</div>
				</div>
			</footer>
		</form>
	{/if}
	<p
		role="status"
		aria-live="polite"
		class={cn('text-sm text-muted-foreground', !busy && !status && 'sr-only')}
	>
		{pending
			? 'Décision de publication en cours…'
			: refreshing
				? 'Actualisation des références…'
				: changingContext
					? 'Ouverture de la classe…'
					: status}
	</p>
</div>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content class="max-h-[calc(100svh-2rem)] overflow-y-auto">
		<AlertDialog.Header>
			<AlertDialog.Title>Dépublier ce module ?</AlertDialog.Title>
			<AlertDialog.Description
				>La page de {selected?.context.className} · {selected?.context.academicYear} ne sera plus consultable
				depuis son lien ni depuis la classe. Les fichiers partagés conservent leurs droits actuels.</AlertDialog.Description
			>
		</AlertDialog.Header>
		<AlertDialog.Footer
			><AlertDialog.Cancel disabled={busy}>Garder la page publiée</AlertDialog.Cancel
			><AlertDialog.Action disabled={!canUnpublish} onclick={() => decide('unpublish')}
				>Dépublier ce module</AlertDialog.Action
			></AlertDialog.Footer
		>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	.publication-review {
		padding-bottom: env(safe-area-inset-bottom, 0px);
		overflow-wrap: anywhere;
	}
	.publication-review :global([data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.publication-review :global(.context-field) {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.5rem;
	}
	.publication-review :global(.context-field > *) {
		margin-block: 0;
	}
	.publication-review :global(.context-select) {
		width: 100%;
		max-width: 100%;
	}
	.publication-review :global(.context-field [data-slot='form-description']) {
		max-width: 19rem;
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.publication-review :global(.action-field) {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.publication-review :global(.action-field > *) {
		margin-block: 0;
	}
	.preview-frame {
		container-type: inline-size;
	}
	.preview-content {
		position: relative;
		scroll-padding: 1.5rem;
		scrollbar-gutter: stable;
	}
	.review-rail {
		align-self: start;
	}
	.review-section-link {
		min-height: 3.25rem;
	}
	.state-copy {
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	@media (min-width: 64rem) {
		.publication-review :global(.context-field) {
			display: grid;
			grid-template-columns: max-content minmax(14rem, 15rem) minmax(0, 19rem);
			justify-content: start;
			align-items: center;
			column-gap: 0.75rem;
		}
		.publication-review :global(.context-field [data-slot='form-label']) {
			white-space: nowrap;
		}
		.publication-review :global(.context-field [data-fs-field-errors]) {
			grid-column: 2 / -1;
		}
	}
	@media (min-width: 80rem) {
		.review-layout {
			grid-template-columns: 16.75rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
		.preview-frame {
			display: flex;
			height: min(33.25rem, calc(100dvh - 23rem));
			min-height: 24rem;
			flex-direction: column;
		}
		.preview-content {
			min-height: 0;
			flex: 1;
			overflow-y: auto;
			overscroll-behavior: contain;
		}
		.decision-content {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
		.decision-copy {
			flex: 1;
			max-width: 38rem;
		}
		.decision-actions {
			flex-shrink: 0;
		}
	}
	@media (min-width: 48rem) and (pointer: fine) {
		.publication-review :global([data-slot='native-select']) {
			font-size: 0.875rem;
		}
	}
</style>
