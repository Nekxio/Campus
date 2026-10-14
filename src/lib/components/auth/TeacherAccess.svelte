<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import HomeIcon from '@lucide/svelte/icons/house';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';
	import { authClient, prepareInvitation } from '#lib/auth-client.js';
	import { authIssue, readInvitationToken, type InvitationIdentity } from '#lib/auth/flow.js';
	import { getInitials } from '#lib/profile.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { cn } from '#lib/utils.js';

	type Props = {
		mode: 'sign-in' | 'activation';
		authReady: boolean;
		serviceUnavailable?: boolean;
	};

	let { mode, authReady, serviceUnavailable = false }: Props = $props();

	let mounted = $state(false);
	let supported = $state(false);
	let preparing = $state(false);
	let busy = $state(false);
	let opening = $state(false);
	let identity = $state.raw<InvitationIdentity | null>(null);
	let issue = $state.raw<ReturnType<typeof authIssue> | null>(null);
	let invitationToken: string | undefined;
	let invitationVersion = 0;
	let disposed = false;

	const invalidInvitation = {
		title: 'Invitation introuvable',
		description:
			'Ouvrez le lien complet de votre invitation. Si le lien a expiré, demandez une nouvelle invitation.',
		retry: false
	};

	let unavailable = $derived(!authReady);
	let activeIssue = $derived(
		unavailable
			? {
					title: 'Accès momentanément indisponible',
					description:
						'Votre espace enseignant est indisponible pour le moment. Réessayez plus tard.',
					retry: false
				}
			: mounted && !supported
				? {
						title: 'Clé d’accès indisponible',
						description:
							'Ouvrez cette page dans un navigateur à jour, avec une connexion sécurisée, puis réessayez.',
						retry: false
					}
				: (issue ??
					(serviceUnavailable
						? {
								title: 'Connexion momentanément indisponible',
								description:
									'La vérification de votre session a échoué. Vous pouvez réessayer avec votre clé d’accès.',
								retry: true
							}
						: null))
	);
	let actionDisabled = $derived(
		!mounted ||
			!supported ||
			unavailable ||
			preparing ||
			busy ||
			opening ||
			(!!issue && !issue.retry) ||
			(mode === 'activation' && !identity)
	);
	let canRetryInvitation = $derived(
		mode === 'activation' && !identity && !!issue?.retry && supported && !unavailable
	);
	let progress = $derived(
		opening
			? 'Connexion réussie. Ouverture de votre espace…'
			: preparing
				? 'Vérification de votre invitation…'
				: busy
					? mode === 'activation'
						? 'Confirmez la création de votre clé d’accès dans la fenêtre de votre appareil.'
						: 'Choisissez votre clé d’accès dans la fenêtre de votre appareil.'
					: ''
	);

	async function verifyInvitation() {
		if (!invitationToken || preparing || busy || opening || unavailable) return;

		preparing = true;
		issue = null;
		const version = invitationVersion;

		try {
			const invitedIdentity = await prepareInvitation(invitationToken);
			if (!disposed && version === invitationVersion) identity = invitedIdentity;
		} catch (error) {
			if (!disposed && version === invitationVersion) {
				issue = authIssue(error, 'activation');
				if (!issue.retry) invitationToken = undefined;
			}
		} finally {
			if (!disposed) {
				preparing = false;
				if (version !== invitationVersion && invitationToken) void verifyInvitation();
			}
		}
	}

	async function authenticate() {
		if (actionDisabled) return;

		busy = true;
		issue = null;

		try {
			const result =
				mode === 'activation'
					? await authClient.passkey.addPasskey({ name: 'Coursely', createSession: true })
					: await authClient.signIn.passkey();

			if (disposed) return;
			if (result.error || !result.data) {
				issue = authIssue(result.error, mode);
				return;
			}

			opening = true;
			invitationToken = undefined;
			window.location.assign('/');
		} catch (error) {
			if (!disposed) {
				opening = false;
				issue = authIssue(error, mode);
			}
		} finally {
			if (!disposed) busy = false;
		}
	}

	function readInvitation() {
		if (mode !== 'activation') return;
		const token = readInvitationToken(window.location.hash);
		if (window.location.hash) {
			const cleanUrl = resolve('/activation');
			void goto(resolve('/activation'), { shallow: true, replace: true, state: page.state }).catch(
				() => {
					// Even if routing fails, leave the invitation fragment out of the next page.
					window.location.replace(cleanUrl);
				}
			);
		}
		// Do not change the invitation context during an active device ceremony.
		if (busy || opening) return;
		invitationVersion += 1;
		invitationToken = token;
		identity = null;
		issue = token ? null : invalidInvitation;
		if (token && supported && !unavailable && !preparing) void verifyInvitation();
	}

	onMount(() => {
		supported =
			window.isSecureContext &&
			typeof window.PublicKeyCredential !== 'undefined' &&
			typeof navigator.credentials?.create === 'function' &&
			typeof navigator.credentials?.get === 'function';
		mounted = true;

		readInvitation();

		return () => {
			disposed = true;
			invitationToken = undefined;
		};
	});
