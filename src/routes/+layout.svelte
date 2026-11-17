<script lang="ts">
	import './layout.css';
	import { asset } from '$app/paths';
	import { page } from '$app/state';
	import { ModeWatcher } from 'mode-watcher';
	import ActionToaster from '#lib/components/ActionToaster.svelte';
	import { initializeWorkspaceNavigation } from '#lib/components/teaching/workspace-navigation.svelte.js';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const sharingImage = $derived(new URL(asset('campus-og.png'), page.url.href).href);
	initializeWorkspaceNavigation();
</script>

<svelte:head>
	<link rel="icon" href={asset('favicon.ico')} sizes="16x16 32x32 48x48" />
	<link rel="icon" type="image/png" href={asset('icons/campus-32.png')} sizes="32x32" />
	<link rel="icon" type="image/svg+xml" href={favicon} sizes="any" />
	<link rel="apple-touch-icon" href={asset('icons/campus-180.png')} sizes="180x180" />
	<meta name="color-scheme" content="light dark" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Campus" />
	<meta property="og:locale" content="fr_FR" />
	<meta property="og:image" content={sharingImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Campus. Préparer, évaluer, partager les cours." />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content={sharingImage} />
	<meta name="twitter:image:alt" content="Campus. Préparer, évaluer, partager les cours." />
</svelte:head>

<ModeWatcher />
<ActionToaster />
{@render children()}
