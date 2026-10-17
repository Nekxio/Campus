<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import * as Form from '#lib/components/ui/form/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getInitials } from '#lib/profile.js';
	import {
		consentDecisionSchema,
		scopeDetails,
		type ConsentDecision,
		type McpScope
	} from '#lib/domain/remote-mcp.js';
	import type { readOAuthRequest } from '#lib/server/mcp/consent.js';
	let {
		application,
		name
	}: { application: Awaited<ReturnType<typeof readOAuthRequest>>; name: string } = $props();
	const reviewed = untrack(() => application);
	const consentForm = superForm<ConsentDecision>(
		defaults(
			{
				oauthQuery: reviewed.oauthQuery,
				accept: true,
				scopes: reviewed.scopes.filter((s) => s !== 'offline_access')
			},
			zod4Client(consentDecisionSchema)
		),
		{
			id: 'application-consent',
			validators: zod4Client(consentDecisionSchema),
			dataType: 'json',
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const { form: consentData } = consentForm;
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	let busy = $state(false);
	let issue = $state('');
	let expired = $state(false);
	let refused = $state(false);
	const privateData = $derived(reviewed.scopes.some((s) => s.startsWith('corrections:')));
	function toggleScope(scope: McpScope, checked: boolean) {
		$consentData.scopes = checked
			? [...new Set([...$consentData.scopes, scope])]
			: $consentData.scopes.filter((value) => value !== scope);
	}
	function required(scope: McpScope) {
		return scope === 'modules:read';
	}
	async function decide(accept: boolean) {
		if (busy || expired) return;
		$consentData.accept = accept;
		const checked = await consentForm.validateForm({ update: true });
		if (!checked.valid) return;
		busy = true;
		issue = '';
		try {
			const response = await fetch('/api/mcp/consent', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...checked.data, accept })
			});
			const body: unknown = await response.json();
			if (!body || typeof body !== 'object') throw new Error('Réponse indisponible. Réessayez.');
			if (!response.ok) {
				expired = response.status === 400;
				throw new Error(
					('message' in body && typeof body.message === 'string' ? body.message : '') ||
						'La décision n’a pas pu être confirmée. Réessayez.'
				);
			}
			refused = !accept;
			if (!('url' in body) || typeof body.url !== 'string')
				throw new Error('Redirection indisponible. Réessayez.');
			window.location.assign(body.url);
		} catch (cause) {
			issue =
				cause instanceof Error
					? cause.message
					: 'La décision n’a pas pu être confirmée. Réessayez.';
			busy = false;
		}
	}
</script>

<h1 class="mb-4 text-3xl font-semibold tracking-tight wrap-anywhere sm:text-4xl">
	{refused ? 'Demande refusée' : 'Autoriser ' + reviewed.name}
</h1>
<p class="mb-8 text-sm leading-normal text-muted-foreground">
	Choisissez les droits que vous souhaitez accorder à cette application.
</p>
<div class="mb-6 flex items-center gap-3 border-b pb-6">
	<span
		class="flex size-9 items-center justify-center rounded-full border bg-muted text-xs"
		aria-hidden="true">{getInitials(name)}</span
	>
	<div>
		<p class="text-sm leading-normal font-medium">{name}</p>
		<p class="text-xs text-muted-foreground">Espace enseignant</p>
	</div>
</div>
<div class="mb-7">
	<h2 class="text-lg font-semibold wrap-anywhere">{reviewed.name}</h2>
	<p class="mt-1 text-sm leading-normal text-muted-foreground">Nom déclaré par l’application</p>
	<p class="text-xs wrap-anywhere text-muted-foreground">Identifiant : {reviewed.clientId}</p>
</div>
<form
	method="POST"
	onsubmit={(event) => {
		event.preventDefault();
		void decide(true);
	}}
>
	<fieldset disabled={!mounted || busy || expired}>
		<legend class="mb-1 text-sm leading-normal font-semibold">Droits demandés</legend>
		{#each reviewed.scopes as scope (scope)}
			<Form.Field form={consentForm} name="scopes" class="py-3.5">
				<Form.Control
					>{#snippet children({ props })}
						<div class="permission">
							<Checkbox
								{...props}
								value={scope}
								checked={$consentData.scopes.includes(scope)}
								onCheckedChange={(checked) => toggleScope(scope, checked)}
								class="mt-0.5 size-5 shrink-0 after:-inset-y-3"
								disabled={required(scope)}
							/>
							<div>
								<Form.Label class="min-h-6 cursor-pointer leading-6"
									>{scopeDetails[scope].title}{required(scope) ? ' · requis' : ''}</Form.Label
								><Form.Description>{scopeDetails[scope].description}</Form.Description>
							</div>
						</div>
					{/snippet}</Form.Control
				><Form.FieldErrors />
			</Form.Field>
		{/each}
	</fieldset>
	{#if privateData}<aside
			class="mt-4 rounded-xl border border-[color:var(--control-border)] p-4 text-sm leading-normal"
		>
			<strong>Des données d’étudiants sont concernées</strong>
			<p class="mt-1.5">
				La liste de la classe, les notes et les commentaires privés de la correction sélectionnée
				pourront être lus par cette application.
			</p>
		</aside>{/if}
	<p class="mt-3 border-t pt-5 text-sm leading-normal text-muted-foreground">
		La publication et la validation des notes restent dans Coursely. Vous pourrez retirer cet accès
		depuis « Applications connectées ».
	</p>
	{#if issue}<p class="mt-4 text-sm leading-normal text-destructive" role="alert">{issue}</p>{/if}
	<div class="mt-6 flex flex-col gap-1">
		<Button type="submit" class="w-full" disabled={!mounted || busy || expired} aria-busy={busy}
			>{busy ? 'Enregistrement…' : 'Autoriser ' + reviewed.name}</Button
		><Button
			type="button"
			variant="ghost"
			class="self-center"
			onclick={() => decide(false)}
			disabled={!mounted || busy || expired}>Refuser</Button
		>
	</div>
</form>

<style>
	.permission {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		min-height: 2.75rem;
	}
</style>
