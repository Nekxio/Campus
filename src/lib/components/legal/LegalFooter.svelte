<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '#lib/utils.js';
	let { class: className }: { class?: string } = $props();
</script>

<footer class={cn('legal-footer', className)}>
	<nav aria-label="Informations légales">
		<a href={resolve('/mentions-legales')}>Mentions légales</a>
		<a href={resolve('/confidentialite')}>Confidentialité</a>
		<a href={resolve('/conditions-utilisation')}>Conditions d’utilisation</a>
		<a href={resolve('/confidentialite#cookies')}>Cookies</a>
		<a href={resolve('/mentions-legales#contact')}>Contact</a>
	</nav>
</footer>

<style>
	.legal-footer {
		border-top: 1px solid var(--border);
		padding: 1rem max(1rem, env(safe-area-inset-right, 0px)) calc(1rem + env(safe-area-inset-bottom, 0px))
			max(1rem, env(safe-area-inset-left, 0px));
		color: var(--muted-foreground);
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		column-gap: 1.5rem;
		row-gap: 0.25rem;
	}
	a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-size: 0.875rem;
		text-underline-offset: 0.2em;
	}
	a:hover {
		color: var(--foreground);
		text-decoration: underline;
	}
	a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: var(--radius-sm);
	}
</style>
