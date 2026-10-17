# Plan d’intégration métier de Coursely

12 octobre 2026 — plan validé ; lots 1, 2, 3 et 4 implémentés et validés localement.
13 octobre 2026 — publication et pages étudiantes du lot 5 implémentées localement ;
vérification du partage/remplacement Drive professionnel et activation HTTPS encore à réaliser.

Coursely réunira la préparation publiée des modules et la notation privée. Les supports
restent préparés dans les conversations avec ChatGPT et les dossiers locaux. Les seuls
fichiers destinés aux étudiants seront déposés dans le Drive professionnel existant ;
Coursely conservera leurs liens. L’interface et un MCP local offriront deux entrées vers les
mêmes opérations métier.

Chaque nouvelle page ou parcours visuel fera l’objet d’un cadrage Impeccable et de
propositions de disposition, avec choix explicite du responsable produit avant son développement.
Le thème luma,
shadcn-svelte, la sidebar et la composition de l’accueil validés constituent la base.

## Avancement

Le socle de données et d’accès enseignant est implémenté : schémas Turso/Drizzle, migration
initiale, contrats Zod, fixtures fictives et Better Auth par passkey sur invitation. Le choix retenu est
le parcours vertical Impeccable pour la connexion et l’activation ; ces pages sont implémentées
et l’accueil exige une session enseignant.

Le lot 2 ajoute les classes annuelles, la liste commune d’étudiants avec import par noms collés
ou CSV et édition manuelle, ainsi que le rattachement des modules. Les modules se créent en
brouillon, avec ou sans classe, puis s’éditent dans les quatre sections retenues : informations,
préparation, liens étudiants, classes et planning. L’accueil utilise désormais les résumés des
modules et la prochaine séance stockés en base. Les choix Impeccable « Classe et modules » et
« Sections côte à côte » sont conservés dans les briefs de surface.

Les formulaires utilisent shadcn-svelte, Formsnap, Superforms et Zod. La validation client ne
remplace pas les contrôles serveur ; les révisions empêchent une fenêtre ancienne d’écraser une
modification récente. Les dates sont saisies dans le fuseau Europe/Paris et stockées en UTC.
Un adaptateur ciblé assure la compatibilité du Superforms installé avec SvelteKit 3 ; cette
adaptation et ses limites sont documentées dans le README.

La validation du lot 2 comptait 70 tests locaux ; le lint, les types et le build Workers passaient. Les parcours de création,
import, édition, calendrier et conflit entre deux fenêtres ont été vérifiés avec une base
fictive locale. Les rendus clair/sombre et mobile, ainsi que le retour du focus après fermeture
d’un formulaire, ont été contrôlés. La revue Impeccable conclut « ship » après correction de ce
retour de focus. Le serveur Workers vérifié séparément redirige les visiteurs anonymes des pages
privées vers la connexion et refuse les écritures anonymes avec HTTP 401 sans cache.

La migration `0001_lonely_gateway.sql` ajoute les objectifs et la référence au dossier source ;
elle doit être appliquée explicitement avant l’utilisation de ces écrans avec la base Turso
configurée. Aucune migration cloud, connexion au Drive, clé réelle ni donnée étudiante réelle
n’a été utilisée dans ce lot. Les contrôles HTTPS complets des passkeys, VoiceOver et appareil
réel restent à effectuer.

Le lot 3 est implémenté après les trois choix Impeccable validés : « Table de définition »
(`rubric-table`), « Grille et fiche » (`grid-split`) et « Groupe et bilan fixe »
(`correction-bottom-summary`). Les barèmes, groupes, lignes, descriptions et règles structurées
se modifient dans `/enseignant/modules/[moduleId]/bareme`, avec les échéances de chaque contexte.
`/enseignant/notation` présente les résultats et la synthèse de l’étudiant ; la correction détaillée
s’ouvre dans `/enseignant/notation/[contextId]/[studentId]`. Les quatre états, les points entiers,
les valeurs manquantes, les résultats indépendants, le formatif exclu, les retards calendaires de
Paris, les exceptions/refus et le commentaire privé séparé sont pris en charge. Les changements
conservent les points bruts et identifiants ; les lignes retirées restent dans l’historique privé.
Les enregistrements sont explicites, les erreurs gardent les saisies et un conflit de révision
renvoie HTTP 409 sans écraser le brouillon. Les services vérifient l’accès enseignant, l’origine,
l’inscription à la classe, les références d’évaluation et les révisions.

