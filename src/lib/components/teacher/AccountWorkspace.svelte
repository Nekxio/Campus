<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';

	let {
		userName,
		currentView,
		children
	}: {
		userName: string;
		currentView: 'account' | 'applications';
		children: Snippet;
	} = $props();
</script>

<div class="account-workspace page-sections">
	<header>
		<h1 class="page-title">Compte</h1>
		<p class="mt-2 max-w-prose supporting-text text-muted-foreground">
			Gérez vos informations, votre accès et vos applications connectées.
		</p>
	</header>
	<div class="account-columns">
		<nav class="account-navigation" aria-label="Sections du compte">
			<p class="account-name panel-title">{userName}</p>
			<div class="account-links">
				<Button
					variant="ghost"
					href={resolve('/enseignant/compte')}
					aria-current={currentView === 'account' ? 'page' : undefined}
				>
					Informations et accès
				</Button>
				<Button
					variant="ghost"
					href={resolve('/enseignant/applications')}
					aria-current={currentView === 'applications' ? 'page' : undefined}
				>
					Applications connectées
				</Button>
			</div>
		</nav>
		<div class="account-content">
			{@render children()}
		</div>
	</div>
</div>

<style>
	.account-workspace {
		max-width: 70rem;
	}
	.account-columns {
		display: grid;
		min-width: 0;
		gap: 2rem;
	}
	.account-navigation,
	.account-content {
		min-width: 0;
	}
	.account-name {
		margin-bottom: 1rem;
		overflow-wrap: anywhere;
	}
	.account-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.account-links :global(a) {
		justify-content: start;
		min-height: 2.75rem;
		white-space: normal;
		text-align: start;
	}
	.account-links :global(a[aria-current='page']) {
		color: var(--accent-foreground);
		background: var(--accent);
		font-weight: 600;
	}
	@media (min-width: 64rem) {
		.account-columns {
			grid-template-columns: 13rem minmax(0, 1fr);
		}
		.account-navigation {
			position: sticky;
			top: 6rem;
			align-self: start;
		}
		.account-links {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
