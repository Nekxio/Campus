<script lang="ts">
	import { browser } from '$app/env';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { tick, untrack, onMount } from 'svelte';
	import { z } from 'zod';
	import { afterNavigate, beforeNavigate, goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { defaults, setError, superForm, type FormPathLeavesWithErrors } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import {
		annualActionSchema,
		type AnnualAction,
		type AnnualHistory as AnnualHistoryData,
		type AnnualPageData,
		type AnnualPreview,
		type AnnualReceipt
	} from '#lib/domain/annual.js';
	import { annualHistorySchema } from '#lib/teaching/action-responses.js';
	import { finalGradeExportSchema } from '#lib/domain/grade-export.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import AnnualConfirmation from './AnnualConfirmation.svelte';
	import AnnualHistory from './AnnualHistory.svelte';
	import AnnualSummary from './AnnualSummary.svelte';
	import AnnualDecision from './AnnualDecision.svelte';

	let { data }: { data: AnnualPageData } = $props();
	// Keep the reviewed scope stable until deliberate navigation or refresh.
	let review = $state.raw(untrack(() => data));
	const selected = $derived(review.selected);
	const initial = untrack(() => data.selected);
	function commandFor(preview: AnnualPreview | null, action: AnnualAction['action']): AnnualAction {
		return {
			academicYear: preview?.academicYear ?? '0000-0001',
			action,
			reviewToken: preview?.reviewToken ?? '0'.repeat(64),
			requestId: '00000000-0000-4000-8000-000000000000',
			typedYear: '',
			pdfsKept: false
		};
	}
	const archiveForm = superForm<AnnualAction>(
		defaults(commandFor(initial, 'archive'), zod4Client(annualActionSchema)),
		{
			id: 'annual-archive',
			dataType: 'json',
			invalidateAll: false,
			validators: zod4Client(annualActionSchema),
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const reopenForm = superForm<AnnualAction>(defaults(commandFor(initial, 'reopen'), zod4Client(annualActionSchema)), {
		id: 'annual-reopen',
		dataType: 'json',
		invalidateAll: false,
		validators: zod4Client(annualActionSchema),
		applyAction: 'never',
		resetForm: false,
		taintedMessage: false
	});
	const archiveTransport = createFormActionTransport(archiveForm);
	const reopenTransport = createFormActionTransport(reopenForm);
	const purgeCommandForm = superForm<AnnualAction>(
		defaults(commandFor(initial, 'purge'), zod4Client(annualActionSchema)),
		{
			id: 'annual-purge-command',
			dataType: 'json',
			invalidateAll: false,
			validators: zod4Client(annualActionSchema),
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const purgeTransport = createFormActionTransport(purgeCommandForm);
	type DecisionSender = (command: AnnualAction, decode: (value: unknown) => AnnualReceipt) => Promise<AnnualReceipt>;
	const sendDecision: DecisionSender = (command, decode) =>
		(command.action === 'purge'
			? purgeTransport
			: command.action === 'archive'
				? archiveTransport
				: reopenTransport
		).submit(resolve('/enseignant/classes/annees') + '?/decideYear', command, decode);
	const { allErrors: archiveAllErrors } = archiveForm;
	const { allErrors: reopenAllErrors } = reopenForm;
	const receiptSchema = z.strictObject({
		version: z.literal(1),
		requestId: z.uuid(),
		academicYear: z.string(),
		action: z.enum(['archive', 'reopen', 'purge']),
		completedAt: z.iso.datetime(),
		removed: z.strictObject({
			classes: z.int().nonnegative(),
			students: z.int().nonnegative(),
			corrections: z.int().nonnegative(),
			scores: z.int().nonnegative(),
			comments: z.int().nonnegative(),
			proposals: z.int().nonnegative(),
			decisions: z.int().nonnegative()
		}),
		calendar: z.strictObject({ connection: z.boolean(), lessons: z.int().nonnegative() }).optional()
	});
	let pending = $state(false);
	let refreshing = $state(false);
	let changingYear = $state(false);
	let pdfPending = $state<string | null>(null);
	let historyPending = $state<string | null>(null);
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
	const busy = $derived(pending || refreshing || changingYear || pdfPending !== null || historyPending !== null);
	let needsRefresh = $state(false);
	let confirmOpen = $state(false);
	let reviewChoice = $state<'archive' | 'close' | 'history' | null>(null);
	let retryCommand = $state.raw<AnnualAction | null>(null);
	let errorMessage = $state('');
	let status = $state('');
	let receipt = $state.raw<AnnualReceipt | null>(null);
	let feedback: HTMLDivElement | null = null;
	let openHistory = $state<string | null>(null);
	let histories = $state.raw<Record<string, AnnualHistoryData>>({});
	let historyErrors = $state.raw<Record<string, string>>({});
	let pdfFeedback = $state.raw<Record<string, { message: string; failed: boolean }>>({});
	const canDecide = $derived(hydrated && !!selected && !busy && !needsRefresh && retryCommand === null);
	const canArchive = $derived(
		canDecide && selected?.status === 'active' && (selected.contexts.length > 0 || selected.classes.length > 0)
	);
	const canReopen = $derived(canDecide && selected?.status === 'archived' && selected.classes.length > 0);
	const canPurge = $derived(canDecide && selected?.status !== 'purged' && (selected?.removed.classes ?? 0) > 0);
	const scopeLocked = $derived(busy || confirmOpen || retryCommand !== null);
	beforeNavigate((navigation) => {
		if (
			!navigation.willUnload &&
			navigation.to?.route.id === '/enseignant/classes/annees' &&
			(navigation.to.url.searchParams.get('annee') ?? '') !== (selected?.academicYear ?? '') &&
			(pending || confirmOpen || retryCommand !== null || pdfPending !== null || historyPending !== null)
		)
			navigation.cancel();
	});
	afterNavigate((navigation) => {
		if (navigation.type === 'enter' || scopeLocked || data === review) return;
		// Browser back/forward is also a deliberate change of the reviewed year.
		applyReview();
		receipt = null;
		errorMessage = '';
		status = review.selected ? `Dossier de l’année ${review.selected.academicYear} chargé.` : '';
	});

	async function focusFeedback() {
		if (errorMessage) notify(errorMessage, 'error');
		await tick();
		feedback?.focus();
	}
	function feedbackElement(node: HTMLDivElement) {
		feedback = node;
		return () => {
			feedback = null;
		};
	}
	function applyReview() {
		reviewChoice = null;
		review = data;
		archiveForm.form.set(commandFor(review.selected, 'archive'));
		reopenForm.form.set(commandFor(review.selected, 'reopen'));
		archiveForm.errors.set({});
		reopenForm.errors.set({});
		retryCommand = null;
		needsRefresh = false;
		histories = {};
		historyErrors = {};
		pdfFeedback = {};
		openHistory = null;
	}
	async function changeYear(academicYear: string) {
		if (scopeLocked || academicYear === selected?.academicYear) return;
		changingYear = true;
		errorMessage = '';
		try {
			const destination = (resolve('/enseignant/classes/annees') +
				(academicYear ? `?annee=${encodeURIComponent(academicYear)}` : '')) as ResolvedPathname;
			await goto(destination);
			await tick();
			applyReview();
			receipt = null;
			status = academicYear ? `Dossier de l’année ${academicYear} chargé.` : '';
		} catch {
			errorMessage = 'Cette année n’a pas pu être ouverte. Le dossier actuel est conservé.';
			await focusFeedback();
		} finally {
			changingYear = false;
		}
	}
	async function reloadReview() {
		if (busy || retryCommand !== null) return;
		confirmOpen = false;
		refreshing = true;
		errorMessage = '';
		status = '';
		try {
			await refreshAll();
			await tick();
			applyReview();
			status = 'Dossier actualisé. Vérifiez les données avant une nouvelle décision.';
		} catch {
			errorMessage = 'Actualisation impossible. Le dossier examiné est conservé ; réessayez.';
			await focusFeedback();
		} finally {
			refreshing = false;
		}
	}
	async function mutate(command: AnnualAction): Promise<Record<string, string> | null> {
		if (
			busy ||
			needsRefresh ||
			!selected ||
			command.academicYear !== selected.academicYear ||
			command.reviewToken !== selected.reviewToken
		)
			return null;
		// Once sent, the exact body and request ID remain available until its result is known.
		retryCommand = command;
		pending = true;
		errorMessage = '';
		status = '';
		try {
			const result = await sendDecision(command, (value) =>
				receiptSchema
					.refine(
						(result) =>
							result.requestId === command.requestId &&
							result.academicYear === command.academicYear &&
							result.action === command.action
					)
					.parse(value)
			);
			receipt = result;
			retryCommand = null;
			confirmOpen = false;
			needsRefresh = true;
			status =
				command.action === 'archive'
					? `L’année ${command.academicYear} est archivée. Ses données restent consultables.`
					: command.action === 'reopen'
						? `L’année ${command.academicYear} est rouverte pour le travail actif.`
						: `Les données étudiantes de l’année ${command.academicYear} ont été purgées.`;
			try {
				await refreshAll();
				await tick();
				applyReview();
			} catch {
				errorMessage = 'La décision est enregistrée. Actualisez le dossier pour consulter son nouvel état.';
			}
			await focusFeedback();
			return null;
		} catch (cause) {
			const error =
				cause instanceof TeachingRequestError
					? cause
					: new TeachingRequestError(
							0,
							'Le résultat de la demande est indisponible. Réessayez la même demande pour le vérifier.'
						);
			errorMessage = error.message;
			if (error.status === 409 || error.status === 404) {
				needsRefresh = true;
				retryCommand = null;
				errorMessage += ' Actualisez le dossier puis confirmez à nouveau la décision.';
			} else if (error.status >= 400 && error.status < 500) {
				retryCommand = null;
			}
			if (!confirmOpen) await focusFeedback();
			else notify(errorMessage, 'error');
			return error.fields;
		} finally {
			pending = false;
		}
	}
	async function retry(): Promise<Record<string, string> | null> {
		if (!retryCommand || busy || needsRefresh) return null;
		return mutate(retryCommand);
	}
	async function submitOrdinary(event: SubmitEvent, action: 'archive' | 'reopen') {
		event.preventDefault();
		if (!selected || (action === 'archive' ? !canArchive : !canReopen)) return;
		const form = action === 'archive' ? archiveForm : reopenForm;
		const command = { ...commandFor(selected, action), requestId: crypto.randomUUID() };
		form.form.set(command);
		const validated = await form.validateForm({ update: true });
		if (!validated.valid) {
			errorMessage = 'La décision ne peut pas être envoyée. Actualisez le dossier puis réessayez.';
			await focusFeedback();
			return;
		}
		const fields = await mutate(annualActionSchema.parse(validated.data));
		if (fields) {
			const snapshot = defaults(command, zod4Client(annualActionSchema));
			for (const [path, message] of Object.entries(fields))
				setError(
					snapshot,
					path in annualActionSchema.shape ? (path as FormPathLeavesWithErrors<AnnualAction>) : '',
					message,
					{ overwrite: true }
				);
			form.errors.set(snapshot.errors);
		}
	}
	async function download(context: AnnualPreview['contexts'][number]) {
		if (!browser) return;
		if (busy || needsRefresh || retryCommand || !selected || !context.pdf.ready || !context.rosterRetained) return;
		pdfPending = context.id;
		pdfFeedback = { ...pdfFeedback, [context.id]: { message: '', failed: false } };
		let problem = 'Impossible de préparer le PDF. Réessayez.';
		try {
			const response = await fetch(resolve('/api/teaching/contexts/[contextId]/export', { contextId: context.id }), {
				cache: 'no-store',
				credentials: 'same-origin'
			});
			if (response.status === 409 || response.status === 404) needsRefresh = true;
			const payload: unknown = await response.json();
			if (!response.ok) {
				const parsed = z.object({ message: z.string() }).safeParse(payload);
				problem = parsed.success ? parsed.data.message : 'Export indisponible. Réessayez.';
				throw new Error(problem);
			}
			const { document } = z.strictObject({ document: finalGradeExportSchema }).parse(payload);
			if (
				document.academicYear !== selected.academicYear ||
				document.className !== context.className ||
				document.moduleTitle !== context.moduleTitle
			)
				throw new Error('Unexpected export');
			const { downloadGradePdf } = await import('#lib/client/grade-pdf.js');
			await downloadGradePdf(document);
			notify('PDF de la classe préparé. Conservez le fichier nécessaire.');
			pdfFeedback = {
				...pdfFeedback,
				[context.id]: {
					message: `PDF préparé pour les ${document.students.length} étudiants de ${document.className}. Conservez le fichier nécessaire.`,
					failed: false
				}
			};
		} catch {
			pdfFeedback = { ...pdfFeedback, [context.id]: { message: problem, failed: true } };
			notify(problem, 'error');
			await tick();
			document.getElementById(`annual-pdf-error-${context.id}`)?.focus();
			if (needsRefresh)
				errorMessage = 'Les résultats ou le contexte ont changé. Actualisez le dossier avant toute nouvelle décision.';
		} finally {
			pdfPending = null;
		}
	}
	async function inspect(context: AnnualPreview['contexts'][number]) {
		if (busy || needsRefresh || retryCommand || !selected) return;
		if (openHistory === context.id) {
			openHistory = null;
			return;
		}
		openHistory = context.id;
		if (histories[context.id]) return;
		historyPending = context.id;
		historyErrors = { ...historyErrors, [context.id]: '' };
		try {
			const response = await fetch(
				`/api/teaching/years/${encodeURIComponent(selected.academicYear)}/contexts/${encodeURIComponent(context.id)}`,
				{ cache: 'no-store', credentials: 'same-origin' }
			);
			if (response.status === 409 || response.status === 404) needsRefresh = true;
			const payload: unknown = await response.json();
			if (!response.ok) {
				const parsed = z.object({ message: z.string() }).safeParse(payload);
				throw new Error(parsed.success ? parsed.data.message : 'Historique indisponible. Réessayez.');
			}
			const parsedHistory = annualHistorySchema.safeParse(payload);
			if (!parsedHistory.success)
				throw new Error('Le contenu de cet historique est indisponible. Actualisez le dossier.');
			const history = parsedHistory.data;
			if (
				history.academicYear !== selected.academicYear ||
				history.className !== context.className ||
				history.moduleTitle !== context.moduleTitle ||
				(!context.rosterRetained && history.grid !== null)
			)
				throw new Error('Le contenu de cet historique est indisponible. Actualisez le dossier.');
			histories = { ...histories, [context.id]: history };
		} catch (cause) {
			historyErrors = {
				...historyErrors,
				[context.id]:
					cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof SyntaxError)
						? cause.message
						: 'Historique indisponible. Réessayez.'
			};
			notify(historyErrors[context.id], 'error');
			await tick();
			document.getElementById(`annual-history-error-${context.id}`)?.focus();
			if (needsRefresh) errorMessage = 'Le contexte a changé. Actualisez le dossier avant toute nouvelle décision.';
		} finally {
			historyPending = null;
		}
	}
</script>

<ActionNotice message={status} />
<form method="POST" use:purgeTransport.enhance hidden novalidate></form>

<div class="annual-workspace page-sections">
	<div class="flex flex-col gap-2">
		<h1 class="page-title">Fin d’année et historique</h1>
		<p class="max-w-prose text-sm text-muted-foreground">
			Choisissez une année, puis archivez-la sans supprimer ses données ou préparez sa clôture.
		</p>
	</div>
	{#if review.years.length}
		<PrivacyNotice>
			L’archivage conserve les données étudiantes. La clôture de l’année les supprime après votre confirmation ; aucune
			suppression n’est automatique.
		</PrivacyNotice>
		<div class="annual-scope flex min-w-0 flex-wrap items-center gap-x-6 gap-y-4">
			<Field.Field class="w-full sm:w-64"
				><Field.FieldLabel for="annual-year">Année à consulter</Field.FieldLabel><NativeSelect.Root
					id="annual-year"
					class="w-full"
					value={selected?.academicYear ?? ''}
					disabled={scopeLocked || !review.years.length}
					onchange={(event) => changeYear(event.currentTarget.value)}
					><NativeSelect.Option value="">Choisir une année</NativeSelect.Option
					>{#each review.years as year (year)}<NativeSelect.Option value={year}>{year}</NativeSelect.Option
						>{/each}</NativeSelect.Root
				></Field.Field
			>
			{#if selected}
				<div class="flex w-full min-w-0 flex-wrap items-center gap-x-6 gap-y-2 sm:w-auto sm:flex-1">
					{#each selected.classes as item (item.id)}<p class="text-sm wrap-anywhere">
							<span class="font-medium">{item.name}</span><span class="ml-2 text-muted-foreground"
								>{item.studentCount} étudiant{item.studentCount > 1 ? 's' : ''}</span
							>
						</p>{/each}
				</div>
				<div class="flex flex-wrap items-center gap-3">
					<Badge variant="secondary"
						>{selected.status === 'purged'
							? 'Données étudiantes purgées'
							: selected.status === 'archived'
								? 'Année archivée'
								: 'Année active'}</Badge
					>
					<p class="text-sm text-muted-foreground tabular-nums">
						{#if selected.status !== 'purged'}{selected.removed.students} étudiant{selected.removed.students > 1
								? 's'
								: ''} ·
						{/if}{selected.preserved.contexts} suivi{selected.preserved.contexts > 1 ? 's' : ''} de module<br
						/>{selected.preserved.modules} module{selected.preserved.modules > 1 ? 's' : ''} réutilisable{selected
							.preserved.modules > 1
							? 's'
							: ''}
					</p>
				</div>
				<p class="w-full text-sm text-muted-foreground">
					Un suivi correspond à un module pour une classe et cette année.
				</p>
			{/if}
		</div>
	{/if}
	{#if changingYear || refreshing}<p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
			<Spinner />{changingYear ? 'Chargement du dossier…' : 'Actualisation du dossier…'}
		</p>{/if}
	{#if errorMessage || status || needsRefresh || retryCommand}
		<div {@attach feedbackElement} tabindex="-1" class="outline-none">
			{#if !confirmOpen && (errorMessage || needsRefresh || retryCommand)}
				<Alert.Root variant="destructive"
					><CircleAlertIcon aria-hidden="true" /><Alert.Title
						>{needsRefresh
							? 'Actualisation nécessaire'
							: retryCommand
								? 'Résultat de la demande à vérifier'
								: 'Demande indisponible'}</Alert.Title
					><Alert.Description class="flex flex-col gap-3"
						><p>{errorMessage}</p>
						{#if retryCommand}<p>
								La demande de {retryCommand.action === 'purge'
									? 'purge'
									: retryCommand.action === 'archive'
										? 'mise en archive'
										: 'réouverture'} concerne toujours {retryCommand.academicYear}. Réessayez la même demande pour
								vérifier son résultat.
							</p>
							<Button variant="outline" class="min-h-11 self-start" disabled={busy} onclick={retry}
								>{#if pending}<Spinner data-icon="inline-start" />{:else}<RefreshCwIcon
										data-icon="inline-start"
									/>{/if}Réessayer la même demande</Button
							>{:else if needsRefresh}<Button
								variant="outline"
								class="min-h-11 self-start"
								disabled={busy}
								onclick={reloadReview}><RefreshCwIcon data-icon="inline-start" />Actualiser le dossier</Button
							>{/if}</Alert.Description
					></Alert.Root
				>
			{/if}
			{#if status && receipt?.action === 'purge'}<Alert.Root class="mt-3"
					><CircleCheckIcon aria-hidden="true" /><Alert.Title>Données étudiantes supprimées</Alert.Title
					>{#if receipt?.action === 'purge'}<Alert.Description class="tabular-nums"
							>Suppression enregistrée : {receipt.removed.classes} classe{receipt.removed.classes > 1 ? 's' : ''}, {receipt
								.removed.students} étudiant{receipt.removed.students > 1 ? 's' : ''}, {receipt.removed.corrections} correction{receipt
								.removed.corrections > 1
								? 's'
								: ''}, {receipt.removed.scores} saisie{receipt.removed.scores > 1 ? 's' : ''} de points, {receipt
								.removed.comments} commentaire{receipt.removed.comments > 1 ? 's' : ''}, {receipt.removed.proposals} proposition{receipt
								.removed.proposals > 1
								? 's'
								: ''} et {receipt.removed.decisions} décision{receipt.removed.decisions > 1 ? 's' : ''}.
							{#if receipt.calendar}
								Calendrier effacé : {receipt.calendar.lessons} séance{receipt.calendar.lessons > 1 ? 's' : ''} importée{receipt
									.calendar.lessons > 1
									? 's'
									: ''}, toutes années confondues.
							{/if}</Alert.Description
						>{/if}</Alert.Root
				>{/if}
		</div>
	{/if}
	{#if !selected}
		<Empty.Root variant="surface"
			><Empty.Header
				><Empty.Media variant="icon"><HistoryIcon aria-hidden="true" /></Empty.Media><Empty.Title
					>{review.years.length ? 'Choisissez une année' : 'Aucune année disponible'}</Empty.Title
				><Empty.Description
					>{review.years.length
						? 'Ouvrez son dossier pour vérifier les PDF, les données annuelles et ce qui sera conservé.'
						: 'Créez une classe pour commencer. Son année scolaire sera disponible ici.'}</Empty.Description
				></Empty.Header
			>
			{#if !review.years.length}
				<Empty.Content><Button href={resolve('/enseignant/classes')}>Voir les classes</Button></Empty.Content>
			{/if}
		</Empty.Root>
	{:else}
		<AnnualDecision
			status={selected.status}
			{canArchive}
			{canPurge}
			canRead={hydrated && !busy && !needsRefresh && retryCommand === null}
			empty={!selected.classes.length && !selected.contexts.length}
			bind:choice={reviewChoice}
		/>

		<div id="annual-choice-details" class="flex min-w-0 flex-col gap-5">
			{#if reviewChoice || selected.status !== 'active'}
				{#if reviewChoice !== 'history'}<AnnualSummary preview={selected} closing={reviewChoice === 'close'} />{/if}
				{#if reviewChoice === 'archive' && selected.status === 'active'}
					<form
						method="POST"
						use:archiveTransport.enhance
						onsubmit={archiveTransport.handleSubmit((event) => submitOrdinary(event, 'archive'))}
						aria-busy={pending}
					>
						<Form.Button variant="outline" disabled={!canArchive}
							><ArchiveIcon data-icon="inline-start" />{pending
								? 'Archivage…'
								: `Archiver ${selected.academicYear}`}</Form.Button
						>
					</form>
				{/if}

				<div class="annual-dossier flex min-w-0 flex-col gap-8">
					<section aria-labelledby="annual-pdf-title" class="flex min-w-0 flex-col gap-3">
						<div>
							<h2 id="annual-pdf-title" class="panel-title">
								{selected.status === 'purged' ? 'Suivis de module et séances manuelles conservés' : 'Historique et PDF'}
							</h2>
						</div>
						{#if selected.contexts.length}
							<ul class="min-w-0 divide-y border-y">
								{#each selected.contexts as context (context.id)}
									<li class="annual-context-row flex min-w-0 flex-col gap-3 py-4">
										<div class="annual-pdf-row min-w-0">
											<p class="flex min-w-0 items-center gap-3 text-sm font-medium">
												<FileTextIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span
													class="min-w-0 wrap-anywhere">{context.moduleTitle}</span
												>
											</p>
											<p class="min-w-0 text-sm wrap-anywhere text-muted-foreground">
												{context.className}
											</p>
											<p class="text-sm text-muted-foreground">
												{!context.rosterRetained
													? 'Données purgées'
													: context.pdf.ready
														? 'PDF prêt'
														: `${context.pdf.complete}/${context.pdf.total} résultats complets`}
											</p>
											<div class="flex min-w-0 flex-wrap items-center gap-2">
												<Button
													variant="outline"
													disabled={scopeLocked || needsRefresh}
													href={resolve('/enseignant/modules/[moduleId]/publication', { moduleId: context.moduleId }) +
														`?contexte=${encodeURIComponent(context.id)}`}
												>
													Publication
												</Button>
												<Button
													variant="outline"
													class="min-h-11"
													disabled={busy ||
														needsRefresh ||
														retryCommand !== null ||
														!context.pdf.ready ||
														!context.rosterRetained}
													onclick={() => download(context)}
													aria-label={`Télécharger le PDF ${context.moduleTitle} pour ${context.className}, ${selected.academicYear}`}
												>
													{#if pdfPending === context.id}<Spinner data-icon="inline-start" />{:else}<DownloadIcon
															data-icon="inline-start"
														/>{/if}{pdfPending === context.id ? 'Préparation…' : 'Télécharger le PDF'}
												</Button>
												<Button
													variant="ghost"
													size="icon-lg"
													class="size-11"
													disabled={busy || needsRefresh || retryCommand !== null}
													aria-expanded={openHistory === context.id}
													aria-controls={`annual-history-${context.id}`}
													aria-label={`${openHistory === context.id ? 'Masquer' : 'Consulter'} l’historique de ${context.moduleTitle} pour ${context.className}, ${selected.academicYear}`}
													onclick={() => inspect(context)}><HistoryIcon aria-hidden="true" /></Button
												>
											</div>
										</div>
										{#if context.rosterRetained && !context.pdf.ready}<p
												class="max-w-prose text-sm wrap-anywhere text-muted-foreground"
											>
												{context.pdf.reason}
											</p>{/if}
										{#if pdfFeedback[context.id]?.message}{#if pdfFeedback[context.id].failed}<Alert.Root
													variant="destructive"
													id={`annual-pdf-error-${context.id}`}
													tabindex={-1}
													><CircleAlertIcon aria-hidden="true" /><Alert.Title>PDF indisponible</Alert.Title
													><Alert.Description>{pdfFeedback[context.id].message}</Alert.Description></Alert.Root
												>{:else}<p role="status" class="text-sm text-muted-foreground">
													{pdfFeedback[context.id].message}
												</p>{/if}{/if}
										<div
											id={`annual-history-${context.id}`}
											hidden={openHistory !== context.id && !historyErrors[context.id]}
										>
											{#if openHistory === context.id || historyErrors[context.id]}{#if historyPending === context.id}<p
														role="status"
														class="flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
													>
														<Spinner />Chargement de l’historique…
													</p>{:else if historyErrors[context.id]}<Alert.Root
														variant="destructive"
														id={`annual-history-error-${context.id}`}
														tabindex={-1}
														><CircleAlertIcon aria-hidden="true" /><Alert.Title>Historique indisponible</Alert.Title
														><Alert.Description class="flex flex-col gap-3"
															><p>{historyErrors[context.id]}</p>
															{#if !needsRefresh}<Button
																	variant="outline"
																	class="min-h-11 self-start"
																	onclick={() => {
																		openHistory = null;
																		void inspect(context);
																	}}>Réessayer</Button
																>{/if}</Alert.Description
														></Alert.Root
													>{:else if histories[context.id]}<AnnualHistory data={histories[context.id]} />{/if}{/if}
										</div>
									</li>
								{/each}
							</ul>
						{:else}<Empty.Root
								><Empty.Header
									><Empty.Title>Aucun suivi de module pour cette année</Empty.Title><Empty.Description
										>Aucun PDF de module ni calendrier annuel à consulter.</Empty.Description
									></Empty.Header
								></Empty.Root
							>{/if}
					</section>
					<section aria-label="Décisions sur l’année">
						<div class="flex min-w-0 flex-col gap-3 border-t pt-5">
							<div class="flex flex-wrap items-center gap-4">
								{#if selected.status === 'archived'}<form
										method="POST"
										use:reopenTransport.enhance
										onsubmit={reopenTransport.handleSubmit((event) => submitOrdinary(event, 'reopen'))}
										aria-busy={pending}
									>
										<Form.Button variant="outline" class="min-h-11" disabled={!canReopen}
											><ArchiveRestoreIcon data-icon="inline-start" />{pending && retryCommand?.action === 'reopen'
												? 'Réouverture…'
												: 'Rouvrir l’année'}</Form.Button
										>
									</form>
									<p class="max-w-prose text-sm text-muted-foreground">
										Rouvrez l’année pour reprendre le travail.
									</p>{/if}
								{#if reviewChoice === 'close'}<Button
										variant="destructive"
										class="min-h-11 sm:ml-auto"
										disabled={!canPurge}
										onclick={() => {
											errorMessage = '';
											confirmOpen = true;
										}}><Trash2Icon data-icon="inline-start" />Vérifier et confirmer la clôture</Button
									>{/if}
							</div>
							{#if $archiveAllErrors.length || $reopenAllErrors.length}<p role="alert" class="text-sm text-destructive">
									{[...$archiveAllErrors, ...$reopenAllErrors].flatMap((entry) => entry.messages).join(' ')}
								</p>{/if}
							{#if reviewChoice === 'close' && selected.classes.length}<p class="text-sm text-muted-foreground">
									Confirmation protégée ensuite : saisir « {selected.academicYear} » et confirmer avoir conservé les PDF nécessaires.
								</p>{/if}
							<p role="status" class="sr-only">
								{pending ? `Décision en cours pour l’année ${selected.academicYear}…` : ''}
							</p>
						</div>
					</section>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if confirmOpen && selected}
	<AnnualConfirmation
		preview={selected}
		{pending}
		blocked={needsRefresh}
		{errorMessage}
		{retryCommand}
		onConfirm={mutate}
		onRetry={retry}
		onReload={reloadReview}
		onClose={() => {
			if (!pending) confirmOpen = false;
		}}
	/>
{/if}

<style>
	.annual-scope {
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--muted);
	}
	.annual-dossier {
		padding: 1.5rem;
		border-radius: var(--radius);
		background: var(--card);
	}
	.annual-context-row + .annual-context-row {
		margin: 0;
	}
	@media (max-width: 39.99rem) {
		.annual-scope,
		.annual-dossier {
			padding: 1rem;
		}
	}

	.annual-workspace :global([data-slot='native-select']) {
		min-height: 2.75rem;
	}
	.annual-pdf-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
	}
	@media (min-width: 64rem) {
		.annual-pdf-row {
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr);
			gap: 0.75rem 1.25rem;
		}
	}
	@media (pointer: coarse) {
		.annual-workspace :global(select),
		.annual-workspace :global(input) {
			font-size: 1rem;
		}
	}
</style>
