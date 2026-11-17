<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import { notify, notifyAfterNavigation } from '#lib/client/notifications.js';
	import { passkeySignInSchema } from '#lib/teaching/action-responses.js';
	import { onMount } from 'svelte';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import { authClient } from '#lib/auth-client.js';
	import ApplicationAccess from '#lib/components/auth/ApplicationAccess.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let ready = $state(false);
	let busy = $state(false);
	let issue = $state('');
	onMount(() => {
		ready =
			window.isSecureContext &&
			typeof window.PublicKeyCredential !== 'undefined' &&
			typeof navigator.credentials?.get === 'function';
	});
	const signIn = async () => {
		if (!data.application || busy || !ready) return;
		busy = true;
		issue = '';
		try {
			const result = await authClient.signIn.passkey();
			if (result.error || !passkeySignInSchema.safeParse(result.data).success)
				throw new Error('La connexion n’a pas abouti. Réessayez avec l’appareil sur lequel votre clé est disponible.');
			notifyAfterNavigation('signed-in');
			window.location.reload();
		} catch (cause) {
			issue =
				cause instanceof Error && cause.message.startsWith('La connexion')
					? cause.message
					: 'La connexion n’a pas abouti. Réessayez avec votre clé d’accès.';
			notify(issue, 'error');
			busy = false;
		}
	};
</script>

<PageHead
	title="Connexion d’une application"
	description="Se connecter avant de choisir les droits accordés à une application."
/>
<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>
<ApplicationAccess>
	{#if !data.application}
		<h1 class="mb-4 page-title">La demande est indisponible</h1>
		<p class="text-sm leading-normal text-muted-foreground">{data.issue}</p>
	{:else}
		<h1 class="mb-4 page-title">
			Connecter {data.application.name} à Campus
		</h1>
		<p class="mb-8 text-sm leading-normal text-muted-foreground">
			Connectez-vous avec votre clé d’accès. Vous choisirez ensuite les droits accordés à cette application.
		</p>
		<div class="mb-5">
			<PrivacyNotice>
				Votre identité et votre clé d’accès servent à sécuriser votre compte. Campus ne reçoit aucune donnée biométrique
				de votre appareil.
			</PrivacyNotice>
		</div>
		<Button type="button" class="w-full" onclick={signIn} disabled={!ready || busy} aria-busy={busy}
			>{#if busy}<Spinner aria-hidden="true" />{:else}<KeyRoundIcon aria-hidden="true" />{/if}Continuer avec ma clé
			d’accès</Button
		>
		<p
			class={['text-sm leading-normal', { 'mt-4 min-h-6': issue || busy }]}
			class:text-destructive={!!issue}
			class:text-muted-foreground={!issue}
			role="status"
		>
			{issue || (busy ? 'Choisissez votre clé d’accès dans la fenêtre de votre appareil.' : '')}
		</p>
		<section class="mt-8 border-t pt-6">
			<h2 class="mb-3 text-base font-semibold">Votre clé d’accès</h2>
			<p class="text-sm leading-normal text-muted-foreground">
				Votre appareil ou votre gestionnaire de clés d’accès vous demandera de confirmer votre identité.
			</p>
			<p class="mt-3 text-sm leading-normal text-muted-foreground">
				Aucun droit n’est accordé à l’application à cette étape.
			</p>
		</section>
	{/if}
</ApplicationAccess>
