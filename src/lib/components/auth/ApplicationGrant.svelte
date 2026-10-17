<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import { revokeConsentSchema, scopeDetails, type RevokeConsent } from '#lib/domain/remote-mcp.js';
	import type { listApplications } from '#lib/server/mcp/consent.js';
	let {
		application,
		onRevoked
	}: {
		application: Awaited<ReturnType<typeof listApplications>>[number];
		onRevoked: (name: string) => Promise<void>;
	} = $props();
	const reviewed = untrack(() => application);
	const revokeForm = superForm<RevokeConsent>(
		defaults(
			{ id: reviewed.id, reviewedVersion: reviewed.reviewedVersion },
			zod4Client(revokeConsentSchema)
		),
		{
			id: 'revoke-' + reviewed.id,
			validators: zod4Client(revokeConsentSchema),
			dataType: 'json',
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	let confirmation = $state(false);
	let busy = $state(false);
	let stale = $state(false);
	let issue = $state('');
	let formElement = $state<HTMLFormElement | null>(null);
	let keepButton = $state<HTMLButtonElement | null>(null);
	let revokeButton = $state<HTMLButtonElement | null>(null);
	async function confirm() {
		confirmation = true;
		await tick();
		keepButton?.focus();
	}
	async function cancel() {
		confirmation = false;
		issue = '';
		stale = false;
		await tick();
		revokeButton?.focus();
	}
	function escape(event: KeyboardEvent) {
		if (
			event.key === 'Escape' &&
			confirmation &&
			!busy &&
			formElement?.contains(document.activeElement)
		) {
			event.preventDefault();
			void cancel();
		}
	}
	async function revoke(event: SubmitEvent) {
		event.preventDefault();
		if (busy || stale) return;
		const checked = await revokeForm.validateForm({ update: true });
		if (!checked.valid) return;
		busy = true;
		issue = '';
		try {
			const response = await fetch('/api/mcp/applications/revoke', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(checked.data)
			});
			if (!response.ok) {
				stale = response.status === 409;
				throw new Error(
					stale
						? 'Cette autorisation a changé. Actualisez avant de décider.'
						: 'La révocation n’a pas pu être confirmée. Réessayez.'
				);
			}
			await onRevoked(reviewed.name);
		} catch (cause) {
			issue =
				cause instanceof Error
					? cause.message
					: 'La révocation n’a pas pu être confirmée. Réessayez.';
			busy = false;
		}
	}
	const grantedAt = new Intl.DateTimeFormat('fr-FR', {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone: 'Europe/Paris'
	}).format(new Date(reviewed.createdAt));
</script>

<svelte:window onkeydown={escape} />
<section
	class="max-w-4xl rounded-xl border p-5 sm:p-7"
	aria-label={'Autorisation de ' + reviewed.name}
>
	<div class="flex flex-col justify-between gap-3 sm:flex-row sm:gap-4">
		<div>
			<h2 class="text-xl font-semibold tracking-tight wrap-anywhere">{reviewed.name}</h2>
			<p class="mt-1 text-sm leading-normal text-muted-foreground">Nom déclaré par l’application</p>
			<p class="text-xs wrap-anywhere text-muted-foreground">Identifiant : {reviewed.clientId}</p>
		</div>
		<span class="inline-flex shrink-0 items-center gap-1.5 self-start text-xs text-muted-foreground"
			><CircleCheckIcon class="size-3.5" aria-hidden="true" />Autorisation accordée</span
		>
	</div>
	<ul class="my-6 space-y-2.5 text-sm leading-normal">
		{#each reviewed.scopes as scope (scope)}<li class="flex items-start gap-2.5">
				<CheckIcon
					class="mt-0.5 size-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>{scopeDetails[scope].title}
			</li>{/each}
	</ul>
	<div
		class="flex flex-col items-start justify-between gap-4 border-t pt-5 sm:flex-row sm:items-center"
	>
		<p class="text-sm leading-normal text-muted-foreground">
			Accordée le {grantedAt} · heure de Paris
		</p>
		{#if !confirmation}<Button
				type="button"
				variant="outline"
				class="w-full border-destructive text-destructive sm:w-auto"
				onclick={confirm}
				disabled={!mounted}
				bind:ref={revokeButton}>Révoquer l’accès</Button
			>{/if}
	</div>
	{#if confirmation}<form
			method="POST"
			bind:this={formElement}
			onsubmit={revoke}
			class="mt-6 border-t pt-6"
		>
			<h3 class="mb-2 text-base font-semibold">Révoquer l’accès de {reviewed.name} ?</h3>
			<p class="text-sm leading-normal text-muted-foreground">
				Cette application ne pourra plus utiliser les droits accordés à votre espace. Vos modules,
				notes et votre session Coursely sont conservés.
			</p>
			{#if issue}<p class="mt-4 text-sm leading-normal text-destructive" role="alert">
					{issue}
				</p>{/if}
			<div class="mt-5 flex flex-col gap-2.5 sm:flex-row">
				<Button
					type="button"
					variant="outline"
					onclick={cancel}
					disabled={busy}
					bind:ref={keepButton}>Conserver l’accès</Button
				>{#if stale}<Button type="button" variant="outline" onclick={() => invalidateAll()}
						>Actualiser l’autorisation</Button
					>{:else}<Form.Button
						class="bg-destructive text-white hover:bg-destructive/90 dark:text-primary-foreground"
						variant="destructive"
						disabled={busy}
						aria-busy={busy}>{busy ? 'Révocation…' : 'Révoquer l’accès'}</Form.Button
					>{/if}
			</div>
		</form>{/if}
</section>
