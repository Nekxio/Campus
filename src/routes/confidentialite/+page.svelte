<script lang="ts">
	import LegalPage from '#lib/components/legal/LegalPage.svelte';
	import { legalIdentity } from '#lib/legal.js';
	const sections = [
		{ id: 'responsabilites', title: 'Gestion des données et contact' },
		{ id: 'origine', title: 'Origine des données' },
		{ id: 'traitements', title: 'Données, finalités et bases juridiques' },
		{ id: 'authentification', title: 'Compte enseignant et authentification' },
		{ id: 'obligatoire', title: 'Données nécessaires ou facultatives' },
		{ id: 'destinataires', title: 'Destinataires des données' },
		{ id: 'transferts', title: 'Localisation des données et transferts internationaux' },
		{ id: 'conservation', title: 'Durées de conservation' },
		{ id: 'cookies', title: 'Cookies et stockage local' },
		{ id: 'droits', title: 'Vos droits' }
	];
	const processing = [
		{
			title: 'Classes et identification',
			data: ['Prénom et nom, classe, année scolaire.'],
			purpose: 'Identifier les étudiants et organiser les activités pédagogiques.',
			legalBasis:
				'Intérêt légitime de l’enseignant à identifier les étudiants de ses classes et à organiser les activités pédagogiques dans le cadre de ses cours (article 6, paragraphe 1, point f du RGPD).'
		},
		{
			title: 'Évaluations et commentaires privés',
			data: [
				'Critères et points, notes, statut d’évaluation ou d’absence.',
				'Dates et liens de remise, décisions de retard, commentaires de semestre et propositions de correction.'
			],
			purpose:
				'Organiser les classes, suivre les remises, évaluer les travaux et transmettre les résultats finaux au service pédagogique de MyDigitalSchool Lille par PDF.',
			legalBasis:
				'Intérêt légitime de l’enseignant à assurer le suivi pédagogique, évaluer les travaux et transmettre les résultats à l’établissement (article 6, paragraphe 1, point f du RGPD).'
		},
		{
			title: 'Quiz en direct',
			data: [
				'Identifiant de participation, nom choisi dans la liste, réponses et points.',
				'Connexion et présence, heures de démarrage et de remise, délais et prolongations.'
			],
			purpose: 'Enregistrer les participations, les réponses et les résultats et conduire les quiz.',
			legalBasis:
				'Intérêt légitime de l’enseignant à organiser les quiz en présentiel, enregistrer les réponses et établir les résultats des participants (article 6, paragraphe 1, point f du RGPD).'
		},
		{
			title: 'Événements de navigation des quiz',
			data: ['Nombre de sorties du mode plein écran et de pertes de focus de la fenêtre.'],
			purpose:
				'Mettre ces indicateurs à disposition de l’enseignant pour les examiner avec l’étudiant, sans pénalité automatique sur la note.',
			legalBasis:
				'Intérêt légitime de l’enseignant à veiller au respect des consignes des quiz en présentiel, au moyen d’indicateurs limités de navigation examinés avec l’étudiant, sans décision ni pénalité automatique (article 6, paragraphe 1, point f du RGPD).'
		},
		{
			title: 'Accès au compte enseignant',
			data: ['Identité du compte, clé d’accès et données de session.'],
			purpose: 'Authentifier l’enseignant et protéger l’accès à l’espace privé.',
			legalBasis:
				'Intérêt légitime de l’éditeur à sécuriser l’accès à l’espace privé (article 6, paragraphe 1, point f du RGPD).'
		},
		{
			title: 'Consultation des cours et fonctionnement du site',
			data: ['Requêtes réseau, adresse IP, informations du navigateur et préférences d’interface.'],
			purpose: 'Afficher les pages demandées, assurer leur sécurité et mémoriser les préférences d’interface.',
			legalBasis:
				'Intérêt légitime de l’éditeur à mettre les cours à disposition, assurer le fonctionnement et la sécurité du site et respecter les préférences d’interface (article 6, paragraphe 1, point f du RGPD).'
		}
	];
	const retention = [
		{
			category: 'Listes de classe, évaluations, commentaires et propositions de correction',
			criterion:
				'Un an au maximum, du 1er septembre au 1er septembre suivant, date limite d’effacement sans prolongation.'
		},
		{
			category: 'Participations, réponses, résultats et événements de navigation des quiz',
			criterion:
				'Même échéance annuelle : effacement au plus tard le 1er septembre suivant, y compris dans les salles de quiz.'
		},
		{
			category: 'Compte enseignant',
			criterion:
				'Les données du compte enseignant sont conservées pendant la période d’utilisation du service. Elles sont supprimées lors de l’arrêt définitif de Campus, sous réserve des éventuelles obligations légales de conservation applicables.'
		},
		{
			category: 'Journaux techniques de requêtes Cloudflare',
			criterion: '3 jours dans l’offre gratuite utilisée.'
		},
		{
			category: 'Traces techniques de fonctionnement Cloudflare',
			criterion: '7 jours.'
		}
	];
	const storage = [
		{
			name: 'coursely_quiz (cookie)',
			purpose: 'Retrouver la participation dans une salle sans compte étudiant.',
			duration: '8 heures.'
		},
		{
			name: 'mode-watcher-mode et mode-watcher-theme (localStorage)',
			purpose: 'Mémoriser le thème et le choix clair, sombre ou système.',
			duration: 'Sans expiration automatique, jusqu’à leur effacement dans le navigateur.'
		}
	];
