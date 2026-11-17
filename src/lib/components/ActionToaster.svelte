<script lang="ts">
	import { Toaster } from 'svelte-sonner';
	import { mode } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { consumeNavigationNotice } from '#lib/client/notifications.js';

	const correctionOpen = $derived(page.route.id === '/enseignant/notation/[contextId]/[studentId]');
	onMount(consumeNavigationNotice);
</script>

<Toaster
	class="campus-toaster"
	theme={mode.current}
	position={correctionOpen ? 'top-right' : 'bottom-right'}
	closeButton
	visibleToasts={3}
	pauseWhenPageIsHidden
	containerAriaLabel="Notifications"
	closeButtonAriaLabel="Fermer la notification"
	offset={{
		top: 'max(16px, env(safe-area-inset-top))',
		bottom: 'max(24px, env(safe-area-inset-bottom))',
		right: 'max(24px, env(safe-area-inset-right))'
	}}
	mobileOffset={{
		top: 'max(16px, env(safe-area-inset-top))',
		bottom: 'max(16px, env(safe-area-inset-bottom))',
		right: 'max(16px, env(safe-area-inset-right))',
		left: 'max(16px, env(safe-area-inset-left))'
	}}
	toastOptions={{
		style:
			'--normal-bg: var(--popover); --normal-text: var(--popover-foreground); --normal-border: var(--border); font-family: var(--font-sans);',
		classes: { description: '!text-muted-foreground' }
	}}
/>

<style>
	/* Sonner 1.2.1 has no close-button position option. Keep its native behavior and hit area. */
	:global(
		.campus-toaster[data-sonner-toaster][data-sonner-theme]
			[data-sonner-toast][data-styled='true']:has(> [data-close-button])
	) {
		padding-right: 3.25rem;
	}

	:global(
		.campus-toaster[data-sonner-toaster][data-sonner-theme] [data-sonner-toast][data-styled='true'] [data-close-button]
	) {
		top: 0;
		right: 0;
		left: auto;
		width: 44px;
		height: 44px;
		transform: none;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--muted-foreground);
	}

	:global(
		.campus-toaster[data-sonner-toaster][data-sonner-theme]
			[data-sonner-toast][data-styled='true']
			[data-close-button]
			svg
	) {
		width: 14px;
		height: 14px;
	}

	:global(
		.campus-toaster[data-sonner-toaster][data-sonner-theme]
			[data-sonner-toast][data-styled='true']:hover
			[data-close-button]:hover
	) {
		background: transparent;
		color: var(--foreground);
	}

	:global(
		.campus-toaster[data-sonner-toaster][data-sonner-theme]
			[data-sonner-toast][data-styled='true']
			[data-close-button]:focus-visible
	) {
		outline: 2px solid var(--ring);
		outline-offset: -4px;
		box-shadow: none;
	}
</style>