La dernière validation locale passe 105 tests dans 16 fichiers, les types Svelte/application et
scripts opérateur sans erreur ni avertissement, le formatage/lint et le build Workers. Les essais
manuels fictifs couvrent décimales refusées, désactivation/réactivation après absence, annulation
d’une sortie avec modifications, sauvegarde retrouvée au rechargement et conflit entre deux fenêtres.
Les captures couvrent 1440×900, 390×844 et 810×1224, avec compléments pleine page et sombre.
La revue Impeccable fraîche a utilisé le contrat dégradé du rôle ; elle a demandé deux corrections :
association du maximum au champ et maintien du bilan desktop avec historique ou contenu long.
Après deux séries de corrections, le verdict final « ship » porte sur ces deux points, sans seconde
revue complète ni audit indépendant du serveur ou des calculs. Les captures de groupe long et de
navigation clavier conservent le nom du résultat, son état, le compte d’éléments en attente et
l’enregistrement ; les diagnostics complets restent dans le contenu défilant. Les vingt critères
fictifs ajoutés pour cet essai ont été retirés ensuite.

Les preuves et leurs limites se trouvent dans `.impeccable/review/lot3/verification.json`,
`worker-smoke.json` et `finish-review.md`. `layout-final.json` garde la géométrie initiale ;
`fix-layout.json` et les captures finales documentent la correction du bilan. Le contrôle local
Workers redirige les pages de notation sans session et refuse un PATCH de commentaire anonyme.
La migration offline `0002_brown_unus.sql` ajoute le retrait d’évaluation et la description de ligne ;
comme `0001_lonely_gateway.sql`, elle n’a pas été appliquée à Turso. Le README et les briefs consignent
le contrôle du système luma existant ; `DESIGN.md` et son sidecar restent conservés, avec leurs
quelques descriptions historiques signalées sans refonte. Les propositions agent sont implémentées
dans le lot 4 décrit ci-dessous, et la publication dans le lot 5. Le PDF final est implémenté et contrôlé localement ; l’archivage et la purge sont implémentés et contrôlés localement ; la validation HTTPS reste à réaliser.
Aucune migration cloud, publication, connexion Drive,
donnée étudiante réelle ni mise en ligne n’a été réalisée pour le lot 3.

Le lot 4 commence par la création et la mise à jour des modules via un MCP local stdio. Cinq
outils inspectent le dossier autorisé, lisent les identifiants/révisions, lient un module existant,
créent ou mettent à jour son brouillon. Le contrat versionné utilise des clés locales stables ;
la liaison `.coursely.json` et la clé d’idempotence sont enregistrées avant la requête réseau.
Les services existants écrivent le module, son planning, le barème éventuel et le reçu dans une
transaction commune. Une reprise identique ne crée pas de doublon ; une autre écriture obsolète
renvoie HTTP 409. Un remplacement explicite du barème garde les points bruts et ne publie rien.

L’accès agent utilise le plugin Better Auth API Key 1.7.7, avec clé liée à l’enseignant,
permissions limitées, hachage, expiration et quota atomique. La clé ne devient pas une session
web ; les endpoints publics de gestion sont fermés. Le contexte d’import ne renvoie aucune
identité étudiante, note, remise, proposition ou commentaire. La migration offline
`0003_premium_tomas.sql` ajoute les clés et reçus, sans application cloud. Le guide d’usage est
`docs/module-import.md`. Le choix retenu est un dossier fictif isolé pour le premier essai ; la
configuration MCP est limitée à `data/mcp-demo`, sans accès à toute la racine des formations.

Cette partie du lot 4 passe 139 tests dans 20 fichiers, dont 34 nouveaux contrôles agent/MCP.
L’installation figée, les types, le formatage/lint et le build Workers passent. Un client MCP stdio
réel crée et met à jour un module fictif via HTTP local, puis refuse l’accès avec sa clé révoquée.
Les essais couvrent reprises, conflits, rollback atomique, identités durables et points bruts.
Une copie Worker isolée passe neuf contrôles HTTP, dont 401 pour les trois routes agent sans clé
et 403 pour la gestion publique des clés, toujours sans cache. Le démarrage enregistré inspecte
uniquement le dossier fictif choisi, sans charger de fichier privé de connexion.

Aucun nouvel écran n’est nécessaire pour cette première partie : la vérification utilise
l’éditeur existant. Cette première partie est complétée par le dépôt des propositions et leur écran de vérification décrit ci-dessous. Aucune clé réelle,
connexion Drive, migration cloud ou mise en ligne n’a été effectuée pour les imports locaux.

## Propositions de correction du lot 4

