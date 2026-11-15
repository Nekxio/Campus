<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { z } from 'zod';
	import { notify } from '#lib/client/notifications.js';
	import { focusFirstInvalidField } from '#lib/client/form-feedback.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import AccountChangesGuard from '#lib/components/teacher/AccountChangesGuard.svelte';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import {
		calendarCommandSchema,
		calendarSettingsSchema,
		type CalendarCommand,
		type CalendarSettings
	} from '#lib/domain/calendar-subscription.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import CalendarMappings from './CalendarMappings.svelte';
	import type { CalendarSettingsCommand } from './commands.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';

	let { initial }: { initial: CalendarSettings } = $props();
	let settings = $state.raw(untrack(() => initial));
	let busy = $state(false);
	let previewedUrl = $state('');
	let mappingDirty = $state(false);
	let issue = $state('');
	let confirmingDisconnect = $state(false);
	let issueElement = $state<HTMLDivElement | null>(null);
	let urlInput = $state<HTMLInputElement | null>(null);
	let heading = $state<HTMLHeadingElement | null>(null);
	let keepConnectionButton = $state<HTMLButtonElement | null>(null);
	let disconnectButton = $state<HTMLButtonElement | null>(null);
	const setDisconnectConfirmation = async (open: boolean) => {
		confirmingDisconnect = open;
		await tick();
		(open ? keepConnectionButton : disconnectButton)?.focus();
	};
	const previewSchema = calendarCommandSchema.options[0].extend({
		url: z
			.string()
			.trim()
			.min(1, 'Renseignez le lien d’abonnement iCalendar.')
			.max(2048, 'Le lien est trop long.')
			.refine(
				(value) => URL.canParse(value) && new URL(value).protocol === 'https:',
				'Renseignez le lien HTTPS privé fourni par Pronote Campus.'
			)
	});
	const form = superForm(defaults({ action: 'preview' as const, url: '' }, zod4Client(previewSchema)), {
		id: 'school-calendar',
		validators: zod4Client(previewSchema),
		dataType: 'json',
		applyAction: 'never',
		invalidateAll: false,
		resetForm: false,
		taintedMessage: false
	});
	const { form: formData, errors } = form;
	const dirty = $derived($formData.url.trim() !== previewedUrl || mappingDirty);
	const transport = createFormActionTransport(form);
	const execute = async (command: CalendarSettingsCommand, success: string) => {
		if (busy) return;
		busy = true;
		issue = '';
		try {
			const previousPreview = settings.connection?.previewAt;
			settings = await transport.submit(
				'/enseignant/applications?/calendarCommand',
				command,
				calendarSettingsSchema.parse
			);
			const message = settings.connection?.error && command.action === 'sync' ? '' : success;
			if (message) notify(message);
			else if (settings.connection?.error)
				notify(`${settings.connection.error} Les dernières séances disponibles sont conservées.`, 'error');
			if (command.action === 'preview') {
				previewedUrl = command.url.trim();
				if (previousPreview !== settings.connection?.previewAt) mappingDirty = false;
			}
			if (command.action === 'connect' || command.action === 'disconnect') {
				confirmingDisconnect = false;
				formData.set({ action: 'preview', url: '' });
				previewedUrl = '';
				mappingDirty = false;
			}
			await tick();
			if (command.action !== 'sync') heading?.focus();
		} catch (cause) {
			issue =
				cause instanceof TeachingRequestError
					? cause.message
					: 'Le calendrier est indisponible. Vos choix sont conservés ; réessayez.';
			notify(issue, 'error');
			if (command.action === 'preview' && cause instanceof TeachingRequestError && cause.status === 422) {
				errors.set({ url: [issue] });
				issue = '';
			}
		} finally {
			busy = false;
			await tick();
			if (command.action === 'preview' && $errors.url?.length) urlInput?.focus();
			else if (issue) issueElement?.focus();
		}
	};
	const preview = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
		event.preventDefault();
		if (busy) return;
		const formElement = event.currentTarget;
		const checked = await form.validateForm({ update: true });
		if (!checked.valid) {
			notify('Vérifiez le lien d’abonnement iCalendar.', 'error');
			await focusFirstInvalidField(formElement);
			return;
		}
		await execute(checked.data, 'Calendrier examiné. Choisissez les cours à importer.');
	};
	const connect = async (mappings: Extract<CalendarCommand, { action: 'connect' }>['mappings']) => {
		if (settings.connection)
			await execute(
				{ action: 'connect', revision: settings.connection.revision, mappings },
				'Calendrier connecté. Les séances sont disponibles dans Classe et planning.'
			);
	};