</script>

<LegalPage
	title="Politique de confidentialité"
	description="Les données personnelles des étudiants et visiteurs de Campus, leurs finalités, leurs destinataires et vos droits."
	{sections}
>
	<section id="responsabilites">
		<h2>Gestion des données et contact</h2>
		<p>Cette politique concerne les données personnelles des étudiants, de l’enseignant et des visiteurs de Campus.</p>
		<p>
			{legalIdentity.publisher} administre Campus, est responsable des traitements techniques dont il détermine les finalités
			et les moyens essentiels, et est votre interlocuteur pour toute question relative aux données personnelles ou pour exercer
			vos droits :
			<a href={`mailto:${legalIdentity.email}`}>{legalIdentity.email}</a>.
		</p>
		<p>
			Les traitements pédagogiques comprennent des évaluations dont certains résultats contribuent aux notes officielles
			des étudiants.
		</p>
		<p>
			Les étudiants accèdent aux cours et quiz par lien, sans compte. Le service pédagogique de MyDigitalSchool Lille
			reçoit les PDF de résultats transmis par l’enseignant et gère séparément ses propres dossiers.
		</p>
	</section>
	<section id="origine">
		<h2>Origine des données</h2>
		<p>
			Les noms et prénoms proviennent des listes de classe fournies à l’enseignant par MyDigitalSchool Lille, puis
			saisies dans Campus. Les réponses et événements des quiz proviennent du navigateur de l’étudiant. Les notes et
			commentaires sont gérés par l’enseignant ; les points des quiz sont calculés à partir des réponses enregistrées.
		</p>
		<p>Les données techniques de connexion sont transmises par le navigateur.</p>
	</section>
	<section id="traitements">
		<h2>Données, finalités et bases juridiques</h2>
		{#each processing as item (item.title)}
			<div class="processing-item">
				<h3>{item.title}</h3>
				<dl class="legal-facts">
					<div>
						<dt>Données</dt>
						<dd>
							<ul>
								{#each item.data as detail (detail)}<li>{detail}</li>{/each}
							</ul>
						</dd>
					</div>
					<div>
						<dt>Finalité</dt>
						<dd>{item.purpose}</dd>
					</div>
					<div>
						<dt>Base juridique</dt>
						<dd>
							{item.legalBasis ?? '[À COMPLÉTER] Base juridique de ce traitement à confirmer.'}
						</dd>
					</div>
				</dl>
			</div>
		{/each}
		<p>
			Les données relatives aux classes, aux quiz et aux évaluations servent à identifier les participants, organiser
			les activités pédagogiques, enregistrer les réponses et les résultats et permettre leur consultation par
			l’enseignant. Certains résultats sont utilisés dans le cadre de l’évaluation des étudiants et contribuent à leurs
			notes officielles.
		</p>
		<p>
			Les points des quiz sont calculés automatiquement à partir des réponses et du barème. L’enseignant a accès aux
			réponses et aux résultats. Campus n’enregistre ni l’écran, ni le microphone, ni la caméra.
		</p>
	</section>
	<section id="authentification">
		<h2>Compte enseignant et authentification</h2>
		<p>Campus dispose d’un seul compte enseignant, protégé par une clé d’accès.</p>
		<p>
			Les données nécessaires à l’identification du compte, à la gestion des clés d’accès et aux sessions de connexion
			sont traitées pour permettre l’accès au service et protéger l’espace privé de l’enseignant.
		</p>
		<p>
			La durée de validité d’une session de connexion est de huit heures. Cette durée ne correspond pas à la durée de
			conservation des données du compte enseignant.
		</p>
	</section>
	<section id="obligatoire">
		<h2>Données nécessaires ou facultatives</h2>
		<p>Les quiz organisés dans Campus font partie des évaluations obligatoires des cours.</p>
		<p>
			La consultation des cours publiés ne nécessite pas de compte étudiant. Une participation à un quiz nécessite
			l’identifiant associé au nom figurant dans la liste de classe ; sans cet identifiant, la participation ne peut pas
			être enregistrée. Les questions peuvent être laissées sans réponse.
		</p>
	</section>
	<section id="destinataires">
		<h2>Destinataires des données</h2>
		<p>
			Les données personnelles sont accessibles aux personnes et prestataires intervenant dans les traitements décrits
			dans la présente politique, dans la limite de leurs attributions respectives.
		</p>
		<p>
			L’espace enseignant contient les notes, corrections et commentaires privés. Ces données ne figurent pas dans les
			cours publiés. Toute personne disposant du lien d’une salle de quiz peut voir les noms encore disponibles pour y
			participer.
		</p>
		<ul>
			<li>
				<strong>L’enseignant</strong> : accès aux listes de classe, évaluations, commentaires et données des quiz dans l’espace
				privé.
			</li>
			<li>
				<strong>Le service pédagogique de MyDigitalSchool Lille</strong> : résultats finaux transmis par l’enseignant sous
				forme de PDF.
			</li>
			<li>
				<strong>Cloudflare</strong> : traitement des requêtes de consultation et de connexion ; hébergement des participations,
				réponses, résultats et événements de navigation des salles de quiz.
			</li>
			<li>
				<strong>Turso</strong> : stockage des classes, évaluations, commentaires et propositions de correction.
			</li>
		</ul>
		<h3 id="assistants-ia">Applications connectées</h3>
		<p>
			La compatibilité du service avec des applications externes ne signifie pas que des données personnelles leur sont
			automatiquement transmises.
		</p>
		<p>
			Les applications connectées par l’enseignant accèdent aux données correspondant aux autorisations accordées.
			L’accès aux listes de classe et aux données de correction nécessite des autorisations spécifiques, distinctes de
			l’accès aux contenus pédagogiques.
		</p>
		<p id="corrections-ia">
			Lorsqu’un accès à la correction est accordé, l’application connectée peut recevoir la liste de la classe et les
			résultats, points et commentaires privés de l’étudiant sélectionné afin de proposer des points ou un commentaire.
			Ces propositions sont enregistrées dans Campus ; leur application nécessite une décision de l’enseignant.
		</p>
		<h3>Ressources externes</h3>
		<p>
			Google Drive et les autres sites de ressources sont contactés à l’ouverture de leurs liens, selon leurs propres
			conditions. Ces ressources ne sont pas intégrées dans les pages de Campus.
		</p>
	</section>
	<section id="transferts">
		<h2>Localisation des données et transferts internationaux</h2>
		<p>
			La région choisie pour la base de données principale Turso est l’Irlande. L’application et les données des salles
			de quiz sont hébergées par Cloudflare, dont l’infrastructure est mondiale.
		</p>
		<p>
			L’<a href="https://www.cloudflare.com/cloudflare-customer-dpa/">accord de traitement de Cloudflare</a> décrit les mécanismes
			applicables aux transferts hors de l’Espace économique européen : le cadre de protection des données UE–États-Unis et
			les clauses contractuelles types de la Commission européenne, selon le transfert concerné. Le texte de ces garanties
			est accessible dans cet accord.
		</p>
		<p>
			Les informations publiées par Turso sur le traitement des données figurent dans ses
			<a href="https://trust.turso.tech/">documents de confiance</a>.
		</p>
	</section>
	<section id="conservation">
		<h2>Durées de conservation</h2>
		<p>
			Les données étudiantes sont conservées pendant un an au maximum, du 1er septembre au 1er septembre suivant.
			{legalIdentity.publisher} les supprime au plus tard à cette échéance, sans prolongation, au moyen de l’opération d’effacement
			de l’année concernée. Cette suppression est déclenchée manuellement ; l’archivage seul ne supprime pas les données.
		</p>
		<table class="retention-table">
			<caption class="sr-only">Conservation des données personnelles traitées par Campus</caption>
			<thead>
				<tr><th scope="col">Catégorie</th><th scope="col">Durée ou critère</th></tr>
			</thead>
			<tbody>
				{#each retention as item (item.category)}
					<tr><th scope="row">{item.category}</th><td>{item.criterion}</td></tr>
				{/each}
			</tbody>
		</table>
		<p>
			Les durées techniques correspondent à la conservation documentée par Cloudflare pour les
			<a href="https://developers.cloudflare.com/workers/observability/logs/workers-logs/">journaux de requêtes</a>
			et les
			<a href="https://developers.cloudflare.com/observability/traces/workers-tracing/">traces de fonctionnement</a>.
			Les durées du stockage dans le navigateur figurent dans la rubrique suivante.
		</p>
		<p>
			L’effacement dans Campus ne supprime pas les PDF transmis ni les documents des services externes. Ces copies sont
			gérées séparément par leurs détenteurs.
		</p>
	</section>
	<section id="cookies">
		<h2>Cookies et stockage local</h2>
		<p>
			Pour les étudiants et les visiteurs, le stockage du navigateur sert à retrouver une participation à un quiz et à
			mémoriser le choix de thème. Ces traceurs de participation et de personnalisation de l’interface sont exemptés de
			consentement préalable.
		</p>
		<dl class="storage-list">
			{#each storage as item (item.name)}
				<div>
					<dt><code>{item.name}</code></dt>
					<dd class="storage-purpose">{item.purpose}</dd>
					<dd class="storage-duration"><strong>Durée :</strong> {item.duration}</dd>
				</div>
			{/each}
		</dl>
		<p>
			L’effacement de ces données dans les réglages du navigateur supprime les préférences enregistrées et peut empêcher
			de retrouver la participation au quiz.
		</p>
	</section>
	<section id="droits">
		<h2>Vos droits</h2>
		<p>
			Conformément à la réglementation applicable, vous disposez notamment d’un droit d’accès, de rectification,
			d’effacement et de limitation du traitement de vos données.
		</p>
		<p>
			Selon la nature et la base juridique du traitement, vous pouvez également bénéficier d’un droit d’opposition et
			d’un droit à la portabilité de vos données. La portabilité concerne les données fournies par la personne et
			traitées par des moyens automatisés sur le fondement du consentement ou d’un contrat.
		</p>
		<p>
			Pour exercer vos droits ou poser une question relative à vos données personnelles :
			<a href={`mailto:${legalIdentity.email}`}>{legalIdentity.email}</a>. Une justification d’identité proportionnée ne
			sera demandée qu’en cas de doute raisonnable sur l’identité du demandeur.
		</p>
		<p>
			Une réponse doit être apportée en principe sous un mois ; une prolongation justifiée est possible dans les
			conditions du RGPD, avec information dans ce premier mois. Une demande concernant les dossiers ou copies détenus
			par l’établissement devra aussi être orientée vers son responsable compétent.
		</p>
		<p>
			Vous pouvez introduire une réclamation auprès de la <a href="https://www.cnil.fr/fr/adresser-une-plainte">CNIL</a> si
			vous estimez que vos droits ne sont pas respectés. Les mineurs peuvent être accompagnés par leurs représentants, en
			tenant compte de leur âge et de leur situation.
		</p>
	</section>
</LegalPage>

<style>
	.retention-table {
		width: 100%;
		margin-block: 1.5rem;
		border-collapse: collapse;
		table-layout: fixed;
		text-align: left;
	}
	.retention-table th,
	.retention-table td {
		padding: 1rem 0.75rem;
		border-block: 1px solid var(--border);
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	.retention-table th {
		font-weight: 500;
	}
	.retention-table th:first-child {
		width: 50%;
		padding-left: 0;
	}
	.retention-table td:last-child,
	.retention-table th:last-child {
		padding-right: 0;
	}
</style>
