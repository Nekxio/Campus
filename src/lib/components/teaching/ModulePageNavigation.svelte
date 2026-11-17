<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TableIcon from '@lucide/svelte/icons/table-2';
	import { gradingSelectionQuery } from '#lib/domain/grading-selection.js';

	type ModulePage = 'module' | 'quiz' | 'rubric' | 'grading' | 'publication';
	let {
		moduleId,
		moduleTitle,
		currentPage,
		classId,
		contextId,
		academicYear,
		studentId,
		returnSection,
		rubricReturn = 'module',
		disabled = false,
		children
	}: {
		moduleId: string;
		moduleTitle: string;
		currentPage: ModulePage;
		classId?: string | null;
		contextId?: string | null;
		academicYear?: string | null;
		studentId?: string | null;
		returnSection?: string | null;
		rubricReturn?: 'module' | 'notation';
		disabled?: boolean;
		children: Snippet;
	} = $props();
	const section = $derived(
		returnSection && ['information', 'preparation', 'resources', 'planning'].includes(returnSection)
			? returnSection
			: null
	);
	const scopedPath = (path: ResolvedPathname, query: URLSearchParams) =>
		`${path}${query.size ? '?' + query.toString() : ''}` as ResolvedPathname;
	const scope = $derived(gradingSelectionQuery({ academicYear, classId, contextId, section, studentId }));
	const modulePath = $derived(scopedPath(resolve('/enseignant/modules/[moduleId]', { moduleId }), scope));
	const pages = $derived.by(() => {
		const rubricQuery = new SvelteURLSearchParams(scope);
		rubricQuery.set('retour', rubricReturn);
		const gradingQuery = gradingSelectionQuery({
			moduleId,
			academicYear,
			classId,
			contextId,
			section,
			studentId
		});
		return [
			{ id: 'module', label: 'Préparer', icon: BookOpenIcon, href: modulePath },
			{
				id: 'quiz',
				label: 'Quiz',
				icon: ListChecksIcon,
				href: scopedPath(resolve('/enseignant/modules/[moduleId]/quiz', { moduleId }), scope)
			},
			{
				id: 'rubric',
				label: 'Barème',
				icon: TableIcon,
				href: scopedPath(resolve('/enseignant/modules/[moduleId]/bareme', { moduleId }), rubricQuery)
			},
			{
				id: 'grading',
				label: 'Notation',
				icon: PencilIcon,
				href: scopedPath(resolve('/enseignant/notation'), gradingQuery)
			},
			{
				id: 'publication',
				label: 'Publication',
				icon: GlobeIcon,
				href: scopedPath(resolve('/enseignant/modules/[moduleId]/publication', { moduleId }), scope)
			}
		];
	});
	const current = $derived(pages.find((item) => item.id === currentPage)!);
	let pageMenuOpen = $state(false);
	const closeWideMenu = () => {
		if (window.matchMedia('(min-width: 48rem)').matches) pageMenuOpen = false;
	};
	const choosePage = (event: MouseEvent) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		pageMenuOpen = false;
	};
</script>

<svelte:window onresize={closeWideMenu} />

<div class="module-page-navigation">
	{@render children()}
	<nav aria-label="Pages du module" class="module-page-links">
		{#each pages as item (item.id)}
			<a
				href={disabled ? undefined : item.href}
				aria-current={item.id === currentPage ? 'page' : undefined}
				aria-disabled={disabled || undefined}
				role={disabled ? 'link' : undefined}
				tabindex={disabled ? -1 : undefined}><item.icon aria-hidden="true" /><span>{item.label}</span></a
			>
		{/each}
	</nav>
	<div class="module-page-mobile">
		<Sheet.Root bind:open={pageMenuOpen}>
			<Sheet.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="outline"
						{disabled}
						class="w-full justify-between"
						aria-label="Changer de page du module"
					>
						<span class="flex items-center gap-2"><current.icon data-icon="inline-start" />{current.label}</span>
						<ChevronDownIcon data-icon="inline-end" />
					</Button>
				{/snippet}
			</Sheet.Trigger>
			<Sheet.Content side="bottom" class="max-h-[85dvh] overflow-y-auto">
				<Sheet.Header>
					<Sheet.Title>Pages du module</Sheet.Title>
					<Sheet.Description>{moduleTitle}</Sheet.Description>
				</Sheet.Header>
				<nav aria-label="Pages du module" class="module-page-choices">
					{#each pages as item (item.id)}
						<Button
							href={item.href}
							{disabled}
							variant={item.id === currentPage ? 'secondary' : 'ghost'}
							class="w-full justify-start"
							aria-current={item.id === currentPage ? 'page' : undefined}
							onclick={choosePage}
						>
							<item.icon data-icon="inline-start" />
							<span class="flex-1 text-start">{item.label}</span>
							{#if item.id === currentPage}<CheckIcon data-icon="inline-end" />{/if}
						</Button>
					{/each}
				</nav>
			</Sheet.Content>
		</Sheet.Root>
	</div>
</div>

<style>
	.module-page-navigation {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1rem;
	}
	.module-page-links {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		gap: 0 1.5rem;
		border-block-end: 1px solid var(--border);
	}
	.module-page-links a {
		display: inline-flex;
		min-width: 0;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		padding-block: 0.75rem;
		border-block-end: 2px solid transparent;
		font-size: 0.875rem;
		color: var(--muted-foreground);
		transition:
			color var(--motion-fast) var(--ease-work),
			border-color var(--motion-fast) var(--ease-work);
	}
	.module-page-links a[aria-current='page'] {
		font-weight: 600;
		color: var(--primary);
		border-block-end-color: var(--primary);
	}
	.module-page-links a:hover:not([aria-disabled='true']) {
		color: var(--foreground);
	}
	.module-page-links a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
		border-radius: var(--radius-control);
	}
	.module-page-links a[aria-disabled='true'] {
		opacity: 0.5;
	}
	.module-page-links :global(svg) {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}
	.module-page-mobile {
		display: none;
	}
	.module-page-choices {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0 1rem max(1rem, env(safe-area-inset-bottom));
	}
	@media (max-width: 47.99rem) {
		.module-page-links {
			display: none;
		}
		.module-page-mobile {
			display: block;
		}
	}
</style>
