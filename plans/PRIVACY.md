# Cadrage RGPD et droit français/européen pour les six plans

Établi le 13 octobre 2026 contre le workspace `e0adfff`. Sources publiques vérifiées à cette date.
Périmètre précisé par Léo le 14 octobre 2026 ; références de cadrage reconsultées à cette date.
Ce dossier organise les exigences et les décisions restantes ; il ne certifie pas la conformité
d'une installation cloud ou d'un contrat qui n'a pas été examiné. Les agents ne modifient que les
fichiers de leur plan technique, avec des données fictives pour les vérifications.

## Périmètre confirmé par Léo

Léo est développeur full stack et intervient dans les écoles comme prestataire de formation.
Coursely relève de son initiative personnelle pour organiser ses cours et présenter des éléments
pédagogiques aux étudiants ; l'école ne lui a pas demandé de mettre en place cet outil.
Il l'utilise seul, avec son propre compte et uniquement ses données pour le moment, selon sa
déclaration. Aucun compte étudiant ou compte d'établissement n'est prévu. Aucun contrat de
prestation, compte fournisseur, secret ou base réelle n'a été inspecté.

Léo a choisi de conserver les classes et notes pendant un an après la fin de l'année scolaire,
puis de les purger. Les corrections sont réalisées entièrement hors ligne sur son PC, sans envoi
de leur contenu à un service distant, selon sa confirmation. L'information destinée aux étudiants
doit décrire les finalités et destinataires effectifs de Coursely sans présenter les outils locaux
de correction. Cela ne signifie pas que les noms et résultats enregistrés dans Coursely sont
hébergés sur le PC : le stockage et l'hébergement du service restent à examiner séparément.

Le modèle prévoit néanmoins des données étudiantes futures : noms, notes, remises, absences,
commentaires et propositions de correction. Elles appartiennent aux étudiants concernés, même
si Léo est le seul utilisateur connecté. Un usage individuel professionnel n'est pas, du seul
fait d'être individuel, une activité strictement personnelle ou domestique au sens de l'article
2(2)(c). La qualification dépend de l'usage effectif. [RGPD, articles 2 et 4 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre1)

