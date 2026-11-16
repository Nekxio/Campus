<script lang="ts">
	import { resolve } from '$app/paths';
	import LegalPage from '#lib/components/legal/LegalPage.svelte';
	const sections = [
		{ id: 'service', title: 'Objet et accès au service' },
		{ id: 'regles', title: 'Utilisation du service' },
		{ id: 'quiz', title: 'Données personnelles' },
		{ id: 'droits', title: 'Propriété intellectuelle' },
		{ id: 'fin-acces', title: 'Accès aux contenus' },
		{ id: 'disponibilite', title: 'Disponibilité' },
		{ id: 'modifications', title: 'Modifications et contact' }
	];
</script>

<LegalPage
	title="Conditions d’utilisation"
	description="Les modalités générales d’accès et d’utilisation de Campus."
	{sections}
>
	<section id="service">
		<h2>Objet et accès au service</h2>
		<p>
			Campus est une application permettant d’organiser et de gérer des activités pédagogiques, notamment des quiz et
			des évaluations. Le service est mis à disposition gratuitement, sans abonnement ni publicité. Les présentes
			conditions définissent les modalités générales d’accès et d’utilisation de Campus.
		</p>
		<p>
			Les étudiants accèdent aux cours et aux quiz par les liens transmis par l’enseignant, sans créer de compte. Les
			cours publiés sont consultables par toute personne disposant de leur lien. L’espace enseignant est réservé aux
			accès autorisés.
		</p>
	</section>
	<section id="regles">
		<h2>Utilisation du service</h2>
		<p>
			Les utilisateurs s’engagent à utiliser le service conformément à sa destination, à la réglementation applicable et
			aux droits des tiers.
		</p>
		<p>
			Toute utilisation portant atteinte à la sécurité, à l’intégrité ou au fonctionnement du service est interdite.
		</p>
	</section>
	<section id="quiz">
		<h2>Données personnelles</h2>
		<p>
			Les traitements de données personnelles réalisés dans le cadre de l’utilisation du service sont décrits dans la
			<a href={resolve('/confidentialite')}>politique de confidentialité</a>.
		</p>
	</section>
	<section id="droits">
		<h2>Propriété intellectuelle</h2>
		<p>
			Les auteurs conservent leurs droits sur les cours, ressources et travaux. Leur accès est destiné au travail
			pédagogique et n’autorise pas leur redistribution sans droit ou licence applicable. L’utilisation d’un travail
			pour l’évaluer ne transfère pas les droits de son auteur.
		</p>
		<p>
			Les ressources externes, notamment Google Drive, appliquent leurs propres règles après l’ouverture de leur lien.
		</p>
	</section>
	<section id="fin-acces">
		<h2>Accès aux contenus</h2>
		<p>L’enseignant peut fermer une salle de quiz ou retirer un cours publié.</p>
		<p>
			Un retrait de publication ou un archivage ne supprime pas les données d’évaluation. Les règles de conservation et
			de suppression sont décrites dans la
			<a href={resolve('/confidentialite#conservation')}>rubrique conservation</a>.
		</p>
	</section>
	<section id="disponibilite">
		<h2>Disponibilité</h2>
		<p>
			L’accès au service peut être temporairement interrompu, notamment en raison d’opérations de maintenance, de mises
			à jour ou d’incidents techniques.
		</p>
		<p>La disponibilité des ressources externes dépend de leurs fournisseurs.</p>
	</section>
	<section id="modifications">
		<h2>Modifications et contact</h2>
		<p>
			La date de version figure en haut de cette page. Les personnes concernées sont informées des changements
			importants des règles d’utilisation ou des traitements avant leur mise en œuvre.
		</p>
		<p>
			Le droit français s’applique, sous réserve des règles impératives applicables. Pour une question, une réclamation
			ou une difficulté d’accès : <a href={resolve('/mentions-legales#contact')}>contact de l’éditeur</a>. Les droits
			sur vos données sont décrits dans la
			<a href={resolve('/confidentialite#droits')}>politique de confidentialité</a>.
		</p>
	</section>
</LegalPage>
