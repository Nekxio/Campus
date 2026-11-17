<script lang="ts">
	import { resolve } from '$app/paths';
	import LegalPage from '#lib/components/legal/LegalPage.svelte';
	import { legalIdentity } from '#lib/legal.js';
	const sections = [
		{ id: 'editeur', title: 'Éditeur et publication' },
		{ id: 'hebergement', title: 'Hébergement et stockage' },
		{ id: 'contact', title: 'Contact' }
	];
</script>

<LegalPage
	title="Mentions légales"
	description="L’éditeur, les prestataires d’hébergement et le contact de Campus."
	{sections}
>
	<section id="editeur">
		<h2>Éditeur et publication</h2>
		<p>Campus est édité par {legalIdentity.publisher}.</p>
		<dl class="legal-facts">
			<div>
				<dt>Éditeur</dt>
				<dd>{legalIdentity.publisher}</dd>
			</div>
			<div>
				<dt>Statut de l’éditeur</dt>
				<dd>Personne physique, enseignant salarié.</dd>
			</div>
			<div>
				<dt>Adresse</dt>
				<dd>57 rue Pierre Mauroy, 59800 Lille</dd>
			</div>
			<div>
				<dt>Téléphone du bureau pédagogique</dt>
				<dd>+33617113619</dd>
			</div>
			<div>
				<dt>Adresse électronique</dt>
				<dd><a href={`mailto:${legalIdentity.email}`}>{legalIdentity.email}</a></dd>
			</div>
			<div>
				<dt>Directeur de la publication</dt>
				<dd>{legalIdentity.publicationDirector}</dd>
			</div>
		</dl>
	</section>
	<section id="hebergement">
		<h2>Hébergement et stockage</h2>
		<h3>Application et salles de quiz : Cloudflare</h3>
		<p>Cloudflare héberge l’application et les salles de quiz.</p>
		<dl class="legal-facts">
			<div>
				<dt>Prestataire</dt>
				<dd>Cloudflare, Inc.</dd>
			</div>
			<div>
				<dt>Adresse</dt>
				<dd>101 Townsend Street, San Francisco, CA 94107, États-Unis</dd>
			</div>
			<div>
				<dt>Téléphone</dt>
				<dd>+1 650 319 8930</dd>
			</div>
		</dl>
		<p class="legal-aside">
			<a href="https://www.cloudflare.com/privacypolicy/">Politique de confidentialité de Cloudflare</a>.
		</p>
		<h3>Stockage des données : Turso</h3>
		<p>
			Le stockage des données de l’application est assuré par le service Turso. Les traitements de données sont
			présentés dans la <a href={resolve('/confidentialite')}>politique de confidentialité</a>.
		</p>
		<dl class="legal-facts">
			<div>
				<dt>Entité indiquée dans les conditions du service</dt>
				<dd>CHISELSTRIKE INC. (service Turso)</dd>
			</div>
			<div>
				<dt>Adresse indiquée dans les conditions du service</dt>
				<dd>2093 Philadelphia Pike #6336, Claymont, DE 19703, États-Unis</dd>
			</div>
		</dl>
		<p class="legal-aside">
			Source : <a href="https://turso.tech/terms-of-use">conditions d’utilisation de Turso</a>.
		</p>
	</section>
	<section id="contact">
		<h2>Contact</h2>
		<p class="legal-note legal-contact">
			Pour une question sur l’application, un contenu ou l’exercice de vos droits :
			<a href={`mailto:${legalIdentity.email}`}>{legalIdentity.email}</a>.
		</p>
		<p>
			Les traitements et droits associés sont détaillés dans la <a href={resolve('/confidentialite')}
				>politique de confidentialité</a
			>. Les règles d’accès figurent dans les
			<a href={resolve('/conditions-utilisation')}>conditions d’utilisation</a>.
		</p>
	</section>
</LegalPage>