</script>

<AccountChangesGuard
	{dirty}
	pending={busy}
	title="Quitter la configuration du calendrier ?"
	description="Le lien ou les associations de cours en cours de saisie n’ont pas été enregistrés. Vous pouvez continuer à les modifier ou quitter cette page."
/>

<section id="calendrier" aria-labelledby="school-calendar-heading">
	<form
		id="calendar-form"
		method="POST"
		use:transport.enhance
		onsubmit={transport.handleSubmit(preview)}
		novalidate
		class="calendar-connection"
		aria-busy={busy}
	>
		<header class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0 flex-1 basis-56">
				<h2 id="school-calendar-heading" tabindex="-1" bind:this={heading} class="panel-title">
					Calendrier de l’école
				</h2>
				<Badge variant="secondary" class="mt-3"
					>{settings.connection?.active
						? 'Synchronisation active'
						: settings.connection
							? settings.connection.previewAt &&
								!settings.connection.mappings.length &&
								!settings.connection.lastSuccess
								? 'Aperçu à associer'
								: 'Synchronisation arrêtée'
							: 'Non connecté'}</Badge
				>
			</div>
			{#if settings.connection?.active}
				<Button
					type="button"
					variant="outline"
					class="ms-auto min-h-11"
					disabled={busy}
					onclick={() =>
						execute(
							{ action: 'sync', manual: true },
							'Actualisation terminée. Les dernières séances disponibles sont affichées.'
						)}
				>
					{busy ? 'Actualisation en cours…' : 'Actualiser maintenant'}
				</Button>
			{:else}
				<Button type="submit" variant="outline" class="ms-auto min-h-11" disabled={busy}
					>{busy ? 'Lecture du calendrier…' : 'Examiner le calendrier'}</Button
				>
			{/if}
		</header>
		<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
			Retrouvez les séances de l’école dans vos modules et sur l’accueil. Seuls les événements avec des horaires sont
			importés ; les journées entières sont ignorées.
		</p>
		<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
			La clôture annuelle efface la connexion et toutes les séances importées, même celles d’une autre année, avec leur
			préparation. Les séances manuelles sont conservées. Vous connecterez le nouveau lien l’année suivante.
		</p>
		<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
			Une actualisation par jour d’utilisation, uniquement lorsque vous êtes connecté comme enseignant. Aucune
			actualisation en votre absence.
		</p>
		{#if issue}<Alert.Root variant="destructive" role="alert" tabindex={-1} bind:ref={issueElement}>
				<Alert.Title>Calendrier à vérifier</Alert.Title>
				<Alert.Description>{issue}</Alert.Description>
			</Alert.Root>{/if}
		{#if settings.connection?.active}
			<dl class="grid gap-3 text-sm sm:grid-cols-2">
				<div>
					<dt class="text-muted-foreground">Dernière réussite</dt>
					<dd class="mt-1">
						{settings.connection.lastSuccess
							? formatLessonDate(settings.connection.lastSuccess)
							: 'Aucune actualisation réussie'}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Dernière tentative</dt>
					<dd class="mt-1">
						{settings.connection.lastAttempt ? formatLessonDate(settings.connection.lastAttempt) : 'Aucune tentative'}
					</dd>
				</div>
			</dl>
			{#if settings.connection.error}<p role="status" class="text-sm text-destructive">
					{settings.connection.error} Les dernières séances disponibles sont conservées.
				</p>{/if}
			<ul class="flex min-w-0 flex-col gap-3 text-sm" aria-label="Cours associés">
				{#each settings.connection.mappings as mapping (mapping.course)}<li class="wrap-anywhere">
						<span class="font-medium">{mapping.course}</span><br /><span class="text-muted-foreground"
							>{settings.contexts.find((context) => context.id === mapping.contextId)?.label ??
								'Contexte archivé ou indisponible · association suspendue'}</span
						>
					</li>{/each}
			</ul>
			<div class="flex flex-wrap justify-end gap-3">
				{#if !confirmingDisconnect}<Button
						type="button"
						variant="destructive-outline"
						class="min-h-11"
						disabled={busy}
						onclick={() => setDisconnectConfirmation(true)}
						bind:ref={disconnectButton}>Déconnecter le calendrier</Button
					>{/if}
			</div>
			{#if confirmingDisconnect}
				<div class="flex flex-col gap-3 rounded-lg bg-muted p-4">
					<h3 class="font-semibold">Arrêter la synchronisation ?</h3>
					<p class="text-sm text-muted-foreground">Les séances et leur préparation resteront dans Campus.</p>
					<div class="flex flex-wrap justify-end gap-3">
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onclick={() => setDisconnectConfirmation(false)}
							bind:ref={keepConnectionButton}>Garder la connexion</Button
						>
						<Button
							type="button"
							variant="destructive"
							disabled={busy}
							onclick={() =>
								settings.connection &&
								execute(
									{ action: 'disconnect', revision: settings.connection.revision },
									'Calendrier déconnecté. Les séances et leur préparation sont conservées.'
								)}>Confirmer la déconnexion</Button
						>
					</div>
				</div>
			{/if}
		{:else}
			<div class="flex min-w-0 flex-col gap-4">
				<Form.Field {form} name="url" class="flex min-w-0 flex-col gap-2">
					<Form.Control id="calendar-feed-url"
						>{#snippet children({ props })}<Form.Label>Lien d’abonnement iCalendar</Form.Label><Input
								{...props}
								type="url"
								name="url"
								bind:value={$formData.url}
								bind:ref={urlInput}
								autocomplete="off"
								spellcheck={false}
								disabled={busy}
								required
								aria-required="true"
							/>{/snippet}</Form.Control
					>
					<Form.Description
						>Collez le lien HTTPS privé fourni par Pronote Campus. Il reste réservé à votre compte enseignant.</Form.Description
					>
					<Form.FieldErrors aria-live="polite" />
				</Form.Field>
				<PrivacyNotice>
					Ce lien privé donne accès à votre calendrier. Campus le conserve pour importer les séances ; ne le partagez
					pas sur une page publique.
				</PrivacyNotice>
			</div>
			{#if settings.connection?.previewAt}
				{#key settings.connection.previewAt}<CalendarMappings
						{settings}
						{busy}
						onconnect={connect}
						onchange={(changed) => {
							mappingDirty = changed;
						}}
					/>{/key}
			{/if}
		{/if}
		{#if settings.issues.length}
			<details class="border-t pt-4">
				<summary class="cursor-pointer rounded-control py-2 text-sm font-medium"
					>Séances à vérifier ({settings.issues.length})</summary
				>
				<ul class="mt-3 flex min-w-0 flex-col gap-3 text-sm">
					{#each settings.issues as item (item.lessonId)}<li class="wrap-anywhere">
							<a
								class="underline underline-offset-4"
								href={resolve(
									`/enseignant/modules/[moduleId]?section=planning&contexte=${encodeURIComponent(item.contextId)}`,
									{ moduleId: item.moduleId }
								)}>{item.title}</a
							><span class="text-muted-foreground">
								· {item.status === 'cancelled'
									? 'Annulée par l’école · préparation conservée'
									: item.status === 'missing'
										? 'Absente du dernier flux · conservée à vérifier'
										: 'Calendrier déconnecté · séance conservée'}</span
							>
						</li>{/each}
				</ul>
			</details>
		{/if}
	</form>
</section>

<style>
	.calendar-connection {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1.5rem;
	}
</style>