Le choix retenu est « Comparaison dans la correction » (`proposal-inline-comparison`, graine
`0e5f8508`) avant le développement. L’écran `/enseignant/propositions` reprend le contexte compact,
les groupes de critères et le bilan inférieur. Chaque ligne montre Enregistré, Proposé et Retenu ;
les entiers ajustés actualisent les calculs existants, sans formule particulière au jeu de démo.
Les points et le commentaire de semestre ont leurs propres formulaires Formsnap et décisions.

Les outils `get_correction_context` et `propose_correction` exigent une liaison au dossier et des
permissions supplémentaires explicites sur une nouvelle clé. Les anciennes clés de module gardent
leurs droits. Le contexte renvoie la liste de la seule classe choisie et, sur sélection, les résultats
et le commentaire du seul étudiant choisi. Le contrat v2 inclut les identifiants exacts, les
révisions module/contexte/correction, des points entiers ou nuls, et la révision indépendante du
commentaire s’il est proposé. Les identifiants proposition/requête sont fournis avant le dépôt et
réutilisés tels quels après une réponse perdue. La liaison locale ne reçoit aucune donnée étudiante.

Le dépôt n’écrit aucun score ni commentaire de référence. Seule une session enseignant peut
prendre une décision à même origine. La validation des points écrit les valeurs retenues de
l’évaluation et garde la remise, la décision de retard, les autres évaluations et le commentaire.
Un commentaire accepté séparément garde les points. Une absence désactive les champs et empêche
la validation de points ; l’enseignant choisit explicitement « À évaluer » ou « Noté » pour les retenir.
Les révisions devenues obsolètes bloquent la décision concernée. Actualiser conserve la saisie,
sans rendre une ancienne proposition actuelle : l’agent doit déposer une proposition réconciliée.
Le refus conserve les scores et le commentaire encore indécis ; un commentaire déjà accepté
explicitement n’est pas annulé par le refus ultérieur des points.

Chaque décision et son reçu font partie de la même transaction que l’enregistrement concerné.
Une reprise identique retourne le reçu original, sans réécrire une note corrigée entretemps.
Les reçus ne dupliquent pas les valeurs personnelles et sont supprimés avec la proposition lors
de la suppression annuelle des données concernées. La migration locale
`0004_lyrical_skullbuster.sql` conserve les anciennes propositions v1 ; elles restent consultables
et refusables, mais nécessitent un nouveau dépôt pour être acceptées. Aucune migration cloud,
clé de correction réelle ni mise en ligne n’a été faite. Guide : `docs/correction-proposals.md`.

La validation finale du lot 4 passe 174 tests dans 23 fichiers, le lint, les types et le build
Workers. Neuf contrôles du Worker local issu du code réel vérifient le refus d’accès anonyme et
l’absence de cache. Le parcours navigateur fictif vérifie points entiers, absence, navigation sale,
décisions indépendantes, conflit avec saisie conservée et refus sans modification des résultats.
La revue Impeccable indépendante valide les six vues fournies ; la documentation conserve le
système de design existant. Les essais ne constituent pas une recette passkey HTTPS réelle.

## Périmètre retenu

| Sujet       | Première version                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| Enseignant  | Connexion Better Auth par passkey, sur invitation ; préparation, classes, notation et publication privées.      |
| Étudiants   | Pages accessibles par lien public, sans comptes, notes individuelles ni dépôt de travaux.                       |
| École       | PDF complet de la grille en fin de module ; aucun compte pédagogie.                                             |
| Modules     | Contenu durable et réutilisable ; les classes et données étudiantes peuvent être purgées sans le supprimer.     |
| Classes     | Classe pour une année scolaire, liste commune d’étudiants importée par noms collés ou CSV et modifiable.        |
| Supports    | Sources éditables locales ; PDF, documents et ressources étudiants sélectionnés sur Drive, plus liens externes. |
| Création    | Manuelle ou par agent à partir du dossier local, avec brouillon et publication explicite de la page.            |
| Correction  | Points par ligne du barème, sans justification privée par ligne ; résultats seuls dans la grille générale.      |
| Commentaire | Commentaire de semestre privé par étudiant et module, préparé par l’agent ou saisi manuellement, prêt à copier. |
| Remises     | GitHub ou Teams ; Coursely conserve le lien et la date de remise.                                               |
| Données     | Coursely fait foi pour les scores, retards et commentaires ; les PDF sont des copies finales.                   |
| Hébergement | Cloudflare Workers Free, origine stable `workers.dev` pour commencer ; Turso avec Drizzle côté serveur.         |

La V1 ne prévoit ni éditeur de supports, ni chat IA intégré, ni envoi d’e-mails, ni sauvegarde
JSON réimportable. Elle n’ajoute pas Cloudinary, R2 ou une intégration Google Drive au serveur
web. Les paramètres d’un module sont repris de son cadrage validé : aucune formule ni aucune
limite de douze étudiants n’est imposée à tous les cours.

