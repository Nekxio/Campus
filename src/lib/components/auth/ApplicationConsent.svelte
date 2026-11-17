<script lang="ts">
	import { resolve } from '$app/paths';
	import { notify } from '#lib/client/notifications.js';
	import { focusFirstInvalidField } from '#lib/client/form-feedback.js';
	import { onMount, tick, untrack } from 'svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { consentRedirectResponse } from '#lib/teaching/action-responses.js';
	import { defaults, superForm, type SuperValidated } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getInitials } from '#lib/profile.js';
	import {
		consentDecisionSchema,
		defaultMcpScopes,
		groupMcpScopes,
		isStudentDataScope,
		scopeDetails,
		type ConsentDecision,
		type McpScope
	} from '#lib/domain/remote-mcp.js';
	import type { readOAuthRequest } from '#lib/server/mcp/consent.js';
	let {
		application,
		name,
		initialForm,
		initialIssue = '',
		initialStatus = 200
	}: {
		application: Awaited<ReturnType<typeof readOAuthRequest>>;
		name: string;
		initialForm?: SuperValidated<ConsentDecision>;
		initialIssue?: string;
		initialStatus?: number;
	} = $props();
	const reviewed = untrack(() => application);
	const consentForm = superForm<ConsentDecision>(
		untrack(() => initialForm) ??
			defaults(
				{
					oauthQuery: reviewed.oauthQuery,
					accept: true,
					scopes: defaultMcpScopes(reviewed.scopes)
				},
				zod4Client(consentDecisionSchema)
			),
		{
			id: 'application-consent',
			validators: zod4Client(consentDecisionSchema),
			dataType: 'form',
			invalidateAll: false,
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const { form: consentData } = consentForm;
	const transport = createFormActionTransport(consentForm);
	let busy = $state(false);
	let issue = $state(untrack(() => initialIssue));
	let issueElement = $state<HTMLDivElement | null>(null);
	let expired = $state(untrack(() => initialStatus === 400));
	let refused = $state(false);
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
	});
	const privateData = $derived($consentData.scopes.some(isStudentDataScope));
	const groups = $derived(
		groupMcpScopes(reviewed.scopes).map((group) => ({
			...group,
			selected: group.scopes.filter((scope) => $consentData.scopes.includes(scope)).length
		}))
	);
	const showInitialErrors = untrack(() => Boolean(initialForm?.errors.scopes));
	let expandedGroups = $state<Record<string, boolean>>(
		Object.fromEntries(groupMcpScopes(reviewed.scopes).map((group) => [group.id, showInitialErrors]))
	);
	const required = (scope: McpScope) => scope === 'modules:read';
	const toggleScopes = (scopes: McpScope[], checked: boolean) => {
		$consentData.scopes = reviewed.scopes.filter(
			(scope) => required(scope) || (scopes.includes(scope) ? checked : $consentData.scopes.includes(scope))
		);
	};
	const decide = async (accept: boolean, formElement?: HTMLFormElement) => {
		if (busy || expired) return;
		busy = true;
		$consentData.accept = accept;
		const checked = await consentForm.validateForm({ update: true });
		if (!checked.valid) {
			for (const group of groups) expandedGroups[group.id] = true;
			busy = false;
			notify('Vérifiez les droits signalés.', 'error');
			if (formElement) await focusFirstInvalidField(formElement);
			return;
		}
		issue = '';
		try {
			const target = await transport.submit(
				'/autoriser?' + reviewed.oauthQuery + '&/decideConsent',
				{ ...checked.data, accept },
				(value) => consentRedirectResponse(value, window.location.origin, reviewed.oauthQuery)
			);
			refused = !accept;
			notify(accept ? 'Accès accordé à l’application.' : 'Accès refusé à l’application.');
			await tick();
			window.location.assign(target);
		} catch (cause) {
			expired = cause instanceof TeachingRequestError && cause.status === 400;
			issue =
				cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof SyntaxError)
					? cause.message
					: 'La décision n’a pas pu être confirmée. Réessayez.';
			notify(issue, 'error');
			busy = false;
			await tick();
			issueElement?.focus();
		}
	};
</script>

<h1 class="mb-2 page-title">
	{refused ? 'Demande refusée' : 'Autoriser ' + reviewed.name}
</h1>
<p class="mb-4 text-sm leading-normal text-muted-foreground">
	Les droits demandés sont déjà cochés. Ajustez-les par rubrique ou dans le détail.
</p>
<div class="consent-parties">
	<div class="consent-identity">
		<Avatar.Root class="size-10 shrink-0" aria-hidden="true"
			><Avatar.Fallback>{getInitials(name)}</Avatar.Fallback></Avatar.Root
		>
		<div>
			<p class="text-sm leading-normal font-medium">{name}</p>
			<p class="text-xs text-muted-foreground">Espace enseignant</p>
		</div>
	</div>
	<div class="application-identity">
		<h2 class="text-lg font-semibold wrap-anywhere">{reviewed.name}</h2>
		<p class="mt-1 text-sm leading-normal text-muted-foreground">Nom déclaré par l’application</p>
	</div>
</div>
<form
	method="POST"
	novalidate
	aria-busy={busy}
	action={'/autoriser?' + reviewed.oauthQuery + '&/decideConsent'}
	enctype="multipart/form-data"
	use:transport.enhance
	onsubmit={transport.handleSubmit((event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
		event.preventDefault();
		const accept = event.submitter?.getAttribute('value') !== 'false';
		void decide(accept, event.currentTarget);
	})}
