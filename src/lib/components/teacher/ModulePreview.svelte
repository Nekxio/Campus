<script lang="ts">
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import type { TeachingModule } from '#lib/demo/teaching.js';

	let {
		open = $bindable(false),
		module,
		mode,
		onClass
	}: {
		open?: boolean;
		module: TeachingModule;
		mode: 'preparation' | 'student' | 'classes';
		onClass: (value: string) => void;
	} = $props();
	let title = $derived(
		mode === 'classes'
			? 'Mes classes'
			: mode === 'student'
				? 'Aperçu étudiant'
				: 'Préparation du module'
	);
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="w-full overflow-y-auto sm:max-w-xl">
		<Sheet.Header class="gap-3 p-6 pb-4">
			<div class="flex items-center justify-between gap-3 pr-10">
				<Sheet.Title>{title}</Sheet.Title><Badge variant="outline">Démo</Badge>
			</div>
			<Sheet.Description
				>Contenu fictif pour explorer l’interface. Aucun élément n’est publié.</Sheet.Description
			>
		</Sheet.Header>
		<div class="flex flex-col gap-7 px-6 pb-6">
			{#if mode === 'classes'}
				{#each [{ name: 'B2', students: 12 }, { name: 'B3', students: 10 }] as group (group.name)}
					<section class="flex items-center justify-between gap-4 border-b pb-5">
						<div>
							<h3 class="font-semibold">{group.name}</h3>
							<p class="mt-1 text-sm text-muted-foreground">
								{group.students} étudiants fictifs · 2 modules
							</p>
						</div>
						<Button variant="outline" onclick={() => onClass(group.name)}>Voir les modules</Button>
					</section>
				{/each}
			{:else}
				<div>
					<h3 class="text-2xl font-semibold tracking-tight">{module.title}</h3>
					<p class="mt-2 text-muted-foreground">
						{module.className} · {module.students} étudiants fictifs
					</p>
				</div>
				<Separator />
				{#if mode === 'preparation'}
					<section>
						<h3 class="font-semibold">Prochaine intervention</h3>
						<p class="mt-2 text-muted-foreground">{module.intervention}</p>
					</section>
					<section>
						<div class="flex items-center justify-between gap-3">
							<h3 class="font-semibold">Cadrage du module</h3>
							<Badge variant="outline">Validé</Badge>
						</div>
						<p class="mt-2 leading-relaxed text-muted-foreground">
							Relier ici le cadrage validé, les objectifs et les documents de préparation existants.
						</p>
					</section>
					<section>
						<h3 class="font-semibold">Supports et consignes</h3>
						<p class="mt-2 leading-relaxed text-muted-foreground">{module.summary}</p>
						<p class="mt-3 text-sm text-muted-foreground">
							La publication sera disponible après vérification des supports.
						</p>
					</section>
				{:else}
					<section>
						<h3 class="font-semibold">Supports du cours</h3>
						<p class="mt-2 leading-relaxed text-muted-foreground">
							Un support de démonstration pour retrouver les notions abordées.
						</p>
					</section>
					<section>
						<h3 class="font-semibold">Consignes et barème</h3>
						<p class="mt-2 leading-relaxed text-muted-foreground">
							Créer une petite application web. Le barème sera présenté avec la consigne du projet.
						</p>
					</section>
					<section>
						<h3 class="font-semibold">Échéance et remise</h3>
						<p class="mt-2 leading-relaxed text-muted-foreground">
							Exemple : remise du lien vers le dépôt le 27 octobre.
						</p>
					</section>
					<section>
						<h3 class="font-semibold">Ressources utiles</h3>
						<a
							class="mt-2 inline-block underline underline-offset-4"
							href="https://svelte.dev/docs"
							target="_blank"
							rel="noreferrer">Documentation Svelte <span class="sr-only">(nouvel onglet)</span></a
						>
					</section>
					<section>
						<h3 class="font-semibold">Vu en cours / à faire</h3>
						<p class="mt-2 leading-relaxed text-muted-foreground">
							Exemple : structure du projet vue en cours. À faire : préparer les premières pages.
						</p>
					</section>
				{/if}
			{/if}
		</div>
		<Sheet.Footer class="mt-auto border-t p-6"
			><Sheet.Close>
				{#snippet child({ props })}<Button variant="outline" {...props}>Fermer l’aperçu</Button
					>{/snippet}
			</Sheet.Close></Sheet.Footer
		>
	</Sheet.Content>
</Sheet.Root>
