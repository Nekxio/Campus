<script lang="ts">
	import { notify } from '#lib/client/notifications.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import { tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { revocationReceiptSchema } from '#lib/teaching/action-responses.js';
	import { defaults, superForm, type SuperValidated } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { revokeConsentSchema, scopeDetails, type RevokeConsent } from '#lib/domain/remote-mcp.js';
	import type { listApplications } from '#lib/server/mcp/consent.js';
	let {
		application,
		initialForm,
		initialIssue = '',
		initialStale = false,
		onRefresh,
		onRevoked
	}: {
		application: Awaited<ReturnType<typeof listApplications>>[number];
		initialForm?: SuperValidated<RevokeConsent>;
		initialIssue?: string;
		initialStale?: boolean;
		onRefresh: () => Promise<void>;
		onRevoked: (name: string) => Promise<void>;
	} = $props();
	const reviewed = untrack(() => application);
	const revokeForm = superForm<RevokeConsent>(
		untrack(() => initialForm) ??
			defaults({ id: reviewed.id, reviewedVersion: reviewed.reviewedVersion }, zod4Client(revokeConsentSchema)),
		{
			id: 'revoke-' + reviewed.id,
			validators: zod4Client(revokeConsentSchema),
			dataType: 'form',
			invalidateAll: false,
			applyAction: 'never',
			resetForm: false,
			taintedMessage: false
		}
	);
	const transport = createFormActionTransport(revokeForm);
	const { form: revokeData } = revokeForm;
	let confirmation = $state(untrack(() => !!initialIssue));
	let busy = $state(false);
	let stale = $state(untrack(() => initialStale));
	let issue = $state(untrack(() => initialIssue));
	let issueElement = $state<HTMLDivElement | null>(null);
	let formElement = $state<HTMLFormElement | null>(null);
	let keepButton = $state<HTMLAnchorElement | null>(null);
	let revokeButton = $state<HTMLElement | null>(null);
	const toggleConfirmation = async (event: MouseEvent) => {
		event.preventDefault();
		if (busy) return;
		confirmation = !confirmation;
		await tick();
		if (confirmation) keepButton?.focus();
	};
	const cancel = async () => {
		confirmation = false;
		issue = '';
		await tick();
		revokeButton?.focus();
	};
	const escape = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && confirmation && !busy && formElement?.contains(document.activeElement)) {
			event.preventDefault();
			void cancel();
		}
	};
	const revoke = async (event: SubmitEvent) => {
		event.preventDefault();
		if (busy || stale) return;
		busy = true;
		const checked = await revokeForm.validateForm({ update: true });
		if (!checked.valid) {
			busy = false;
			notify('Confirmation invalide. Actualisez l’autorisation.', 'error');
			return;
		}
		issue = '';
		try {
			await transport.submit(
				'/enseignant/applications?/revokeApplication',
				checked.data,
				revocationReceiptSchema.parse
			);
			await onRevoked(reviewed.name);
		} catch (cause) {
			stale = cause instanceof TeachingRequestError && cause.status === 409;
			issue = stale
				? 'Cette autorisation a changé. Actualisez avant de décider.'
				: cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof SyntaxError)
					? cause.message
					: 'La révocation n’a pas pu être confirmée. Réessayez.';
			notify(issue, 'error');
			busy = false;
			await tick();
			issueElement?.focus();
		}
	};
	const refreshAuthorization = async () => {
		if (busy) return;
		busy = true;
		try {
			await onRefresh();
			notify('Autorisation actualisée.', 'info');
		} catch {
			issue = 'Actualisation impossible. L’autorisation examinée est conservée ; réessayez.';
			notify(issue, 'error');
			await tick();
			issueElement?.focus();
		} finally {
			busy = false;
		}
	};
	const grantedAt = formatLessonDate(reviewed.createdAt);
</script>

