<script lang="ts">
	import { notify } from '#lib/client/notifications.js';
	import { goto, refreshAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import BookIcon from '@lucide/svelte/icons/book-open';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import UsersIcon from '@lucide/svelte/icons/users';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { ClassesData, ClassSummary } from '#lib/teaching/types.js';
	import ClassRoster from './ClassRoster.svelte';
	import ClassDetailsDialog from './ClassDetailsDialog.svelte';
	import ClassModuleDialog from './ClassModuleDialog.svelte';
	import WorkSurface from '#lib/components/shared/WorkSurface.svelte';

	let { data }: { data: ClassesData } = $props();
	const selected = $derived(data.selected);
	let selectedId = $derived(data.selected?.id ?? '');
	let details = $state.raw<{ record: ClassSummary | null } | null>(null);
	let attachOpen = $state(false);
	let switching = $state(false);
	let refreshError = $state('');
	let refreshing = $state(false);
	let feedback = $state<HTMLDivElement | null>(null);
	async function focusFeedback() {
		notify(refreshError, 'error');
		await tick();
		feedback?.focus();
	}

	const chooseClass = async (value: string) => {
		if (!value || switching) return;
		switching = true;
		refreshError = '';
		try {
			await goto(resolve(`/enseignant/classes?classe=${encodeURIComponent(value)}`));
		} catch {
			selectedId = data.selected?.id ?? '';
			refreshError = 'Cette classe ne peut pas être chargée. Réessayez.';
			await focusFeedback();
		} finally {
			switching = false;
		}
	};

	async function saved(text: string, classId?: string) {
		notify(text);
		refreshError = '';
		refreshing = true;
		try {
			if (classId) await goto(resolve(`/enseignant/classes?classe=${encodeURIComponent(classId)}`));
			await refreshAll();
		} catch {
			refreshError =
				'La modification est enregistrée, mais la liste n’a pas pu être actualisée. Rechargez-la avant de continuer.';
			await focusFeedback();
		} finally {
			refreshing = false;
		}
	}

	async function rosterSaved(text: string) {
		await saved(text);
		return !refreshError;
	}

	async function retryRefresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await refreshAll();
			refreshError = '';
			notify('Liste actualisée.', 'info');
		} catch {
			refreshError = 'La liste ne peut pas être actualisée. Réessayez.';
			await focusFeedback();
		} finally {
			refreshing = false;
		}
	}
</script>