Pour l'organisation du dossier, Léo porte les décisions relatives à son usage autonome.
Avant des données étudiantes issues d'un établissement, il faudra vérifier la relation juridique
réelle avec cet établissement : un simple choix personnel ne tranche pas une éventuelle
responsabilité de l'établissement ou un traitement sur ses instructions. Aucun compte
institutionnel supplémentaire n'est nécessaire pour faire cette vérification.
[CNIL, enseignement supérieur](https://www.cnil.fr/fr/enseignement-superieur-bonnes-pratiques-outils-collaboratifs)

## Exigences applicables maintenant

Protéger le compte enseignant, les sessions, invitations, passkeys et clés agent ; garder les
secrets hors du client et des journaux ; limiter les métadonnées de sécurité à leur finalité.
Les six plans utilisent exclusivement des identités et travaux inventés pour leurs tests.
Le droit d'accès de l'utilisateur unique ne permet pas d'exposer des cookies ou des secrets
dans les pages publiques. Minimisation, exactitude et durée nécessaire restent les principes
de référence. [RGPD, article 5 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2)

Les cookies d'authentification strictement nécessaires peuvent être exemptés de consentement
en droit français. Préserver leur seule finalité technique et leurs attributs de sécurité ; ne
pas ajouter de publicité ou de mesure d'audience dans ces plans. Examiner aussi localStorage,
cookies de thème/sidebar et éventuels services tiers selon leur finalité réelle, sans déduire
une exemption de leur seul nom. Le renouvellement de session du plan 006 n'appelle pas, à lui
seul, un bandeau de consentement. [Loi Informatique et Libertés, article 82](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037813978),
[CNIL, cookies et traceurs](https://www.cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi)

## Cartographie technique à maintenir

| Ensemble                   | Données et destinataires prévus                                                       | Limite à préserver                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Accès enseignant           | Compte, passkeys, sessions, invitations, clés agent ; Léo et fournisseurs nécessaires | Secret côté serveur ; pas de compte étudiant ; clés agent sans session navigateur         |
| Sécurité                   | Compteurs de débit, horodatages, clés hachées dérivées du client/chemin               | Hachage non assimilé à anonymisation ; suppression bornée du plan 002 ; pas de profilage  |
| Notation future            | Identité, points, résultats, remise, absence, commentaire                             | Accès enseignant ; aucun détail nominatif sur les pages publiques                         |
| Propositions de correction | Contexte ciblé, corrections proposées, décision humaine                               | Portée explicite ; pas d'acceptation agent ; pas de donnée étudiant dans `.coursely.json` |
| Publication                | Supports et liens sélectionnés, module/classe/année/planning                          | Projection publique version 2 ; contrôle du contenu des documents liés                    |
| PDF final futur            | Noms et résultats définis, contexte et date ; école destinataire                      | Classe complète pour le livrable école ; pas de commentaire, critère ou lien de remise    |
| Copies externes            | Drive, téléchargements PDF, appareils, exports éventuels                              | La purge Coursely ne supprime pas ces copies ; cycle de vie séparé                        |

Ne pas introduire de motifs médicaux d'absence, diagnostics, justificatifs ou autres données
particulières dans les commentaires ou les tests. Si l'usage réel en exige, revoir sa nécessité
et ses conditions avant de l'autoriser. [RGPD, article 9 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2)

## Décisions avant les premières données étudiantes réelles

Ces décisions peuvent être préparées pendant l'exécution technique. Elles ne bloquent pas les
tests fictifs. Les plans 001–006 ne valent pas autorisation de déploiement, de migration Turso ou
d'import étudiant réel. Les états ci-dessous sont suivis dans `privacy-decisions.json`.

### 1. Finalités, rôles et base légale

Décrire séparément préparation, organisation des cours, publication de supports pédagogiques,
suivi/notation et PDF destiné à l'école. Les corrections hors ligne ne constituent pas un envoi
à un prestataire distant dans le périmètre déclaré.
Documenter la relation avec chaque établissement et le fondement adéquat de chaque traitement,
sans choisir automatiquement consentement, intérêt légitime ou mission d'intérêt public.
Le consentement des étudiants n'est pas une solution automatique dans une relation pédagogique.
La CNIL demande ce cadrage aux établissements du supérieur ; adapter ses conseils à la relation
effective de Léo avec eux. [CNIL, enseignement supérieur](https://www.cnil.fr/fr/enseignement-superieur-bonnes-pratiques-outils-collaboratifs)

Livrable : une fiche de traitement par finalité, décision datée et identité du décideur, sans
liste nominative dans le dépôt. Évaluer registre et DPO selon les critères applicables, pas
seulement selon la taille de l'activité ; une activité régulière ne bénéficie pas automatiquement
de la dispense de registre des structures de moins de 250 personnes.
[RGPD, articles 30 et 37 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4)

### 2. Information et exercice des droits

Préparer une information française accessible indiquant responsable/contact, finalités et bases,
destinataires, durées, transferts, droits et recours CNIL. Adapter au mode de collecte et à la
présence éventuelle de mineurs. Fournir un moyen de demande sans créer de compte étudiant.
Organiser accès, rectification, limitation/opposition et effacement lorsqu'ils s'appliquent,
avec contrôle proportionné d'identité. Le délai de réponse est normalement d'un mois ; prolongation
motivée possible selon les conditions de l'article 12.
[RGPD, articles 12–22 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3)

Livrable : notice et procédure testées sur un étudiant fictif. Ne jamais utiliser le PDF de toute
la classe comme réponse nominative à une demande d'accès individuelle : il exposerait les autres.
Une contestation de note exige un examen humain ; ne pas automatiquement supprimer des preuves
nécessaires à une obligation ou à un litige. Ne pas envoyer de notice ou de réponse pour Léo sans
instruction explicite. Une nouvelle page légale requiert le parcours de design approuvé.

### 3. Conservation, effacement et copies

Politique choisie par Léo : classes, notes et données personnelles annuelles associées conservées
un an après la fin de l'année scolaire, puis supprimées avec le parcours de purge existant.
La date effective de fin doit être renseignée pour chaque année ; ne pas supposer un 31 août
universel. Il s'agit d'une politique opérateur, pas d'une durée légale uniforme déjà vérifiée.
La justification, les obligations de la prestation et les éventuelles copies remises à l'école
restent à documenter. Cette clarification n'ajoute ni purge automatique ni opération sur une base
réelle ; le parcours actuel demeure une décision explicite de l'enseignant.

Fixer les événements de départ, durées, accès en archive et sort final de chaque ensemble :
compte/sécurité, inscriptions, corrections, propositions/décisions, PDF locaux, Drive et sauvegardes.
Ne pas inventer une durée légale uniforme pour les notes : la finalité et les éventuelles
obligations de l'établissement doivent être connues. La rétention courte du plan 002 concerne
uniquement les compteurs techniques. [RGPD, article 5 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2)

Livrable : tableau de conservation validé, calendrier d'examen/purge et preuve sur fixtures de la
suppression des données annuelles, avec conservation des seuls modules sans données étudiant.
Les modules durables, champs libres et documents partagés demandent une revue de contenu :
« durable » ne signifie pas conservation illimitée d'une identité étudiant. Vérifier séparément
les PDF téléchargés et les sauvegardes du fournisseur. Ne pas ajouter de purge automatique réelle
ou de sauvegarde/restauration UI dans les six plans.

### 4. Fournisseurs cloud, contrats et transferts

Pour Cloudflare, Turso et Drive lorsqu'ils sont effectivement utilisés, relever service/offre,
entité contractante, rôle, sous-traitants ultérieurs, régions effectives de stockage/traitement,
accès de support, journaux, sauvegardes, suppression et réutilisation des données. Vérifier les
engagements requis au titre de l'article 28. Aucune conformité d'un fournisseur ni localisation
« France/UE seulement » n'a été établie par cet audit.
[CNIL, sécurité cloud](https://www.cnil.fr/fr/securite-cloud-informatique-en-nuage)

Si des transferts vers un pays tiers existent, vérifier le mécanisme applicable et sa validité
actuelle, y compris les transferts ultérieurs. Une région de base européenne ne résout pas à elle
seule les accès/support/transferts. Ne présumer ni interdiction générale de tout fournisseur
non européen, ni suffisance automatique d'une certification ou d'un contrat standard.
[RGPD, chapitre V — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre5)

Livrable : tableau des prestataires avec liens publics et statut de vérification, sans recopier
identifiants de compte ni contrats privés dans Git. Si une offre gratuite ne satisfait pas les
exigences retenues, présenter à Léo les conséquences et options ; ne pas changer silencieusement
l'architecture ou souscrire une offre. Les recommandations SecNumCloud ou doctrines du secteur
public ne sont pas présentées comme une obligation universelle pour cet usage individuel.

### 5. Corrections locales et examen d'impact

Le périmètre confirmé prévoit des corrections entièrement hors ligne sur le PC de Léo. Aucun
prestataire de correction distant n'est déclaré ; l'information Coursely destinée aux étudiants
ne doit pas en présenter un. La capacité technique du MCP à lire un contexte ciblé ou déposer
une proposition ne prouve pas l'utilisation effective d'un service externe. Aucun travail étudiant
réel n'a été inspecté ou transmis dans cette mission.

L'information doit toutefois refléter les modalités réelles de notation. Si des outils interviennent
dans une décision automatisée, leurs obligations d'information et leur qualification restent à
examiner selon les fonctions et l'usage, même hors ligne. Le choix de ne pas présenter les outils
locaux n'autorise pas l'omission d'une information légalement requise.
[RGPD, articles 13–14 et 22 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3)

Conserver la décision enseignante effective, la possibilité de modifier/refuser et les contrôles
des références de notation. Protéger aussi les fichiers locaux : accès à l'appareil, copies,
sauvegardes et suppression. Ne pas assimiler une pseudonymisation à une anonymisation.

Examiner le besoin d'une AIPD selon les risques du traitement de notation réellement envisagé,
sa portée et les personnes concernées, notamment en présence de mineurs. Le traitement local
n'exclut pas cette évaluation ; ne pas conclure automatiquement qu'une AIPD est obligatoire ou
inutile. [RGPD, article 35 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4)

Livrable : fiche des flux réels et décision d'analyse d'impact motivée, avec analyse si requise.
Tout changement des outils, destinataires ou modalités de décision impose de revoir ce cadrage
avant l'usage réel. Cette mise à jour documentaire ne modifie pas les capacités de l'application.

### 6. Sécurité, incidents et recette HTTPS

Décrire la protection des appareils, mises à jour, accès, sauvegardes/restauration, retrait de
partage et traitement d'un incident. Tester le parcours complet fictif sur l'origine HTTPS stable
choisie avant de réels dossiers étudiants. Aucune opération cloud n'est exécutée dans cette mission.
Définir une procédure de violation : documentation, évaluation du risque et notification CNIL
dans les conditions de l'article 33, si possible sous 72 heures après connaissance ; information
des personnes selon l'article 34 si risque élevé. Ces actions ne sont pas déclenchées par cet
audit en l'absence d'incident constaté.
[RGPD, articles 32–34 — CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4)

Livrable : procédure et recette datées, résultats et limites de vérification consignés. La
limite de taille du corps d'activation, constat 7 non sélectionné pour ces six plans, reste une
mesure technique à traiter ou une décision de risque à consigner avant cette recette.

## État et vérification du dossier

Les décisions de préparation sont `PENDING`, sans déclarer l'utilisation future conforme.
`studentDataCurrentlyUsed` et `readyForRealStudentData` sont false dans le dossier ; le premier
reflète la déclaration actuelle de Léo, le second les vérifications encore à faire.
Ce fichier de suivi n'est pas un paramètre de l'application et ne bloque pas l'exécution fictive.

`node plans/check-plans.mjs` doit vérifier l'existence des six plans, leurs dépendances et ce
fichier de suivi. Une décision ne passe à `VERIFIED` qu'avec responsable, date et référence de
preuve non nominative ; un test technique vert ne suffit pas. Ne stocker aucune réponse d'exercice
des droits, aucun contrat secret ni copie de données étudiant dans ce dossier suivi par Git.

Les sources CNIL sont des textes officiels reproduits ou recommandations : le plan distingue
ces statuts. La loi Informatique et Libertés complète le RGPD en France. Les règles sectorielles
d'un établissement et les obligations d'archives/examens doivent être examinées si ce périmètre
devient réel ; elles ne sont pas inventées pour le compte individuel actuellement prévu.
