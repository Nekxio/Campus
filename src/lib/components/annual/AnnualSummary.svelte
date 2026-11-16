<script lang="ts">
	import type { AnnualPreview } from '#lib/domain/annual.js';

	let {
		preview,
		closing,
		idPrefix = 'annual',
		title = 'Bilan de l’année'
	}: {
		preview: AnnualPreview;
		closing: boolean;
		idPrefix?: string;
		title?: string;
	} = $props();
	const preservedLessons = $derived(
		preview.preserved.lessons -
			(closing ? preview.calendarCleanup.lessons - preview.calendarCleanup.otherYearLessons : 0)
	);
</script>

<section aria-labelledby={`${idPrefix}-consequences-title`} class="annual-summary flex min-w-0 flex-col gap-4 text-sm">
	<h2 id={`${idPrefix}-consequences-title`} class="panel-title">{title}</h2>
	<p class="text-muted-foreground">
		{#if preview.status === 'purged'}
			Les données étudiantes de {preview.academicYear} ont été supprimées définitivement dans Campus. L’année ne peut plus
			être rouverte.
		{:else if closing}
			Année {preview.academicYear} · clôture manuelle, sans date minimale de conservation imposée.
		{:else}
			L’archivage retire l’année {preview.academicYear} du travail actif. Les classes, la préparation et la notation restent
			consultables en lecture seule. « Rouvrir l’année » permet de reprendre le travail tant qu’elle n’est pas clôturée.
		{/if}
	</p>
	<div class="annual-consequences grid min-w-0 gap-5 lg:grid-cols-2 lg:gap-7">
		<div class="flex min-w-0 flex-col gap-2">
			<h3 class="item-title">Données conservées</h3>
			<p class="tabular-nums">
				{preview.preserved.modules} module{preview.preserved.modules > 1 ? 's' : ''} · {preview.preserved.contexts} suivi{preview
					.preserved.contexts > 1
					? 's'
					: ''} de module, avec {preservedLessons} séance{preservedLessons > 1 ? 's' : ''} et {preview.preserved
					.deadlines} échéance{preview.preserved.deadlines > 1 ? 's' : ''}.
			</p>
			<p class="text-muted-foreground">
				Préparations de module, objectifs, sources, ressources et liens, barèmes, séances manuelles et échéances restent
				disponibles. Les accès enseignant, passkeys et agent sont conservés.
			</p>
			<p class="text-muted-foreground tabular-nums">
				{preview.preserved.publications} version{preview.preserved.publications > 1 ? 's' : ''} publiée{preview
					.preserved.publications > 1
					? 's'
					: ''} conservée{preview.preserved.publications > 1 ? 's' : ''}. Leurs dates publiées restent inchangées
				jusqu’à une nouvelle publication ou un retrait.
			</p>
			{#if !closing && preview.status !== 'purged'}<p class="text-muted-foreground">
					Les classes, étudiants, corrections, points, remises, commentaires privés et propositions sont également
					conservés. L’archivage ne fige pas une copie du barème.
				</p>{/if}
		</div>
		{#if preview.status !== 'purged'}
			<div class="flex min-w-0 flex-col gap-2">
				<h3 class="item-title">
					{closing ? 'Suppression définitive dans Campus' : 'Aucune donnée supprimée'}
				</h3>
				{#if closing}
					<p class="tabular-nums">
						{preview.removed.classes} classe{preview.removed.classes > 1 ? 's' : ''} · {preview.removed.students} étudiant{preview
							.removed.students > 1
							? 's'
							: ''} · {preview.removed.corrections} correction{preview.removed.corrections > 1
							? 's'
							: ''}/remise{preview.removed.corrections > 1 ? 's' : ''} · {preview.removed.scores} saisie{preview.removed
							.scores > 1
							? 's'
							: ''} de points · {preview.removed.comments} commentaire{preview.removed.comments > 1 ? 's' : ''} · {preview
							.removed.proposals} proposition{preview.removed.proposals > 1 ? 's' : ''} · {preview.removed.decisions} reçu{preview
							.removed.decisions > 1
							? 's'
							: ''} de décision.
					</p>
					<ul class="flex flex-col gap-1 text-muted-foreground">
						{#each preview.classes as item (item.id)}<li class="wrap-anywhere">
								{item.name} · {item.studentCount} étudiant{item.studentCount > 1 ? 's' : ''}
							</li>{/each}
					</ul>
					<p class="text-muted-foreground">
						Les décisions de retard et le suivi privé de cette année seront aussi supprimés. Chaque module sera repris
						dans une promotion vide ou mis de côté ; ses liens publics dépendront de ce choix.
					</p>
					<p class="text-muted-foreground tabular-nums">
						<strong class="font-medium text-foreground"
							>Calendrier iCalendar : toutes les années sont concernées.</strong
						>
						{preview.calendarCleanup.lessons} séance{preview.calendarCleanup.lessons > 1 ? 's' : ''} importée{preview
							.calendarCleanup.lessons > 1
							? 's'
							: ''}
						et leur préparation seront supprimées, dont {preview.calendarCleanup.otherYearLessons} d’une autre année. Le lien,
						l’aperçu et les associations seront effacés ; la synchronisation sera arrêtée. Il faudra connecter le nouveau
						lien pour l’année suivante.
					</p>
				{:else}<p class="text-muted-foreground">
						L’archivage est réversible. Les données annuelles restent dans Campus et les PDF éligibles restent
						téléchargeables depuis l’historique.
					</p>{/if}
			</div>
		{/if}
	</div>
	<div class="flex min-w-0 flex-col gap-2">
		<h3 class="item-title">
			{closing && preview.status !== 'purged' ? 'PDF nécessaires à conserver' : 'Exports et fichiers externes'}
		</h3>
		<p class="text-muted-foreground">
			{#if preview.status === 'purged'}Les PDF ne peuvent plus être générés pour cette année.
			{:else if closing}Téléchargez et conservez les PDF nécessaires avant la clôture. Les exports incomplets restent
				bloqués ; vous devrez attester avoir conservé les PDF lors de la confirmation.
			{:else}Aucun export préalable n’est requis pour archiver. Les PDF complets peuvent être téléchargés avant ou après
				l’archivage.{/if}
		</p>
		<p class="text-muted-foreground">
			Drive et les PDF déjà conservés restent en dehors de Campus. <span class="font-medium text-foreground"
				>Un PDF ne permet pas de restaurer les corrections détaillées.</span
			>
		</p>
	</div>
</section>

<style>
	.annual-summary {
		padding-block: 1.25rem;
	}
	.annual-consequences > div {
		padding-block-start: 1rem;
		border-top: 1px solid var(--border);
	}
	.annual-summary > div:last-child {
		padding-block-start: 1rem;
		border-top: 1px solid var(--border);
	}
	.annual-summary p,
	.annual-summary li {
		line-height: 1.65;
	}
</style>