Les invitations enseignant sont à usage unique, expirent après 24 heures et sont émises
par la commande opérateur. La création de la passkey exige une vérification sur l’appareil ;
les sessions durent huit heures. Le serveur fixe les autorisations, ferme l’inscription
publique et invalide les sessions à la déconnexion ou à la révocation.

## Modules conservés et promotions supprimables

Le modèle distingue le module de son utilisation dans une classe et une année. Cela remplace
la première idée d’un module dont l’identité dépendrait définitivement d’une classe annuelle.

| Élément                   | Contenu                                                                                               | Effet de la purge annuelle                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Module                    | Identité stable, préparation, objectifs, références locales, contenus, liens, barèmes et publication. | Conservé.                                                                                                        |
| Contexte d’enseignement   | Rattachement à une classe et une année, planning et échéances de cette utilisation.                   | Rattachement actif retiré ; préparation, planning et échéances archivés avec le module, sans données étudiantes. |
| Classe annuelle           | Nom, année scolaire et liste d’étudiants.                                                             | Supprimée pour l’année sélectionnée.                                                                             |
| Étudiant                  | Identité dans la promotion, sans compte de connexion.                                                 | Supprimé avec son inscription.                                                                                   |
| Correction et commentaire | Scores, statut, remise, retard, exception, refus, commentaire de semestre et révision.                | Supprimés pour les étudiants concernés.                                                                          |
| Proposition de correction | Valeurs proposées par l’agent et état de validation.                                                  | Supprimée avec les données étudiantes concernées.                                                                |

Un nouveau contexte réutilise le contenu et le barème du module, mais commence sans notes.
Les dates de la nouvelle promotion sont renseignées ou importées explicitement ; on ne
transforme pas automatiquement des dates de l’ancienne année. La bibliothèque permet de
retrouver un module qui n’est plus associé à une classe active.

La purge cible une année et affiche les classes, étudiants et corrections concernés avant
confirmation. Elle préserve le compte enseignant, les clés d’accès, les modules, leurs
documents et leurs liens Drive. Les données personnelles éventuellement incluses dans des
propositions sont supprimées aussi ; un historique technique ne doit pas en conserver de
copie. Les PDF déjà téléchargés restent chez l’enseignant et ne permettent pas de restaurer le détail
des corrections. Les anciens liens de classes supprimées cessent de fonctionner ; les
modules publiés restent disponibles par leurs propres liens.

## Publication et pages étudiantes — lot 5

Le choix actuel est « Vérification par section » pour l’enseignant et « Un bloc à la fois » pour
les étudiants. Le module enregistré ouvre un aperçu privé pour une classe et une année précises.
Les cinq blocs utilisent le même rendu que la page publique ; Formsnap, Superforms et Zod gèrent
le contexte et la décision. Publier et dépublier restent des actions réservées à l’enseignant.
Une ancienne publication reste consultable pendant la modification du brouillon.

Les pages `/modules/[contextId]` et `/classes/[classId]` sont accessibles par lien sans compte,
à partir d’une projection versionnée et validée. Préparation privée, chemins locaux, listes
nominatives, corrections, notes et commentaires sont exclus. Les pages et erreurs ne sont pas
mises en cache et demandent l’absence d’indexation. Le lien du module demeure stable ; supprimer
une classe retire son répertoire, sans supprimer la publication durable du contexte. Les anciens
instantanés non vérifiés exigent une nouvelle publication, sans affichage du brouillon.

Les révisions et reçus transactionnels protègent la publication, les conflits et la reprise après
perte de réponse. La migration `0005_nasty_skrulls.sql` est générée hors ligne, testée localement
et non appliquée à Turso. Les supports restent des liens externes. Aucun téléversement, changement
de partage Drive, déploiement ou donnée étudiante réelle n’est inclus. La vérification sur un fichier
fictif du Drive professionnel reste à effectuer séparément. Voir `docs/publication.md`.

