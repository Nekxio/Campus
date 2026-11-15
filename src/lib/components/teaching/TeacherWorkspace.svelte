<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import { cn } from '#lib/utils.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import TeacherNavigation from '#lib/components/teacher/TeacherNavigation.svelte';
	import TeacherHeader from '#lib/components/teacher/TeacherHeader.svelte';
	import { useWorkspaceNavigation } from './workspace-navigation.svelte.js';
	let {
		userName,
		active = 'home',
		title = 'Mon espace',
		boundedCorrection = false,
		quizRoom = false,
		parentLink,
		children
	}: {
		userName: string;
		active?: 'home' | 'classes' | 'modules' | 'grading' | 'student-view' | 'applications' | 'account';
		title?: string;
		boundedCorrection?: boolean;
		quizRoom?: boolean;
		parentLink?: { href: string; label: string };
		children: Snippet;
	} = $props();
	const navigation = useWorkspaceNavigation();
	const restoreSidebarFocus = async (open: boolean) => {
		if (open) return;
		const current = document.activeElement;
		if (
			document.querySelector('[data-slot="sidebar-container"]')?.contains(current) ||
			document.getElementById('sidebar-account-menu')?.contains(current)
		) {
			await tick();
			Array.from(document.querySelectorAll<HTMLElement>('[data-sidebar="trigger"]'))
				.find((trigger) => trigger.getClientRects().length > 0)
				?.focus();
		}
	};
</script>

<a href="#workspace-content" class="skip-link">Aller au contenu principal</a>
<Sidebar.Provider
	bind:open={navigation.sidebarOpen}
	style="--sidebar-width: 13.5rem;"
	class="min-h-dvh"
	onOpenChange={restoreSidebarFocus}
>
	<TeacherNavigation {userName} {active} />
	<Sidebar.Inset element="div" class="min-w-0 md:overflow-clip">
		<TeacherHeader {title} {parentLink} class={quizRoom ? 'xl:hidden' : undefined} />
		<main
			id="workspace-content"
			data-bounded-correction={boundedCorrection}
			tabindex="-1"
			class={cn(
				'workspace-body mx-auto w-full max-w-[100rem] px-4 pt-6 pb-10 sm:px-7 sm:pt-8 xl:px-10',
				quizRoom && 'xl:px-0 xl:pt-0 xl:pb-0'
			)}
		>
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>

<style>
	:global(html:has(.teacher-header)) {
		scroll-padding-block-start: 4.75rem;
	}
	@media (max-width: 767px) {
		:global(html:has(.teacher-header)) {
			/* Leave focused fields and anchor targets below the compact navigation header. */
			scroll-padding-block-start: calc(3.25rem + env(safe-area-inset-top, 0px) + 0.75rem);
		}
	}
	@media (min-width: 80rem) and (min-height: 36rem) {
		#workspace-content[data-bounded-correction='true'] {
			/* The editor height already reserves the sidebar inset's bottom margin. */
			padding-bottom: 0;
		}
	}
</style>