</script>

<svelte:window onhashchange={readInvitation} />

{#snippet primaryAction()}
	<Button
		type="button"
		class="h-auto min-h-11 w-full py-3"
		disabled={actionDisabled}
		aria-busy={busy || opening}
		onclick={authenticate}
	>
		{#if busy || opening}
			<Spinner data-icon="inline-start" aria-hidden="true" role="presentation" />
		{:else}
			<KeyRoundIcon data-icon="inline-start" aria-hidden="true" />
		{/if}
		<span class="min-w-0 whitespace-normal">
			{mode === 'activation' ? 'Créer ma clé d’accès' : 'Me connecter'}
		</span>
	</Button>
	<div role="status" aria-live="polite" aria-atomic="true">
		{#if progress}
			<p class="progress">{progress}</p>
		{:else if identity}
			<span class="sr-only">Invitation vérifiée. Vous pouvez créer votre clé d’accès.</span>
		{/if}
	</div>
{/snippet}

<div class="access-page">
	<header class="access-header">
		<span class="wordmark">Coursely</span>
	</header>

	<main class="access-main">
		<h1>{mode === 'activation' ? 'Activer mon espace enseignant' : 'Connexion à mon espace'}</h1>
		<p class="intro">
			{#if mode === 'activation'}
				{#if identity}
					Votre invitation est prête. Créez une clé d’accès pour ouvrir votre espace.
				{:else}
					Vérifiez votre invitation, puis créez une clé d’accès pour ouvrir votre espace.
				{/if}
			{:else}
				Utilisez votre clé d’accès pour retrouver votre accueil enseignant.
			{/if}
		</p>

		{#if activeIssue}
			<Alert.Root class="mb-7">
				<CircleAlertIcon aria-hidden="true" />
				<Alert.Title>{activeIssue.title}</Alert.Title>
				<Alert.Description>{activeIssue.description}</Alert.Description>
			</Alert.Root>
		{/if}

		<noscript>
			<p class="intro">Activez JavaScript dans votre navigateur pour utiliser votre clé d’accès.</p>
		</noscript>

		{#if mode === 'activation'}
			<ol class="sequence" aria-label="Activation de votre espace">
				<li class="step">
					<div class="step-rail" aria-hidden="true">
						<span class="marker">
							{#if identity}
								<CircleCheckIcon class="size-4" />
							{:else}
								<UserRoundIcon class="size-4" />
							{/if}
						</span>
						<Separator orientation="vertical" class="mx-auto mt-2 mb-2 flex-1" />
					</div>
					<div class="step-body">
						<h2>Votre invitation</h2>
						{#if identity}
							<div class="identity">
								<Avatar.Root class="size-10 shrink-0" aria-hidden="true">
									<Avatar.Fallback>{getInitials(identity.name)}</Avatar.Fallback>
								</Avatar.Root>
								<div class="min-w-0">
									<p class="identity-name">{identity.name}</p>
									<p class="identity-email">{identity.email}</p>
								</div>
							</div>
						{:else if preparing || !mounted}
							<div class="identity" aria-hidden="true">
								<Skeleton class="size-10 shrink-0 rounded-full" />
								<div class="flex min-w-0 flex-1 flex-col gap-2">
									<Skeleton class="h-4 w-3/5" />
									<Skeleton class="h-4 w-4/5" />
								</div>
							</div>
						{:else}
							<p class="explanation invitation-pending">
								Votre invitation doit être vérifiée avant de créer une clé d’accès.
							</p>
						{/if}
						<Separator class="mt-6" />
						{#if canRetryInvitation}
							<Button
								variant="outline"
								class="mt-4 h-auto min-h-11 w-full py-3"
								disabled={preparing || busy || opening}
								onclick={verifyInvitation}
							>
								<span class="min-w-0 whitespace-normal">Réessayer la vérification</span>
							</Button>
						{/if}
					</div>
				</li>
				<li class="step">
					<div class="step-rail" aria-hidden="true">
						<span class={cn('marker', identity && !unavailable && supported && 'active')}>
							<KeyRoundIcon class="size-4" />
						</span>
						<Separator orientation="vertical" class="mx-auto mt-2 mb-2 flex-1" />
					</div>
					<div class="step-body">
						<h2>Créer votre clé d’accès</h2>
						<p class="explanation">
							Votre appareil ou votre gestionnaire de clés d’accès vous demandera de confirmer votre
							identité.
						</p>
						{@render primaryAction()}
					</div>
				</li>
				<li class="step next">
					<div class="step-rail" aria-hidden="true">
						<span class="marker"><HomeIcon class="size-4" /></span>
					</div>
					<div class="step-body">
						<h2>Votre accueil enseignant</h2>
						<p class="explanation">
							Il s’ouvrira automatiquement après la création. Pour revenir, votre clé d’accès
							suffira.
						</p>
					</div>
				</li>
			</ol>
			<div class="existing-access">
				<Button variant="link" href={resolve('/connexion')} class="h-auto min-h-11 max-w-full">
					<span class="min-w-0 whitespace-normal">J’ai déjà une clé d’accès</span>
				</Button>
			</div>
		{:else}
			<div class="sign-in-action">
				{@render primaryAction()}
				<p class="explanation sign-in-help">
					Votre appareil ou votre gestionnaire de clés d’accès vous demandera de confirmer votre
					identité.
				</p>
			</div>
		{/if}
	</main>

	<footer class="access-footer">Espace enseignant</footer>
</div>

<style>
	.access-page {
		display: flex;
		min-height: 100svh;
		flex-direction: column;
		padding-right: env(safe-area-inset-right, 0px);
		padding-left: env(safe-area-inset-left, 0px);
	}

	.access-header {
		flex: none;
		padding: calc(2.25rem + env(safe-area-inset-top, 0px)) 1.25rem 2.25rem;
		text-align: center;
	}

	.wordmark {
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.75rem;
		letter-spacing: -0.025em;
	}

	.access-main {
		width: calc(100% - 2.5rem);
		max-width: 30rem;
		margin: 4.1875rem auto 3rem;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: 2.25rem;
		font-weight: 600;
		line-height: 2.5rem;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}

	.intro,
	.explanation,
	.progress {
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.375rem;
		overflow-wrap: anywhere;
	}

	.intro {
		max-width: 43ch;
		margin: 0 0 2.5rem;
	}

	.sequence {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.step {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		gap: 1.25rem;
	}

	.step-rail {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.marker {
		display: flex;
		width: 2rem;
		height: 2rem;
		flex: none;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--background);
		color: var(--muted-foreground);
	}

	.marker.active {
		border-color: var(--primary);
		background: var(--primary);
		color: var(--primary-foreground);
	}

	.step-body {
		min-width: 0;
		padding-bottom: 1.75rem;
	}

	h2 {
		margin: 0.25rem 0 1rem;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.5rem;
		letter-spacing: -0.015em;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.identity-name,
	.identity-email {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.25rem;
		overflow-wrap: anywhere;
	}

	.identity-name {
		margin-bottom: 0.125rem;
		font-weight: 500;
	}

	.identity-email {
		color: var(--muted-foreground);
	}

	.explanation {
		max-width: 41ch;
		margin: 0 0 1.25rem;
	}

	.invitation-pending {
		margin-bottom: 0;
	}

	.progress {
		margin: 0.75rem 0 0;
	}

	.next h2 {
		margin-bottom: 0.5rem;
		color: var(--muted-foreground);
		font-weight: 500;
	}

	.next .step-body {
		padding-bottom: 0;
	}

	.next .explanation {
		margin-bottom: 0;
	}

	.existing-access {
		margin-top: 1.5rem;
		text-align: center;
	}

	.sign-in-help {
		max-width: 43ch;
		margin: 1.25rem 0 0;
	}

	.access-footer {
		margin-top: auto;
		padding: 1.5rem 1.25rem calc(1.75rem + env(safe-area-inset-bottom, 0px));
		color: var(--muted-foreground);
		font-size: 0.75rem;
		line-height: 1rem;
		text-align: center;
	}

	@media (max-width: 600px) {
		.access-header {
			padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
			padding-bottom: 1.5rem;
		}

		.access-main {
			margin-top: 2rem;
		}

		h1 {
			font-size: 1.875rem;
			line-height: 2.25rem;
		}

		.intro {
			margin-bottom: 1.75rem;
		}

		.step {
			gap: 1rem;
		}

		.step-body {
			padding-bottom: 1.5rem;
		}

		h2 {
			margin-bottom: 0.75rem;
		}

		.explanation {
			margin-bottom: 1rem;
		}
	}

	@media (max-height: 760px) {
		.access-header {
			padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
			padding-bottom: 1.5rem;
		}

		.access-main {
			margin-top: 1.5rem;
		}

		.intro {
			margin-bottom: 1.75rem;
		}

		.step-body {
			padding-bottom: 1.25rem;
		}

		.access-footer {
			padding-top: 0.75rem;
		}
	}
</style>