>
	<input type="hidden" name="oauthQuery" value={$consentData.oauthQuery} />
	<input type="hidden" name="__superform_id" value="application-consent" />
	<input type="hidden" name="scopes" value="modules:read" />
	<Form.Fieldset form={consentForm} name="scopes" class="gap-0" disabled={busy || expired}>
		<Form.Legend class="text-sm leading-normal font-semibold">Droits demandés</Form.Legend>
		{#each groups as group (group.id)}
			<div class={['permission-group', { enhanced: hydrated }]}>
				{#if hydrated}
					<label class="group-toggle">
						<input
							type="checkbox"
							aria-labelledby={'consent-group-' + group.id}
							aria-describedby={'consent-group-count-' + group.id}
							checked={group.selected === group.scopes.length}
							{@attach (element) => {
								element.indeterminate = group.selected > 0 && group.selected < group.scopes.length;
							}}
							onchange={(event) => toggleScopes(group.scopes, event.currentTarget.checked)}
							disabled={group.scopes.every(required)}
							class="size-5 shrink-0 rounded border-(--control-border) accent-primary not-checked:bg-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						/>
					</label>
				{/if}
				<details class="group min-w-0" open={expandedGroups[group.id]}>
					<summary
						class="group-summary rounded-control"
						onclick={(event) => {
							event.preventDefault();
							expandedGroups[group.id] = !expandedGroups[group.id];
						}}
					>
						<div class="min-w-0">
							<span id={'consent-group-' + group.id} class="text-sm font-medium">{group.title}</span>
							<span id={'consent-group-count-' + group.id} class="block text-xs text-muted-foreground">
								{#if hydrated}{group.selected} / {group.scopes.length} sélectionné{group.scopes.length > 1
										? 's'
										: ''}{:else}{group.scopes.length}
									droit{group.scopes.length > 1 ? 's' : ''} demandé{group.scopes.length > 1 ? 's' : ''}{/if}
							</span>
							{#if group.notice}<span class="block text-xs font-medium">{group.notice}</span>{/if}
						</div>
						<ChevronDownIcon
							class="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
							aria-hidden="true"
						/>
					</summary>
					{#each group.scopes as scope (scope)}
						<div class="permission-row">
							<Form.Control
								>{#snippet children({ props })}
									<div class="permission">
										<input
											type="checkbox"
											{...props}
											aria-describedby={[props['aria-describedby'], 'consent-description-' + scope]
												.filter(Boolean)
												.join(' ')}
											name="scopes"
											value={scope}
											checked={$consentData.scopes.includes(scope)}
											onchange={(event) => toggleScopes([scope], event.currentTarget.checked)}
											class="mt-1 size-5 shrink-0 rounded border-(--control-border) accent-primary not-checked:bg-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
											disabled={required(scope)}
										/>
										<div>
											<Form.Label class="min-h-11 cursor-pointer leading-6"
												>{scopeDetails[scope].title}{required(scope) ? '' : ' (optionnel)'}</Form.Label
											>
											<p id={'consent-description-' + scope} class="text-sm text-muted-foreground">
												{scopeDetails[scope].description}
											</p>
										</div>
									</div>
								{/snippet}</Form.Control
							>
						</div>
					{/each}
				</details>
			</div>
		{/each}
		<Form.FieldErrors />
	</Form.Fieldset>
	{#if privateData}<Alert.Root class="mt-5" role="note"
			><Alert.Title>Des données d’étudiants sont concernées</Alert.Title><Alert.Description
				>Les droits cochés donnent accès à des données privées. Vérifiez les conditions de l’application.
				<a
					class="underline underline-offset-4"
					href={resolve('/confidentialite#destinataires')}
					target="_blank"
					rel="noopener noreferrer">Données transmises aux applications (nouvel onglet)</a
				>.</Alert.Description
			></Alert.Root
		>{/if}
	<p class="mt-4 text-sm leading-normal text-muted-foreground">
		Vous pourrez retirer cet accès depuis « Applications connectées ».
	</p>
	{#if issue}<Alert.Root variant="destructive" class="mt-4" bind:ref={issueElement} tabindex={-1}
			><Alert.Title>Décision non confirmée</Alert.Title><Alert.Description>{issue}</Alert.Description></Alert.Root
		>{/if}
	<div class="consent-actions">
		<Button type="submit" name="accept" value="true" class="w-full" disabled={busy || expired} aria-busy={busy}
			>{busy ? 'Enregistrement…' : 'Autoriser ' + reviewed.name}</Button
		><Button type="submit" name="accept" value="false" variant="ghost" disabled={busy || expired}>Refuser</Button>
	</div>
</form>

<style>
	.consent-identity {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.permission-group {
		border-bottom: 1px solid var(--border);
	}
	.permission-group.enhanced {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr);
	}
	.group-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		align-self: start;
		min-height: 3.25rem;
		cursor: pointer;
	}
	.group-summary {
		display: flex;
		min-height: 3.25rem;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-block: 0.5rem;
		cursor: pointer;
		list-style: none;
	}
	.group-summary::-webkit-details-marker {
		display: none;
	}
	.group-summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.permission-row {
		padding-block: 0.75rem;
		border-top: 1px solid var(--border);
	}
	.permission {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		min-height: 2.75rem;
	}
	.permission > div {
		min-width: 0;
	}
	.consent-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}
	.consent-parties {
		display: grid;
		gap: 0.75rem;
		padding-block: 1rem;
		margin-bottom: 1rem;
		border-block: 1px solid var(--border);
	}
	@media (min-width: 40rem) {
		.consent-parties {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