La validation locale du lot 5 passe 203 tests dans 27 fichiers, le lint, les types sans erreur
ni avertissement et le build Workers. Vingt et un contrôles HTTP sur la construction réelle
vérifient les protections et erreurs publiques sans secrets. Les essais fictifs couvrent publication,
dépublication, republication au même lien et conflit entre deux fenêtres.
Les compositions finales validées sont « Un bloc à la fois » (`student-tabs`) et
« Vérification par section » (`publish-sections`). Les anciens verdicts et alternatives sont
historiques. Les captures et contrôles correctifs sont conservés dans
`.impeccable/review/lot5-fidelity/`. Les vérifications locales ne constituent pas une recette
sur appareil physique, au lecteur d’écran ou sur l’origine HTTPS finale.
Les formats 1440, 1280, 810 et 390 px, les thèmes clair/sombre et les états vides/erreur sont
consignés dans `.impeccable/review/lot5/`. Les types de rôles nommés étant indisponibles,
un agent générique a adopté le contrat complet de revue fourni par le skill. Les vérifications
sur appareil réel/lecteur d’écran et l’activation cloud restent hors de cette validation locale.

La vue étudiante reconfirmée est maintenant implémentée avec cinq onglets shadcn-svelte,
un seul panneau visible et les références d’échéance/projet conservées. L’aperçu enseignant garde
ses cinq sections. La revue Impeccable fraîche conclut « ship » sur les surfaces et treize captures
fournies ; types, lint, 203 tests et build passent. La documentation du système visuel est conservée.
Les preuves sont dans `.impeccable/review/lot5-student-tabs/`. Ce contrôle local ne constitue pas
un audit sur appareil réel/lecteur d’écran ni une validation cloud ou Drive.

## Parcours de préparation et publication

1. Préparer le cours avec ChatGPT dans le dossier du module et le projet Open-slide existant.
   Le plan validé reste la source des objectifs, séances, échéances, barèmes et publics.
2. Vérifier localement les exports destinés aux étudiants. Garder les sources du diaporama,
   notes enseignant, corrigés et grilles contenant des résultats hors du dossier Drive partagé.
3. Demander à Codex de déposer les exports sélectionnés sur le Drive professionnel, ou le
   faire manuellement. Retourner les liens réellement fournis par Drive.
4. L’agent crée ou met à jour le brouillon Coursely avec les métadonnées, évaluations, planning
   et liens. Les informations absentes ou contradictoires sont signalées, pas inventées.
5. Vérifier le brouillon et publier la page. Une modification de page garde l’ancienne
   publication visible jusqu’à la publication du nouveau brouillon.

La page de classe liste ses modules publiés. La page de module reprend les cinq blocs
validés : supports ; consignes et barèmes ; échéances et remise ; ressources utiles ; bref
repère « vu en cours / à faire » lorsqu’il apporte quelque chose. Le public ne reçoit aucun
nom d’étudiant, score, commentaire, proposition de correction ou document privé.

Drive gère ses propres droits et versions. Remplacer un fichier déjà partagé publie sa
nouvelle version immédiatement, indépendamment du bouton de publication de Coursely : ce
remplacement intervient après vérification du fichier. Utiliser une nouvelle version sur le
même identifiant Drive pour conserver son lien, plutôt qu’un nouvel import avec suppression.
Le bouton « Publier » ne change pas les permissions Drive. Retirer un lien ou dépublier une
page Coursely ne retire pas automatiquement le partage du fichier dans Drive.

Une première vérification sur un fichier fictif doit confirmer le bon compte professionnel,
le dépôt par l’agent, le remplacement avec conservation du lien et l’ouverture sans connexion
Google. Les règles Workspace peuvent limiter le partage externe. La capacité de 5 To évoquée
reste à vérifier ; le compte n’a pas été consulté. Les actions du connecteur Drive ne sont pas
actuellement exposées dans cette session, donc le dépôt réel reste à valider lors de la mise
en place. Aucun projet Google Cloud facturé n’est créé par défaut pour ce parcours.

## Notation et calculs

Chaque évaluation peut regrouper plusieurs critères, eux-mêmes détaillés en lignes de notation.
Chaque ligne affiche son libellé, le maximum et un champ « obtenu / maximum ». Les quiz
peuvent avoir une seule ligne correspondant à leur total de points. La grille générale
présente les résultats des évaluations et le ou les résultats attendus pour le module.

Les définitions sont configurables selon le cadrage du module : sections, évaluations,
critères, maxima, composantes notées ou formatives et règles de calcul. Le dispositif commun
15 % quiz / 25 % projet / 60 % soutenance s’applique lorsqu’il est retenu. Le module BTS déjà
préparé fournit un autre cas de test : deux dossiers sur 60 et 80 points, deux résultats
distincts sur 20, sans agrégation annuelle ; quiz et entretiens formatifs.

- Les points saisis sont des entiers entre zéro et le maximum. Une valeur vide reste manquante.
  Zod valide les entrées dans l’interface et sur le serveur.
