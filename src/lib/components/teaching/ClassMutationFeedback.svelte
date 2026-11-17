<script lang="ts">
	import { tick } from 'svelte';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { TeachingRequestError } from '#lib/teaching/api.js';

	let {
		error,
		pending = false,
		onReload
	}: {
		error: TeachingRequestError | null;
		pending?: boolean;
		onReload: () => Promise<void>;
	} = $props();
	let confirmOpen = $state(false);
	let reloading = $state(false);
	let reloadError = $state('');
	let summary = $state<HTMLDivElement | null>(null);
	let reloadSummary = $state<HTMLParagraphElement | null>(null);
	$effect(() => {
		if (error) void tick().then(() => summary?.focus());
	});

	async function reload(event: MouseEvent) {
		event.preventDefault();
		if (reloading) return;
		reloading = true;
		reloadError = '';
		try {
			await onReload();
			notify('Version actuelle rechargée.', 'info');
			confirmOpen = false;
		} catch {
			reloadError = 'Le rechargement a échoué. Vos saisies sont toujours disponibles ; réessayez.';
			await tick();
			reloadSummary?.focus();
		} finally {
			reloading = false;
		}
	}
</script>

<ActionNotice message={error?.message ?? ''} kind="error" />
<ActionNotice message={reloadError} kind="error" />

{#if error}
	<Alert.Root variant="destructive" role="alert" bind:ref={summary} tabindex={-1}>
		<Alert.Title>Enregistrement impossible</Alert.Title>
		<Alert.Description>
			<p>{error.message}</p>
			<p>Vos saisies sont conservées.</p>
			{#if error.status === 401}
				<p>Reconnectez-vous dans un autre onglet, puis réessayez ici.</p>
			{:else if error.status === 409}
				<p>Rechargez la version actuelle avant de reprendre cette modification.</p>
				<Button variant="outline" class="mt-2 min-h-11" disabled={pending} onclick={() => (confirmOpen = true)}
					>Recharger la version actuelle</Button
				>
			{/if}
		</Alert.Description>
	</Alert.Root>
{/if}

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content
		onEscapeKeydown={(event) => {
			if (reloading) event.preventDefault();
		}}
	>
		<AlertDialog.Header>
			<AlertDialog.Title>Recharger et abandonner la saisie ?</AlertDialog.Title>
			<AlertDialog.Description>
				La version actuelle sera chargée. Les modifications non enregistrées dans ce dialogue seront abandonnées.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if reloadError}<p role="alert" tabindex="-1" bind:this={reloadSummary} class="text-sm text-destructive">
				{reloadError}
			</p>{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel class="min-h-11" disabled={reloading}>Garder ma saisie</AlertDialog.Cancel>
			<AlertDialog.Action class="min-h-11" disabled={reloading} onclick={reload}>
				{reloading ? 'Rechargement…' : 'Abandonner et recharger'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
