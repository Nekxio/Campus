<script lang="ts">
	import './layout.css';
	import { initializeWorkspaceNavigation } from '#lib/components/teaching/workspace-navigation.svelte.js';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	initializeWorkspaceNavigation();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