- Les calculs conservent leur précision ; seul le résultat final sur 20 est arrondi au dixième.
- Le cumul de quiz additionne les points obtenus et possibles, pas leurs pourcentages moyens.
- Les états distinguent « À évaluer », « Noté », « Absent injustifié » et « Absent justifié /
  rattrapage à traiter ». Les champs sont désactivés en cas d’absence.
- Une absence injustifiée compte zéro pour l’évaluation concernée avec son maximum conservé.
  Un cas justifié reste en attente d’une décision ; aucune règle de rattrapage n’est inventée.
- Le retard utilise l’échéance et la date de remise dans le fuseau Europe/Paris, en jours
  calendaires. La pénalité est d’un point par jour sur la production ramenée sur 20, une seule
  fois, avec minimum zéro et conservation des points bruts.
- Les exceptions et refus sont des choix explicites de l’enseignant. L’application ne déduit pas une absence de
  nouvelles de l’étudiant ; le refus met zéro à la production concernée.

Un barème peut être remplacé directement et les résultats sont recalculés, sans étape
supplémentaire d’approbation du changement. Les critères qui restent identiques gardent leurs
identifiants et leurs points bruts : 8/10 devient 8/20 si le maximum devient 20. Une nouvelle
ligne est à noter. Un score supérieur au nouveau maximum est signalé comme à corriger,
bloque le résultat définitif et n’est jamais tronqué. Retirer une ligne ne réattribue pas ses
points à un autre critère. Les scores des lignes retirées peuvent rester récupérables dans la
correction privée jusqu’à la purge, sans entrer dans le nouveau calcul.

L’enregistrement manuel garde les saisies en cours en cas d’erreur. Les révisions empêchent
une seconde fenêtre ou une proposition devenue obsolète de remplacer silencieusement une
correction plus récente. L’état d’enregistrement est visible.

Le commentaire de semestre dispose d’un champ privé et d’une action de copie. L’agent peut le
proposer avec les points, sans ajouter de justifications par critère à Coursely. Une
proposition n’écrase aucun résultat enregistré : l’enseignant la vérifie puis l’accepte ou la refuse.

## PDF final pour l’école

Le PDF reproduit toute la grille du module dans le contexte de la classe : une ligne par
étudiant, colonnes de résultats, intitulé du module, classe, année et date d’export. Il exclut
le détail des critères et les commentaires privés. Les résultats distincts prévus par le
cadrage sont conservés ; aucune moyenne annuelle non définie n’est ajoutée.

L’export est disponible lorsque toutes les évaluations notées nécessaires sont résolues pour
tous les étudiants. Les activités formatives ne le bloquent pas. Une absence injustifiée
résolue compte comme zéro ; une note manquante, un cas justifié non arbitré ou une correction
invalide après changement de barème bloque l’export. La V1 n’ajoute ni sélection de colonnes
ni PDF provisoire. Le fichier est généré et téléchargé côté navigateur pour éviter un service
de rendu PDF supplémentaire, puis contrôlé sur une grille de douze étudiants avec les accents
et les éventuels sauts de page. Son téléchargement reste réservé à l’enseignant.

## Import et MCP local

Le MCP local de Coursely s’appuie sur une API authentifiée et les mêmes services que
l’interface. Codex lit les fichiers autorisés sur le Mac ; le site distant ne lit pas les
chemins locaux. Le plugin Google Drive intervient séparément pour les exports et leurs
versions. La V1 n’ajoute pas de MCP distant ni de fournisseur OAuth pour ChatGPT hébergé.

Le contrat d’import versionné contient l’identité du module, son contexte, la préparation,
les séances et échéances, les liens sélectionnés, les évaluations, critères et règles de
calcul. Une proposition de correction contient les identifiants de l’étudiant, du contexte
et des lignes, les scores proposés, le commentaire et les révisions de référence. Les
formules sont des données structurées validées, jamais du code à exécuter.

Une petite liaison technique `.coursely.json` dans le dossier local du module conserve
l’identifiant Coursely et les correspondances de critères et fichiers Drive. Elle ne
contient aucun jeton, secret ou score étudiant et ne remplace aucun support pédagogique.
Les imports utilisent des identifiants durables et une clé d’idempotence : relancer un import
ne crée pas un second module ou une seconde proposition. L’agent ne rapproche pas des
critères ambigus ou des classes seulement par ressemblance des noms.

Les outils proposés sont limités aux intentions utiles : lire le contexte d’import, créer ou
mettre à jour un brouillon, renseigner une classe et sa liste d’étudiants, remplacer un barème
explicitement demandé et déposer une proposition de correction. La validation des
corrections, publication de la page et purge annuelle restent des actions dans l’interface.

