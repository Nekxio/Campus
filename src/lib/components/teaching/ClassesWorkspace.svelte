<script lang="ts">
	import { goto, refreshAll } from '$app/navigation';
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

	let { data }: { data: ClassesData } = $props();
	const selected = $derived(data.selected);
	let selectedId = $derived(data.selected?.id ?? '');
	let details = $state.raw<{ record: ClassSummary | null } | null>(null);
	let attachOpen = $state(false);
	let switching = $state(false);
	let message = $state('');
	let refreshError = $state('');
	let refreshing = $state(false);

	async function chooseClass(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (!value || switching) return;
		switching = true;
		message = '';
		refreshError = '';
		try {
			await goto(resolve(`/enseignant/classes?classe=${encodeURIComponent(value)}`));
		} catch {
			selectedId = data.selected?.id ?? '';
			refreshError = 'Cette classe ne peut pas être chargée. Réessayez.';
		} finally {
			switching = false;
		}
	}

	async function saved(text: string, classId?: string) {
		message = text;
		refreshError = '';
		refreshing = true;
		try {
			if (classId) await goto(resolve(`/enseignant/classes?classe=${encodeURIComponent(classId)}`));
			await refreshAll();
		} catch {
			refreshError =
				'La modification est enregistrée, mais la liste n’a pas pu être actualisée. Rechargez-la avant de continuer.';
		} finally {
			refreshing = false;
		}
	}

	async function retryRefresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await refreshAll();
			refreshError = '';
		} catch {
			refreshError = 'La liste ne peut pas être actualisée. Réessayez.';
		} finally {
			refreshing = false;
		}
	}
</script>

<div class="classes-workspace min-w-0" aria-busy={switching}>
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Mes classes</h1>
			<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
				Gérez vos étudiants et les modules associés à chaque classe.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button
				class="min-h-11"
				disabled={switching || refreshing}
				onclick={() => (details = { record: null })}
			>
				<PlusIcon data-icon="inline-start" aria-hidden="true" />Nouvelle classe
			</Button>
			<Button href={resolve('/enseignant/classes/annees')} variant="outline" class="min-h-11"
				>Fin d’année</Button
			>
		</div>
	</div>
	{#if data.classes.length}
		<Field.FieldGroup class="mt-5 sm:max-w-xs">
			<Field.Field data-disabled={switching || refreshing}>
				<Field.FieldLabel for="selected-class">Classe et année</Field.FieldLabel>
				<NativeSelect.Root
					id="selected-class"
					bind:value={selectedId}
					class="w-full"
					disabled={switching || refreshing}
					onchange={chooseClass}
				>
					{#if !selected}<NativeSelect.Option value="" disabled
							>Choisir une classe</NativeSelect.Option
						>{/if}
					{#each data.classes as record (record.id)}<NativeSelect.Option value={record.id}
							>{record.name} · {record.academicYear}</NativeSelect.Option
						>{/each}
				</NativeSelect.Root>
			</Field.Field>
		</Field.FieldGroup>
	{/if}
	<p role="status" aria-live="polite" class="mt-3 text-sm text-muted-foreground">
		{switching ? 'Chargement de la classe…' : message}
	</p>
	{#if refreshError}
		<Alert.Root class="mt-3" role="alert">
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
		<div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
			<div class="flex max-w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
				<h2 class="max-w-full text-2xl font-semibold tracking-tight wrap-anywhere">
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
		<nav aria-label="Sections de la classe" class="mt-4 flex flex-wrap gap-2 lg:hidden">
			<Button variant="outline" href="#class-roster">Étudiants</Button><Button
				variant="outline"
				href="#class-modules-title">Modules associés</Button
			>
		</nav>
		<div
			class="mt-5 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]"
			inert={switching || refreshing}
			aria-busy={refreshing}
		>
			<section
				id="class-roster"
				tabindex="-1"
				aria-label="Étudiants de la classe"
				class="min-w-0 scroll-mt-6"
			>
				<ClassRoster record={selected} onSaved={saved} onReload={refreshAll} />
			</section>
			<section
				aria-labelledby="class-modules-title"
				class="min-w-0 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7"
			>
				<div class="mb-1 flex items-center gap-2.5">
					<h3 id="class-modules-title" tabindex="-1" class="text-lg font-semibold tracking-tight">
						Modules associés
					</h3>
					<span class="text-sm text-muted-foreground tabular-nums">{selected.modules.length}</span>
				</div>
				<p class="text-sm text-muted-foreground">Les modules suivis par cette classe.</p>
				{#if selected.modules.length}
					<ul class="mt-6 divide-y border-y">
						{#each selected.modules as module (module.id)}
							<li>
								<a
									href={resolve(
										`/enseignant/modules/[moduleId]?classe=${selected.id}&section=planning`,
										{ moduleId: module.id }
									)}
									class="flex min-h-24 items-center gap-3 rounded-sm px-3 py-4 text-sm outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/30"
								>
									<BookIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<div class="min-w-0 flex-1">
										<span class="block font-medium break-words">{module.title}</span><span
											class="mt-1 block text-xs text-muted-foreground">Module réutilisable</span
										>
									</div>
									<ChevronRightIcon
										class="size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<Empty.Root class="mt-6 border px-4 py-8"
						><Empty.Header
							><Empty.Title>Aucun module associé</Empty.Title><Empty.Description
								>Rattachez un module pour préparer les séances de cette classe.</Empty.Description
							></Empty.Header
						></Empty.Root
					>
				{/if}
				<Button variant="outline" class="mt-5 min-h-11 w-full" onclick={() => (attachOpen = true)}>
					<PlusIcon data-icon="inline-start" aria-hidden="true" />Rattacher un module
				</Button>
				<p class="mt-5 text-sm leading-relaxed text-muted-foreground">
					<strong class="mb-1 block font-medium text-foreground">Une classe pour l’année.</strong
					>Les modules restent disponibles et peuvent être réutilisés avec d’autres classes.
				</p>
			</section>
		</div>
	{:else}
		<Empty.Root class="mt-6 border px-5 py-12">
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
					><Button class="min-h-11" onclick={() => (details = { record: null })}
						>Créer une classe</Button
					></Empty.Content
				>{/if}
		</Empty.Root>
	{/if}
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
	.classes-workspace :global([data-slot='native-select']) {
		min-height: 2.75rem;
	}
	@media (max-width: 767px), (pointer: coarse) {
		.classes-workspace :global([data-slot='native-select']) {
			font-size: 1rem;
		}
	}
</style>
