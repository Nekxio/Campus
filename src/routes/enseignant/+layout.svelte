<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import TeacherWorkspace from '#lib/components/teaching/TeacherWorkspace.svelte';
	let { data, children }: LayoutProps = $props();
	const active = $derived(
		page.url.pathname.startsWith('/enseignant/notation') ||
			page.url.pathname.startsWith('/enseignant/propositions')
			? 'grading'
			: page.url.pathname.startsWith('/enseignant/classes')
				? 'classes'
				: 'modules'
	);
	const annual = $derived(page.route.id === '/enseignant/classes/annees');
	const boundedCorrection = $derived(
		page.route.id === '/enseignant/notation/[contextId]/[studentId]' ||
			page.route.id === '/enseignant/propositions'
	);
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>
<TeacherWorkspace
	userName={data.user.name}
	{active}
	{boundedCorrection}
	parentLink={annual ? { href: resolve('/enseignant/classes'), label: 'Mes classes' } : undefined}
	title={annual
		? 'Fin d’année'
		: active === 'grading'
			? 'Notation'
			: active === 'classes'
				? 'Classes'
				: 'Modules'}
>
	{@render children()}
</TeacherWorkspace>