L’accès agent utilise une clé liée au compte enseignant, révocable et limitée à ces
opérations, avec expiration et limitation de débit. Utiliser le plugin API Key de Better
Auth, compatible avec la version retenue, plutôt qu’une clé Turso fournie à l’agent. Aucune
clé Drive ou Turso n’est incluse dans les outils, les manifestes ou la configuration suivie
par Git. La suppression ou révocation d’une clé est testée avant l’usage réel.

## Lots d’implémentation

Chaque lot commence uniquement après validation de ce plan. Lorsqu’il comporte une page ou
un nouveau parcours visuel, la séquence est : brief Impeccable réutilisant ce cadrage,
propositions de disposition, choix explicite du responsable produit, développement, critique, audit et finition.
Les variantes explorent la composition et les interactions dans le thème existant.

| Lot                                     | Travail                                                                                                                                                                                | Résultat à vérifier                                                                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Socle de données et accès           | Récupérer sélectivement les fichiers Turso, Drizzle, Better Auth, passkeys, invitations et tests sauvegardés ; adapter au rôle enseignant seul ; créer les schémas métier et fixtures. | Migration locale isolée, connexion et révocation testées, données privées refusées sans session, construction Workers conservée. Design validé avant les pages connexion et activation.                               |
| 2 — Classes et modules durables         | Liste de classes, import et édition des étudiants, bibliothèque de modules, création et édition manuelles, rattachement à une promotion, planning et préparation.                      | Rechargement conservant les données ; plusieurs modules utilisant la même liste ; réutilisation d’un module sans copies de notes. Choix de design pour gestion des classes et éditeur de module.                      |
| 3 — Notation privée                     | Barèmes détaillés, états, enregistrement, calculs, retards, exceptions, refus et commentaire de semestre.                                                                              | Parcours module → étudiant → correction → résultat retrouvé après rechargement. Choix de design pour grille et correction détaillée.                                                                                  |
| 4 — Parcours agent                      | Clé agent, API et MCP local ; contrat d’import ; liaison au dossier ; propositions de correction et vérification.                                                                      | Import fictif idempotent et proposition acceptée/refusée ; conflit de révision traité ; accès révoqué refusé. Design choisi pour écran de vérification des propositions.                                              |
| 5 — Drive et pages étudiantes           | Valider le parcours Drive sur un fichier fictif ; préparer les liens ; brouillon, aperçu, publication et dépublication ; pages de classe et de module.                                 | Lecteur sans compte accédant aux seuls supports sélectionnés, liens conservés lors du remplacement, aucune donnée étudiante dans les réponses publiques. Choix de design pour aperçu/publication et pages étudiantes. |
| 6 — PDF et rentrée                      | Export complet, archivage des contextes et purge d’année avec récapitulatif et confirmation.                                                                                           | PDF conforme et blocages corrects ; purge retirant classes et données étudiantes sans toucher aux modules ni à l’accès enseignant. Design choisi pour export et purge dans les pages concernées.                      |
| 7 — Mise en ligne et validation globale | Adapter la CI au backend local, déployer sur Workers Free avec Turso dédié à Coursely, créer la passkey sur l’origine choisie et vérifier les parcours.                                | Recette complète avec données fictives sur HTTPS avant introduction des premières données réelles.                                                                                                                    |

L’accueil conserve sa direction « Prochaine intervention », la sidebar inset escamotable,
l’avatar et les trois modes de thème. Il reçoit les données et liens réels au fil des lots ;
aucune nouvelle disposition n’est imposée sans le choix explicite du responsable produit.

## Organisation technique prévue

| Emplacement                                            | Rôle                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/lib/domain/`                                      | Types, contrats Zod, calculs, règles de barème et tests sans accès cloud.          |
| `src/lib/server/db/` et `drizzle/`                     | Schémas, contraintes et migrations pour les données et l’authentification.         |
| `src/lib/server/auth/`                                 | Passkeys, invitations, session, autorisation enseignant et clé agent.              |
| `src/lib/server/teaching/`                             | Services et accès aux classes, modules, corrections, propositions et publications. |
| `src/routes/enseignant/`                               | Pages privées et actions serveur pour les parcours métier.                         |
| `src/routes/classes/` et `src/routes/modules/`         | Pages étudiantes publiques basées sur les seules publications.                     |
| `src/routes/api/`                                      | Routes Better Auth et API d’import/propositions pour le MCP.                       |
| `src/lib/components/teacher/` et composants étudiants  | Parcours conçus et validés avec Impeccable, utilisant shadcn-svelte.               |
| `src/lib/pdf/`                                         | Génération de la grille finale côté navigateur.                                    |
| `scripts/`                                             | Invitations/révocation, migrations opérateur, fixtures et serveur MCP local.       |
| `.coursely.json` dans chaque dossier de module importé | Liaison technique aux identifiants et liens, sans données sensibles.               |
| Documentation du projet                                | Glossaire, décisions retenues, usages, environnement exemple et étapes de recette. |

Les routes exactes et la découpe des composants suivent les dispositions choisies ; ces
emplacements indiquent la séparation des responsabilités, pas des pages déjà dessinées.
Préserver les conventions TypeScript, Svelte 5 et les imports `#lib` avec extensions `.js`.