<div class="classes-workspace min-w-0" aria-busy={switching}>
	<div class="classes-heading flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="page-title">Mes classes</h1>
			<p class="mt-2 max-w-prose supporting-text text-muted-foreground">
				Gérez vos étudiants et les modules associés à chaque classe.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if data.classes.length}
				<Button class="min-h-11" disabled={switching || refreshing} onclick={() => (details = { record: null })}>
					<PlusIcon data-icon="inline-start" aria-hidden="true" />Nouvelle classe
				</Button>
			{/if}
			<Button href={resolve('/enseignant/classes/annees')} variant="outline" class="min-h-11">Fin d’année</Button>
		</div>
	</div>
	<div class="class-directory-layout">
		{#if data.classes.length}
			<nav class="class-directory" aria-label="Classes" inert={switching || refreshing}>
				<ul>
					{#each data.classes as record (record.id)}
						<li>
							<a
								href={resolve(`/enseignant/classes?classe=${encodeURIComponent(record.id)}`)}
								aria-current={selected?.id === record.id ? 'page' : undefined}
								onclick={(event) => {
									event.preventDefault();
									void chooseClass(record.id);
								}}><span>{record.name}</span><ChevronRightIcon aria-hidden="true" /></a
							>
						</li>
					{/each}
				</ul>
			</nav>
		{/if}
		<div class="class-detail">
			{#if data.classes.length}
				<Field.FieldGroup class="class-scope">
					<Field.Field data-disabled={switching || refreshing}>
						<Field.FieldLabel for="selected-class">Classe</Field.FieldLabel>
						<NativeSelect.Root
							id="selected-class"
							bind:value={selectedId}
							class="w-full"
							disabled={switching || refreshing}
							onchange={(event) => chooseClass(event.currentTarget.value)}
						>
							{#if !selected}<NativeSelect.Option value="" disabled>Choisir une classe</NativeSelect.Option>{/if}
							{#each data.classes as record (record.id)}<NativeSelect.Option value={record.id}
									>{record.name}</NativeSelect.Option
								>{/each}
						</NativeSelect.Root>
					</Field.Field>
				</Field.FieldGroup>
			{/if}
			<p role="status" aria-live="polite" class="mt-3 text-sm text-muted-foreground empty:mt-0">
				{switching ? 'Chargement de la classe…' : ''}
			</p>
			{#if refreshError}
				<Alert.Root class="mt-3" role="alert" bind:ref={feedback} tabindex={-1}>
					<Alert.Title>Actualisation nécessaire</Alert.Title>
					<Alert.Description
						><p>{refreshError}</p>
						<Button variant="outline" class="mt-2 min-h-11" disabled={refreshing} onclick={retryRefresh}
							>{refreshing ? 'Actualisation…' : 'Actualiser la liste'}</Button
						></Alert.Description
					>
				</Alert.Root>
			{/if}
			{#if selected}
				<div class="class-context mt-6 flex flex-wrap items-center justify-between gap-3">
					<div class="flex max-w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
						<h2 class="max-w-full section-title">
							{selected.name}
						</h2>
						<p class="text-sm text-muted-foreground">Année {selected.academicYear}</p>
					</div>
					<Button
						variant="outline"
						class="min-h-11"
						disabled={switching || refreshing}
						onclick={() => (details = { record: selected })}
					>
						<PencilIcon data-icon="inline-start" aria-hidden="true" />Modifier la classe
					</Button>
				</div>
				<nav aria-label="Sections de la classe" class="class-sections">
					<Button variant="outline" href="#class-roster">Étudiants</Button><Button
						variant="outline"
						href="#class-modules-title">Modules associés</Button
					>
				</nav>
				<div class="class-body" inert={switching || refreshing} aria-busy={refreshing}>
					<WorkSurface id="class-roster" tabindex={-1} aria-label="Étudiants de la classe" class="scroll-mt-6">
						<ClassRoster record={selected} onSaved={rosterSaved} onReload={refreshAll} />
					</WorkSurface>
					<section aria-labelledby="class-modules-title" class="modules-panel min-w-0">
						<div class="mb-2 flex items-center gap-3">
							<h3 id="class-modules-title" tabindex="-1" class="panel-title">Modules associés</h3>
							<span class="text-sm text-muted-foreground tabular-nums">{selected.modules.length}</span>
						</div>
						<p class="text-sm text-muted-foreground">Les modules suivis par cette classe.</p>
						{#if selected.modules.length}
							<ul class="mt-6 divide-y border-y">
								{#each selected.modules as module (module.id)}
									<li>
										<a
											href={resolve(`/enseignant/modules/[moduleId]?classe=${selected.id}&section=planning`, {
												moduleId: module.id
											})}
											class="flex min-h-24 items-center gap-3 rounded-sm px-3 py-4 text-sm outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/30"
										>
											<BookIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
											<div class="min-w-0 flex-1">
												<span class="block font-medium break-words">{module.title}</span><span
													class="mt-1 block text-xs text-muted-foreground">Module réutilisable</span
												>
											</div>
											<ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
										</a>
									</li>
								{/each}
							</ul>
						{:else}
							<Empty.Root class="mt-6"
								><Empty.Header
									><Empty.Title>Aucun module associé</Empty.Title><Empty.Description
										>Rattachez un module pour préparer les séances de cette classe.</Empty.Description
									></Empty.Header
								></Empty.Root
							>
						{/if}
						<Button variant="outline" class="mt-(--space-content) min-h-11 w-full" onclick={() => (attachOpen = true)}>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />Rattacher un module
						</Button>
						<p class="mt-6 text-sm leading-relaxed text-muted-foreground">
							<strong class="mb-1 block font-medium text-foreground">Une classe pour l’année.</strong>Les modules
							restent disponibles et peuvent être réutilisés avec d’autres classes.
						</p>
					</section>
				</div>
			{:else}
				<Empty.Root
					variant={data.classes.length ? 'plain' : 'surface'}
					class={data.classes.length ? 'mt-6' : undefined}
				>
					<Empty.Header
						><Empty.Media variant="icon"><UsersIcon aria-hidden="true" /></Empty.Media><Empty.Title
							>{data.classes.length ? 'Choisissez une classe' : 'Votre première classe'}</Empty.Title
						><Empty.Description
							>{data.classes.length
								? 'Utilisez le sélecteur pour retrouver les étudiants et modules de l’année.'
								: 'Créez une classe annuelle pour regrouper ses étudiants et ses modules.'}</Empty.Description
						></Empty.Header
					>
					{#if !data.classes.length}<Empty.Content
							><Button class="min-h-11" onclick={() => (details = { record: null })}>Créer une classe</Button
							></Empty.Content
						>{/if}
				</Empty.Root>
			{/if}
		</div>
	</div>
</div>

{#if details}<ClassDetailsDialog
		record={details.record}
		onClose={() => (details = null)}
		onSaved={saved}
		onReload={refreshAll}
	/>{/if}
{#if attachOpen && selected}<ClassModuleDialog
		record={selected}
		modules={data.modules}
		onClose={() => (attachOpen = false)}
		onSaved={saved}
		onReload={refreshAll}
	/>{/if}

<style>
	.class-directory-layout {
		display: grid;
		min-width: 0;
		gap: 1.5rem;
		margin-top: var(--space-sections);
	}
	.class-directory {
		display: none;
	}
	.class-detail {
		min-width: 0;
	}
	.class-directory ul {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.class-directory a {
		display: flex;
		min-height: 3rem;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem;
		border-radius: var(--radius-control);
		font-size: 0.875rem;
		transition: background-color var(--motion-fast) var(--ease-work);
	}
	.class-directory a span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.class-directory a :global(svg) {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
	}
	@media (hover: hover) and (pointer: fine) {
		.class-directory a:hover {
			background: var(--muted);
		}
	}
	.class-directory a[aria-current='page'] {
		background: var(--accent);
		color: var(--accent-foreground);
		font-weight: 600;
	}
	.class-context {
		padding-block: 0 1.5rem;
		border-block-end: 1px solid var(--border);
	}
	.class-body {
		display: grid;
		min-width: 0;
		gap: var(--space-sections);
		margin-top: 1.5rem;
	}
	.modules-panel {
		align-self: start;
		padding-block: 1.5rem;
		border-block-start: 1px solid var(--border);
	}
	.class-sections {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.classes-workspace :global([data-slot='native-select']) {
		min-height: 2.75rem;
	}
	@media (min-width: 64rem) {
		.class-directory-layout:has(.class-directory) {
			grid-template-columns: 12rem minmax(0, 1fr);
			gap: 2rem;
		}
		.class-directory {
			display: block;
			align-self: start;
			position: sticky;
			top: 5rem;
			max-height: calc(100dvh - 6rem);
			overflow-y: auto;
		}
		.classes-workspace :global(.class-scope) {
			display: none;
		}
		.class-context {
			margin-top: 0;
		}
	}
	@media (min-width: 90rem) {
		.class-body {
			grid-template-columns: minmax(0, 1.65fr) minmax(16rem, 1fr);
		}
		.modules-panel {
			padding-block: 0;
			border-block-start: 0;
		}
		.class-sections {
			display: none;
		}
	}
	@media (max-width: 39.99rem) {
		.classes-heading > div:last-child {
			width: 100%;
		}
		.classes-heading > div:last-child :global([data-slot='button']) {
			flex: 1;
		}
	}
	@media (max-width: 767px), (pointer: coarse) {
		.classes-workspace :global([data-slot='native-select']) {
			font-size: 1rem;
		}
	}
</style>
