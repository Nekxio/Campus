<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import AccountChangesGuard from '#lib/components/teacher/AccountChangesGuard.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import { onMount, tick, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { profileSchema, type ProfileInput } from '#lib/domain/profile.js';
	import { notify } from '#lib/client/notifications.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import WorkSurface from '#lib/components/shared/WorkSurface.svelte';
	import type { PageProps } from './$types';
	let { data, form: actionData }: PageProps = $props();
	let persistedName = $state(untrack(() => data.name));
	const profileForm = superForm<ProfileInput>(
		untrack(() => actionData?.form) ?? defaults({ name: untrack(() => data.name) }, zod4Client(profileSchema)),
		{
			id: 'teacher-profile',
			validators: zod4Client(profileSchema),
			dataType: 'form',
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false
		}
	);
	const { form: profileData, errors } = profileForm;
	const transport = createFormActionTransport(profileForm);
	const fieldError = $derived($errors.name?.[0] ?? '');
	let issue = $state(untrack(() => actionData?.message ?? ''));
	let saved = $state(untrack(() => Boolean(actionData && 'receipt' in actionData)));
	let busy = $state(false);
	let saveUnconfirmed = $state(false);
	const canSave = $derived($profileData.name !== persistedName || saveUnconfirmed);
	let mounted = $state(false);
	let nameInput = $state<HTMLInputElement | null>(null);
	let issueElement = $state<HTMLDivElement | null>(null);
	onMount(() => {
		mounted = true;
	});

	const cancel = () => {
		$profileData.name = persistedName;
		errors.clear();
		issue = '';
		saved = false;
	};

	const save = async (event: SubmitEvent) => {
		event.preventDefault();
		if (busy || !canSave) return;
		errors.clear();
		issue = '';
		saved = false;
		busy = true;
		const checked = await profileForm.validateForm({ update: true });
		if (!checked.valid) {
			busy = false;
			notify('Vérifiez les champs signalés.', 'error');
			await tick();
			nameInput?.focus();
			return;
		}
		const submittedName = $profileData.name;
		try {
			const { name: savedName } = await transport.submit(
				'/enseignant/compte?/updateProfile',
				checked.data,
				profileSchema.parse
			);
			persistedName = savedName;
			saveUnconfirmed = false;
			if ($profileData.name === submittedName) $profileData.name = savedName;
			saved = true;
			try {
				await invalidateAll();
			} catch {
				issue = 'Nom enregistré, mais l’espace enseignant ne s’est pas actualisé. Rechargez la page.';
				notify(issue, 'warning');
			}
		} catch (cause) {
			if (cause instanceof TeachingRequestError && cause.status === 422) {
				errors.set({ name: [cause.fields.name ?? 'Nom invalide.'] });
				notify('Vérifiez les champs signalés.', 'error');
			} else {
				saveUnconfirmed = !(cause instanceof TeachingRequestError && cause.decodedServerError);
				issue =
					cause instanceof TeachingRequestError
						? cause.message
						: 'Le nom n’a pas pu être enregistré. Réessayez sans quitter la page.';
				notify(issue, 'error');
			}
		} finally {
			busy = false;
			await tick();
			if (fieldError) nameInput?.focus();
			else if (issue) issueElement?.focus();
		}
	};
</script>

<noscript
	>{#if saved}<p role="status">Votre nom a été enregistré.</p>{/if}</noscript
>
<ActionNotice message={saved ? 'Votre nom a été enregistré.' : ''} />

<PageHead title="Compte" description="Gérer le profil du compte enseignant et ses clés d’accès." />
<AccountChangesGuard
	dirty={canSave}
	pending={busy}
	title="Quitter les informations du compte ?"
	description="L’enregistrement de votre nom n’est pas confirmé. Vous pouvez continuer à le modifier ou quitter cette page."
/>

<div class="account-dossier">
	{#if issue}<Alert.Root variant="destructive" bind:ref={issueElement} tabindex={-1}
			><Alert.Title>Vérifiez l’enregistrement</Alert.Title><Alert.Description>{issue}</Alert.Description></Alert.Root
		>{/if}
	<WorkSurface aria-labelledby="profile-heading">
		<header class="section-introduction profile-heading">
			<h2 id="profile-heading" tabindex="-1" class="panel-title">Informations personnelles</h2>
			<div class="profile-actions">
				<Button type="reset" form="profile-form" variant="outline" disabled={busy}>Annuler</Button>
				<Button type="submit" form="profile-form" disabled={mounted && (busy || !canSave)}
					>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button
				>
			</div>
		</header>
		<form
			id="profile-form"
			method="POST"
			autocomplete="on"
			action="?/updateProfile"
			enctype="multipart/form-data"
			use:transport.enhance
			novalidate
			onsubmit={transport.handleSubmit(save)}
			onreset={(event) => {
				event.preventDefault();
				cancel();
			}}
			aria-busy={busy}
		>
			<PrivacyNotice>
				Votre nom, votre e-mail et les informations publiques de votre clé d’accès servent à gérer et sécuriser votre
				compte. Campus ne reçoit aucune donnée biométrique.
			</PrivacyNotice>
			<Form.Field form={profileForm} name="name">
				<Form.Control id="profile-full-name">
					{#snippet children({ props })}
						<Form.Label>Nom et prénom</Form.Label>
						<Input
							{...props}
							name="name"
							type="text"
							autocomplete="name"
							bind:ref={nameInput}
							bind:value={$profileData.name}
							oninput={() => errors.clear()}
							onchange={() => profileForm.validate('name', { update: 'errors' })}
							maxlength={100}
							required
						/>
					{/snippet}
				</Form.Control>
				<Form.Description id="profile-full-name-description">
					Votre nom et prénom apparaissent dans votre espace enseignant.
				</Form.Description>
				<Form.FieldErrors id="profile-full-name-error" />
			</Form.Field>
		</form>
	</WorkSurface>
	<WorkSurface aria-labelledby="access-heading">
		<div class="section-introduction">
			<h2 id="access-heading" tabindex="-1" class="panel-title">Accès</h2>
		</div>
		<dl>
			<div>
				<dt>Adresse email</dt>
				<dd>{data.email}</dd>
			</div>
			<div>
				<dt>Rôle</dt>
				<dd>Enseignant</dd>
			</div>
		</dl>
		<p class="access-explanation">
			Le changement d’adresse email et le remplacement de votre clé d’accès ne sont actuellement pas disponibles depuis
			votre compte.
		</p>
	</WorkSurface>
</div>

<style>
	.section-introduction {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.profile-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-label);
		margin-inline-start: auto;
	}
	.profile-heading {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	dl {
		display: flex;
		flex-direction: column;
		gap: var(--space-fields);
		font-size: 0.875rem;
	}
	dl div {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	dt {
		color: var(--muted-foreground);
	}
	dd {
		overflow-wrap: anywhere;
	}
	.access-explanation {
		max-width: 65ch;
		margin-top: 1.5rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.65;
	}
	.account-dossier {
		display: flex;
		flex-direction: column;
		gap: var(--space-sections);
		min-width: 0;
	}
</style>