Avant récupération du backend, préserver le workspace avec GitButler. La sauvegarde
`wip/database-auth` contient aussi l’ancien socle : ne pas l’appliquer par-dessus le design
actif. Récupérer les fichiers utiles et les adapter ; conserver la branche de sauvegarde.
Les rôles pédagogie, routes de simulation de rôle et valeurs fixes du prototype ne sont pas
repris dans l’application active.

Mettre à jour `PRODUCT.md`, `AGENTS.md` et `README.md` lors de l’intégration pour refléter
le nouveau périmètre. `AGENTS.md` et `README.md` restent en anglais ; les skills restent
gérés par leurs installateurs. Ajouter uniquement le MCP Coursely nécessaire au parcours
agent, en réutilisant les serveurs Svelte et Playwright déjà configurés.

La CI conserve installation figée, formatage, lint, types, tests et construction Workers. Les
tests d’accès aux données utilisent une base locale isolée et des comptes fictifs, sans
secrets cloud. Ajuster le test HTTP de l’accueil pour tenir compte de sa protection et
contrôler séparément la connexion et une page publique fictive. La configuration MCP
existante Svelte et Playwright reste utilisée ; chaque composant passe le Svelte autofixer.

## Recette et critères de fin

- Barèmes : cumul 4/5 + 7/10 égal à 11/15 ; résultat commun 15,2/20 sans retard et 14,7/20
  avec deux jours dans l’exemple du cadre ; deux résultats BTS séparés ; formatif exclu.
- Saisie : vide distinct de zéro, décimale refusée, absent désactivé, justifié en attente,
  points conservés après remplacement du barème, nouveaux critères et dépassements signalés.
- Persistance : erreurs réseau visibles, saisie conservée, conflits de révision non écrasés,
  proposition obsolète refusée et commentaire privé retrouvé.
- Accès : absence de session et clé agent révoquée refusées ; inscription publique fermée ;
  aucune note ou liste nominative exposée par les pages étudiantes.
- Publication : brouillon de page non visible publiquement, ancienne page conservée pendant
  édition, retrait d’une page effectif ; comportement Drive séparé expliqué et testé.
- PDF : export complet seulement quand les résultats requis sont définitifs ; accents,
  lisibilité et sauts de page vérifiés ; aucun critère détaillé ou commentaire privé inclus.
- Purge : isolation de l’année choisie, suppression des classes et de toutes les données
  étudiantes associées, conservation du module et de ses contenus, autorisations enseignant
  et autres années intactes. Les fichiers Drive ne sont pas supprimés.
- Interface : chemin complet au clavier, mobile, clair/sombre et aperçu de largeur 810 px ;
  formats desktop 1440 px et mobile 390 px ; résultats d’audit et limites signalés.
- Déploiement : parcours fictif complet sur l’origine `workers.dev`, base dédiée, aucune
  migration du Notion historique ni données étudiantes réelles introduites avant la recette.

## Références

Le [cadre pédagogique](/Users/leo/Documents/Formations/docs/cadre-pedagogique.md),
les [règles d’évaluation](/Users/leo/Documents/Formations/docs/evaluation.md) et
les [supports et outils](/Users/leo/Documents/Formations/docs/supports-et-outils.md)
restent les références de préparation. Le
[plan BTS validé](/Users/leo/Documents/Formations/MyDigitalSchool/BTS-SIO-1/Developpement-professionnel-et-mode-projet/enseignant/plan-module.md)
sert de cas de module sans la formule commune.

Drive : [partage par lien](https://support.google.com/drive/answer/2494822),
[versions](https://support.google.com/drive/answer/2409045),
[mise à jour sur le même identifiant](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update).

Accès agent : [API Key Better Auth](https://better-auth.com/docs/plugins/api-key).
Hébergement : [offres Workers](https://developers.cloudflare.com/workers/platform/pricing/).

La validation du plan confirme le périmètre, l’ordre des lots et le modèle de conservation.
Elle ne remplace pas les choix de design attendus avant chaque nouvelle page.