<svelte:window onkeydown={escape} />
<section class="application-grant" aria-label={'Autorisation de ' + reviewed.name}>
	<header class="grant-header">
		<div>
			<h2 class="panel-title">{reviewed.name}</h2>
			<p>Nom déclaré par l’application</p>
		</div>
		<Badge variant="secondary">Autorisation accordée</Badge>
	</header>
	<div class="grant-permissions">
		<h3 class="item-title">Droits accordés</h3>
		<dl>
			{#each reviewed.scopes as scope (scope)}<div>
					<dt>{scopeDetails[scope].title}</dt>
					<dd>{scopeDetails[scope].description}</dd>
				</div>{/each}
		</dl>
	</div>
	<footer class="grant-footer">
		<p class="grant-date">Accordée le {grantedAt}</p>
		<details bind:open={confirmation} class="grant-confirmation">
			<summary
				class={cn(buttonVariants({ variant: 'destructive-outline' }), 'grant-summary')}
				onclick={toggleConfirmation}
				hidden={confirmation}
				bind:this={revokeButton}
			>
				Révoquer l’accès
			</summary>
			<form
				method="POST"
				action="?/revokeApplication"
				novalidate
				aria-busy={busy}
				bind:this={formElement}
				use:transport.enhance
				onsubmit={transport.handleSubmit(revoke)}
				class="mt-6 border-t pt-6"
			>
				<input type="hidden" name="id" value={$revokeData.id} />
				<input type="hidden" name="reviewedVersion" value={$revokeData.reviewedVersion} />
				<input type="hidden" name="__superform_id" value={'revoke-' + reviewed.id} />
				<h3 class="mb-2 item-title">Révoquer l’accès de {reviewed.name} ?</h3>
				<p class="text-sm leading-normal text-muted-foreground">
					Cette application ne pourra plus utiliser les droits accordés à votre espace. Vos modules, notes et votre
					session Campus sont conservés.
				</p>
				{#if issue}<Alert.Root variant="destructive" class="mt-4" bind:ref={issueElement} tabindex={-1}
						><Alert.Title>Révocation non confirmée</Alert.Title><Alert.Description>{issue}</Alert.Description
						></Alert.Root
					>{/if}
				<div class="mt-6 flex flex-col gap-2 sm:flex-row">
					<Button
						href={resolve('/enseignant/applications')}
						variant="outline"
						onclick={(event) => {
							event.preventDefault();
							void cancel();
						}}
						disabled={busy}
						bind:ref={keepButton}>Conserver l’accès</Button
					>{#if stale}<Button
							href={resolve('/enseignant/applications')}
							variant="outline"
							disabled={busy}
							onclick={(event) => {
								event.preventDefault();
								void refreshAuthorization();
							}}>Actualiser l’autorisation</Button
						>{:else}<Form.Button variant="destructive" disabled={busy} aria-busy={busy}
							>{busy ? 'Révocation…' : 'Révoquer l’accès'}</Form.Button
						>{/if}
				</div>
			</form>
		</details>
	</footer>
</section>

<style>
	.application-grant {
		min-width: 0;
		padding: 1.5rem;
		border-radius: var(--radius);
		background: var(--card);
	}
	.grant-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.grant-header > div {
		min-width: 0;
	}
	.grant-header p,
	.grant-date {
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.grant-permissions {
		display: grid;
		gap: 1rem;
		padding-block: 1.5rem;
	}
	dl {
		display: grid;
		gap: 1.25rem;
		min-width: 0;
	}
	dt {
		font-size: 0.875rem;
		font-weight: 500;
	}
	dd {
		margin-top: 0.25rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.grant-summary {
		cursor: pointer;
		list-style: none;
	}
	.grant-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-top: 1px solid var(--border);
		padding-top: 1.25rem;
	}
	.grant-confirmation[open] {
		flex-basis: 100%;
	}
	.grant-summary::-webkit-details-marker {
		display: none;
	}
	.grant-confirmation::details-content {
		transition: none;
	}
	@media (min-width: 64rem) {
		.application-grant {
			display: grid;
			grid-template-columns: minmax(11rem, 0.65fr) minmax(0, 1fr);
			gap: 1.5rem;
		}
		.grant-header {
			flex-direction: column;
			justify-content: start;
			border-bottom: 0;
			padding-bottom: 0;
		}
		.grant-footer {
			grid-column: 1 / -1;
		}
		.grant-permissions {
			padding-block: 0;
		}
		.grant-permissions {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
		}
	}
	@media (max-width: 30rem) {
		.application-grant {
			padding: 1.25rem;
		}
		.grant-confirmation,
		.grant-summary {
			width: 100%;
		}
	}
</style>
