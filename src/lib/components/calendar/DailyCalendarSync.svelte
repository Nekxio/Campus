<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toDateInput } from '#lib/teaching/calendar.js';
	import { checkDailyCalendar } from './commands.js';

	let dayChecked = '';
	let pending = false;
	let notice = $state('');
	const check = async () => {
		if (document.visibilityState !== 'visible' || pending) return;
		const today = toDateInput(new Date().toISOString()).slice(0, 10);
		if (dayChecked === today) return;
		dayChecked = today;
		pending = true;
		try {
			const settings = await checkDailyCalendar();
			if (settings.changed)
				notice =
					'Le calendrier de l’école a changé. Rechargez la page après avoir enregistré votre travail pour voir les nouvelles séances.';
		} catch {
			// Availability of the teaching workspace must not depend on the optional connection.
		} finally {
			pending = false;
		}
	};
	onMount(() => {
		void check();
	});
	afterNavigate(() => {
		void check();
	});
</script>

<svelte:document
	onvisibilitychange={() => {
		void check();
	}}
/>
{#if notice}
	<div
		role="status"
		class="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-control border p-3 text-sm"
	>
		<p class="max-w-prose min-w-0">{notice}</p>
		<a href={resolve('/enseignant/applications#calendrier')} class="font-medium underline underline-offset-4"
			>Vérifier le calendrier</a
		>
	</div>
{/if}
