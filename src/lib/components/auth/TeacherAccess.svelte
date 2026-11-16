<script lang="ts">
	import { notify, notifyAfterNavigation } from '#lib/client/notifications.js';
	import { onMount, tick } from 'svelte';
	import { passkeySignInSchema, passkeyActivationSchema } from '#lib/teaching/action-responses.js';
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
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { cn } from '#lib/utils.js';
	import ApplicationAccess from './ApplicationAccess.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';

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
	let issueElement = $state<HTMLDivElement | null>(null);

	const invalidInvitation = {
		title: 'Invitation introuvable',
		description: 'Ouvrez le lien complet de votre invitation. Si le lien a expiré, demandez une nouvelle invitation.',
		retry: false
	};

	let unavailable = $derived(!authReady);
	let activeIssue = $derived(
		unavailable
			? {
					title: 'Accès momentanément indisponible',
					description: 'Votre espace enseignant est indisponible pour le moment. Réessayez plus tard.',
					retry: false
				}
			: mounted && !supported
				? {
						title: 'Clé d’accès indisponible',
						description: 'Ouvrez cette page dans un navigateur à jour, avec une connexion sécurisée, puis réessayez.',
						retry: false
					}
				: (issue ??
					(serviceUnavailable
						? {
								title: 'Connexion momentanément indisponible',
								description: 'La vérification de votre session a échoué. Vous pouvez réessayer avec votre clé d’accès.',
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
	let canRetryInvitation = $derived(mode === 'activation' && !identity && !!issue?.retry && supported && !unavailable);
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

	const verifyInvitation = async () => {
		if (!invitationToken || preparing || busy || opening || unavailable) return;

		preparing = true;
		issue = null;
		const version = invitationVersion;

		try {
			const invitedIdentity = await prepareInvitation(invitationToken);
			if (!disposed && version === invitationVersion) {
				identity = invitedIdentity;
				notify('Invitation vérifiée. Vous pouvez créer votre clé d’accès.', 'info');
			}
		} catch (error) {
			if (!disposed && version === invitationVersion) {
				issue = authIssue(error, 'activation');
				notify(issue.description, 'error');
				if (!issue.retry) invitationToken = undefined;
			}
		} finally {
			if (!disposed) {
				preparing = false;
				if (version !== invitationVersion && invitationToken) void verifyInvitation();
			}
		}
	};

	const authenticate = async () => {
		if (actionDisabled) return;

		busy = true;
		issue = null;

		try {
			const result =
				mode === 'activation'
					? await authClient.passkey.addPasskey({ name: 'Campus', createSession: true })
					: await authClient.signIn.passkey();

			if (disposed) return;
			if (
				result.error ||
				!(mode === 'activation' ? passkeyActivationSchema : passkeySignInSchema).safeParse(result.data).success
			) {
				issue = authIssue(result.error, mode);
				notify(issue.description, 'error');
				await tick();
				issueElement?.focus();
				return;
			}

			opening = true;
			invitationToken = undefined;
			notifyAfterNavigation(mode === 'activation' ? 'activated' : 'signed-in');
			window.location.assign('/');
		} catch (error) {
			if (!disposed) {
				opening = false;
				issue = authIssue(error, mode);
				notify(issue.description, 'error');
				await tick();
				issueElement?.focus();
			}
		} finally {
			if (!disposed) busy = false;
		}
	};

	const readInvitation = () => {
		if (mode !== 'activation') return;
		const token = readInvitationToken(window.location.hash);
		if (window.location.hash) {
			const cleanUrl = resolve('/activation');
			void goto(resolve('/activation'), { shallow: true, replace: true, state: page.state }).catch(() => {
				// Even if routing fails, leave the invitation fragment out of the next page.
				window.location.replace(cleanUrl);
			});
		}
		// Do not change the invitation context during an active device ceremony.
		if (busy || opening) return;
		invitationVersion += 1;
		invitationToken = token;
		identity = null;
		issue = token ? null : invalidInvitation;
		if (token && supported && !unavailable && !preparing) void verifyInvitation();
	};

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
		{:else if mode === 'activation' && !activeIssue && mounted && supported}
			<p class="progress">
				{identity
					? 'Invitation vérifiée. Vous pouvez créer votre clé d’accès.'
					: 'Vérification de l’invitation nécessaire.'}
			</p>
		{/if}
	</div>
{/snippet}

<ApplicationAccess compact={mode === 'sign-in'}>
	{#snippet support()}
		<section class="access-help" aria-labelledby="access-help-title">
			<h2 id="access-help-title" class="panel-title">Votre clé d’accès</h2>
			<p class="explanation">
				Votre appareil ou votre gestionnaire de clés d’accès vous demandera de confirmer votre identité.
			</p>
			<p class="explanation">
				{mode === 'activation'
					? 'Votre accueil s’ouvrira automatiquement après la création. Votre clé d’accès suffira pour revenir.'
					: 'Utilisez l’appareil sur lequel votre clé est disponible. Une invitation est nécessaire pour activer votre accès.'}
			</p>
		</section>
	{/snippet}
	<div class="access-main">
		{#if mode === 'activation'}<ol class="compact-steps" aria-label="Activation de votre espace">
				<li aria-current={!identity ? 'step' : undefined}>
					<UserRoundIcon class="size-4" aria-hidden="true" />Invitation{#if identity}<CircleCheckIcon
							class="size-4"
							aria-label="Vérifiée"
						/>{/if}
				</li>
				<li class={cn(identity && !opening && 'current')} aria-current={identity && !opening ? 'step' : undefined}>
					<KeyRoundIcon class="size-4" aria-hidden="true" />Clé
				</li>
				<li aria-current={opening ? 'step' : undefined}>
					<HomeIcon class="size-4" aria-hidden="true" />Accueil
				</li>
			</ol>{/if}
		<h1 class="page-title">
			{mode === 'activation' ? 'Activer mon espace enseignant' : 'Accès enseignant'}
		</h1>
		<p class="intro">
			{#if mode === 'activation'}
				{#if identity}
					Votre invitation est prête. Créez une clé d’accès pour ouvrir votre espace.
				{:else}
					Vérifiez votre invitation, puis créez une clé d’accès pour ouvrir votre espace.
				{/if}
			{:else}
				Ouvrez Campus avec votre clé d’accès.
			{/if}
		</p>

		{#if activeIssue}
			<Alert.Root class="mb-7" bind:ref={issueElement} tabindex={-1}>
				<CircleAlertIcon aria-hidden="true" />
				<Alert.Title>{activeIssue.title}</Alert.Title>
				<Alert.Description>{activeIssue.description}</Alert.Description>
			</Alert.Root>
		{/if}

		<noscript>
			<p class="intro">Activez JavaScript dans votre navigateur pour utiliser votre clé d’accès.</p>
		</noscript>

		{#if mode === 'activation'}
			<section class="invitation-identity" aria-labelledby="invitation-title">
				<h2 id="invitation-title" class="item-title">Votre invitation</h2>
				{#if identity}<div class="identity">
						<Avatar.Root class="size-10 shrink-0" aria-hidden="true"
							><Avatar.Fallback>{getInitials(identity.name)}</Avatar.Fallback></Avatar.Root
						>
						<div class="min-w-0">
							<p class="identity-name">{identity.name}</p>
							<p class="identity-email">{identity.email}</p>
						</div>
					</div>
					<p class="explanation identity-help">Identité de l’invitation · non modifiable</p>
				{:else if preparing || !mounted}<div class="identity" aria-hidden="true">
						<Skeleton class="size-10 shrink-0 rounded-control" />
						<div class="flex min-w-0 flex-1 flex-col gap-2">
							<Skeleton class="h-4 w-3/5" /><Skeleton class="h-4 w-4/5" />
						</div>
					</div>
				{:else}<p class="explanation">Votre invitation doit être vérifiée avant de créer une clé d’accès.</p>{/if}
				{#if canRetryInvitation}<Button
						variant="outline"
						class="mt-4 h-auto min-h-11 w-full py-3"
						disabled={preparing || busy || opening}
						onclick={verifyInvitation}>Réessayer la vérification</Button
					>{/if}
			</section>
		{/if}
		<div class="access-action">
			<PrivacyNotice>
				Votre identité et votre clé d’accès servent à sécuriser votre compte. Campus ne reçoit aucune donnée biométrique
				de votre appareil.
			</PrivacyNotice>
			{#if mode === 'activation'}
				<p class="explanation">
					<a
						href={resolve('/conditions-utilisation')}
						target="_blank"
						rel="noopener noreferrer"
						class="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
						>Consulter les conditions d’utilisation<span class="sr-only"> (nouvel onglet)</span></a
					>
				</p>
			{/if}
			{@render primaryAction()}
		</div>
		{#if mode === 'activation'}<div class="existing-access">
				<Button variant="link" href={resolve('/connexion')} class="h-auto min-h-11 max-w-full"
					><span class="min-w-0 whitespace-normal">J’ai déjà une clé d’accès</span></Button
				>
			</div>{/if}
	</div>
</ApplicationAccess>

<style>
	.access-main {
		min-width: 0;
	}
	.access-action {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	h1 {
		margin: 0 0 1rem;
	}
	h2 {
		margin: 0 0 0.75rem;
	}
	.intro,
	.explanation,
	.progress {
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.65;
		overflow-wrap: anywhere;
	}
	.intro {
		max-width: 48ch;
		margin-bottom: 2rem;
	}
	.explanation {
		margin: 0 0 1rem;
	}
	.progress {
		margin: 0.75rem 0 0;
		min-height: 1.5rem;
	}
	.compact-steps {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.25rem;
		list-style: none;
		padding: 0 0 1.25rem;
		margin: 0 0 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.compact-steps li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--muted-foreground);
	}
	.compact-steps li[aria-current='step'] {
		color: var(--primary);
		font-weight: 600;
	}
	.invitation-identity {
		margin-bottom: 1.5rem;
		padding: 1.25rem;
		background: var(--muted);
		border-radius: var(--radius-lg);
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
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.identity-name {
		font-weight: 600;
	}
	.identity-email {
		color: var(--muted-foreground);
	}
	.identity-help {
		margin-top: 0.75rem;
		margin-bottom: 0;
	}
	.access-help {
		border-top: 1px solid var(--border);
		padding-top: 1.5rem;
	}
	.existing-access {
		margin-top: 1rem;
		text-align: center;
	}
	@media (min-width: 64rem) {
		.access-help {
			border: 0;
			padding: 0;
		}
	}
</style>
