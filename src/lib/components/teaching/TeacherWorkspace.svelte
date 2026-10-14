<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import TeacherNavigation from '#lib/components/teacher/TeacherNavigation.svelte';
	import TeacherHeader from '#lib/components/teacher/TeacherHeader.svelte';
	let {
		userName,
		active = 'home',
		title = 'Mon espace',
		boundedCorrection = false,
		parentLink,
		children
	}: {
		userName: string;
		active?: 'home' | 'classes' | 'modules' | 'grading';
		title?: string;
		boundedCorrection?: boolean;
		parentLink?: { href: string; label: string };
		children: Snippet;
	} = $props();
	async function restoreSidebarFocus(open: boolean) {
		if (open) return;
		const current = document.activeElement;
		if (
			document.querySelector('[data-slot="sidebar-container"]')?.contains(current) ||
			document.getElementById('sidebar-account-menu')?.contains(current)
		) {
			await tick();
			document.getElementById('sidebar-toggle')?.focus();
		}
	}
</script>

<a href="#workspace-content" class="skip-link">Aller au contenu principal</a>
<Sidebar.Provider
	style="--sidebar-width: 18rem;"
	class="min-h-dvh"
	onOpenChange={restoreSidebarFocus}
>
	<TeacherNavigation {userName} {active} />
	<Sidebar.Inset class="min-w-0">
		<TeacherHeader {title} {parentLink} />
		<div
			id="workspace-content"
			data-bounded-correction={boundedCorrection}
			tabindex="-1"
			class="mx-auto w-full max-w-6xl px-5 pt-9 pb-10 sm:px-8 sm:pt-10 xl:px-12"
		>
			{@render children()}
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>

<style>
	@media (min-width: 80rem) and (min-height: 36rem) {
		#workspace-content[data-bounded-correction='true'] {
			/* The editor height already reserves the sidebar inset's bottom margin. */
			padding-bottom: 0;
		}
	}
</style>
