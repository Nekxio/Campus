<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BookIcon from '@lucide/svelte/icons/book-open';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { HomeData } from '#lib/teaching/types.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import TeacherWorkspace from '#lib/components/teaching/TeacherWorkspace.svelte';
	let { userName, data }: { userName: string; data: HomeData } = $props();
	let query = $state('');
	const visible = $derived(
		data.modules.filter((v) =>
			v.title.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr'))
		)
	);
</script>

<TeacherWorkspace {userName}>
	<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Mon accueil</h1>
	<p class="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
		Préparer la prochaine intervention et retrouver les modules en cours.
	</p>
	<section
		aria-label="Prochaine intervention"
		class="grid gap-8 border-b pt-9 pb-10 lg:grid-cols-[1.2fr_1fr] lg:gap-10"
	>
		{#if data.nextLesson}
			<div>
				<p class="flex items-center gap-2 text-sm text-muted-foreground">
					<CalendarIcon class="size-4" aria-hidden="true" /><time
						datetime={data.nextLesson.startsAt}>{formatLessonDate(data.nextLesson.startsAt)}</time
					>
				</p>
				<h2 class="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
					{data.nextLesson.moduleTitle}
				</h2>
				<p class="mt-3 text-sm text-muted-foreground">
					{data.nextLesson.className} · {data.nextLesson.academicYear.replace('-', '–')}
				</p>
				<p class="mt-2 text-sm text-muted-foreground">{data.nextLesson.title}</p>
				<div class="mt-6 flex flex-wrap gap-3">
					<Button size="lg" href={`/enseignant/modules/${data.nextLesson.moduleId}`}
						>Ouvrir la préparation<ArrowRightIcon
							data-icon="inline-end"
							aria-hidden="true"
						/></Button
					><Button size="lg" variant="outline" href="/enseignant/classes">Voir les classes</Button>
				</div>
			</div>
		{:else}
			<div>
				<p class="flex items-center gap-2 text-sm text-muted-foreground">
					<CalendarIcon class="size-4" aria-hidden="true" />Prochaine intervention
				</p>
				<h2 class="mt-5 text-2xl font-semibold tracking-tight">Aucune séance à venir</h2>
				<p class="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
					Renseignez les dates dans « Classes et planning » d’un module pour retrouver ici la
					prochaine séance.
				</p>
				<Button class="mt-6" variant="outline" href="/enseignant/modules/nouveau"
					>Créer un module</Button
				>
			</div>
		{/if}
		<div class="lg:border-l lg:pl-9">
			<h3 class="mb-2 text-base font-semibold">Préparation du module</h3>
			<p class="text-sm leading-relaxed text-muted-foreground">
				Les objectifs, le cadrage, les références locales et les liens sélectionnés restent réunis
				dans la fiche du module.
			</p>
			<dl class="mt-4 text-sm">
				<div class="flex min-h-14 items-center justify-between gap-3 border-b">
					<dt>Modules</dt>
					<dd>{data.modules.length}</dd>
				</div>
				<div class="flex min-h-14 items-center justify-between gap-3">
					<dt>État de la préparation</dt>
					<dd><Badge variant="secondary">Brouillon</Badge></dd>
				</div>
			</dl>
		</div>
	</section>
	<section class="pt-9" aria-labelledby="modules">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<h2 id="modules" tabindex="-1" class="scroll-mt-6 text-xl font-semibold tracking-tight">
				Mes modules
			</h2>
			<Button href="/enseignant/modules/nouveau"
				><PlusIcon data-icon="inline-start" aria-hidden="true" />Créer un module</Button
			>
		</div>
		<div class="mt-5 mb-4 flex flex-wrap items-end justify-between gap-3">
			<Field.FieldGroup class="w-full sm:max-w-xs"
				><Field.Field
					><Field.FieldLabel for="module-search" class="sr-only"
						>Rechercher un module</Field.FieldLabel
					><Input
						id="module-search"
						type="search"
						placeholder="Rechercher un module…"
						bind:value={query}
					/></Field.Field
				></Field.FieldGroup
			>
			<p class="text-sm text-muted-foreground" role="status">
				{visible.length} module{visible.length > 1 ? 's' : ''}
			</p>
		</div>
		{#if !visible.length}<Empty.Root class="border"
				><Empty.Header
					><Empty.Media variant="icon"><BookIcon aria-hidden="true" /></Empty.Media><Empty.Title
						>{data.modules.length
							? 'Aucun module trouvé'
							: 'Votre bibliothèque est prête'}</Empty.Title
					><Empty.Description
						>{data.modules.length
							? 'Essayez un autre nom.'
							: 'Créez un premier brouillon. Il restera disponible d’une année à l’autre.'}</Empty.Description
					></Empty.Header
				><Empty.Content
					>{#if data.modules.length}<Button variant="outline" onclick={() => (query = '')}
							>Réinitialiser la recherche</Button
						>{:else}<Button href="/enseignant/modules/nouveau">Créer un module</Button
						>{/if}</Empty.Content
				></Empty.Root
			>
		{:else}<div class="hidden overflow-hidden rounded-xl border lg:block">
				<Table.Root
					><Table.Header
						><Table.Row
							><Table.Head class="pl-5">Module</Table.Head><Table.Head>Classes</Table.Head
							><Table.Head>Liens étudiants</Table.Head><Table.Head class="pr-5 text-right"
								>Préparation</Table.Head
							></Table.Row
						></Table.Header
					><Table.Body
						>{#each visible as module (module.id)}<Table.Row
								><Table.Cell class="py-3 pl-5"
									><Button
										variant="link"
										class="justify-start px-0"
										href={`/enseignant/modules/${module.id}`}>{module.title}</Button
									></Table.Cell
								><Table.Cell class="max-w-xs whitespace-normal"
									>{module.classes
										.map((v) => `${v.name} · ${v.academicYear.replace('-', '–')}`)
										.join(', ') || 'Sans classe'}</Table.Cell
								><Table.Cell
									>{module.resourceCount} lien{module.resourceCount > 1 ? 's' : ''}</Table.Cell
								><Table.Cell class="pr-5 text-right"
									><Button
										variant="ghost"
										href={`/enseignant/modules/${module.id}`}
										aria-label={`Ouvrir la préparation : ${module.title}`}
										>Ouvrir<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button
									></Table.Cell
								></Table.Row
							>{/each}</Table.Body
					></Table.Root
				>
			</div>
			<ul class="divide-y border-y lg:hidden">
				{#each visible as module (module.id)}<li class="flex flex-col gap-3 py-5">
						<h3 class="font-medium wrap-anywhere">{module.title}</h3>
						<p class="text-sm text-muted-foreground">
							{module.classes
								.map((v) => `${v.name} · ${v.academicYear.replace('-', '–')}`)
								.join(', ') || 'Sans classe'}
						</p>
						<p class="text-sm text-muted-foreground">
							{module.resourceCount} lien{module.resourceCount > 1 ? 's' : ''}
						</p>
						<Button
							variant="outline"
							class="self-start"
							href={`/enseignant/modules/${module.id}`}
							aria-label={`Ouvrir la préparation : ${module.title}`}
							>Ouvrir la préparation<ArrowRightIcon
								data-icon="inline-end"
								aria-hidden="true"
							/></Button
						>
					</li>{/each}
			</ul>{/if}
	</section>
</TeacherWorkspace>
