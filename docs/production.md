# Préparation du lancement Coursely

Point de mise en service du 17 octobre, après intégration OAuth/MCP et P3 : voir
[la cible, les contrôles et les actions utilisateur restantes](production-readiness-2026-10-17.md).
La base neuve doit recevoir **les onze migrations, de `0000` à `0010`**, avant le premier push de lancement.

État au 16 octobre 2026 : **préparation locale, aucun déploiement**. Le prototype a été déclaré
supprimé par Léo ; son état distant n’a pas été vérifié. Aucun compte, secret, jeton, DNS, base
distante ou réglage GitHub n’a été créé ou modifié. La démo locale sur le port 53962 reste séparée.
Léo a choisi le déploiement automatique après un push sur main et une CI réussie. Cette passe reste
locale : aucun pipeline distant ni credential n’est activé, et aucun push de lancement n’est effectué.

## Cible et configuration

La cible finale est le Worker **`mds`**, selon le nom choisi par Léo. Le projet reste **Coursely**.
Léo a fourni le namespace du compte `leohilaire-1f7.workers.dev` : l’origine prévue est donc
**`https://mds.leohilaire-1f7.workers.dev`**.
Cette adresse n’a pas été vérifiée comme déployée et aucun Worker n’est créé par cette préparation.
Aucun domaine personnalisé, route DNS, Managed Challenge, service de rendu ou stockage supplémentaire.
Le `wrangler.jsonc` local reste inchangé, avec son nom `coursely`. Seule la configuration de
production générée cible `mds`, sans suffixe ni environnement Wrangler nommé. Aucun environnement
GitHub n’est requis. La date de compatibilité existante et
`nodejs_compat` sont conservés ; l’origine et les passkeys de la démo locale ne changent pas.
Toute commande de production doit viser le fichier généré ; la configuration racine ne désigne
pas la cible finale `mds`.

`pnpm production:prepare` projette une configuration explicite dans le fichier ignoré
`.wrangler/production/wrangler.json`, à partir de la configuration locale et de **deux variables
obligatoires sans valeur par défaut** :

| Variable                     | Valeur de préparation fournie par Léo                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`      | `1f7361109db586cc5f7f3f7c8ea636e6`, fourni par Léo ; accès et rattachement du namespace non vérifiés |
| `COURSELY_PRODUCTION_ORIGIN` | `https://mds.leohilaire-1f7.workers.dev`, sans slash final ; à confirmer dans le compte              |

Léo a fourni l’identifiant de compte ci-dessus ; le namespace fourni doit encore être rapproché
de ce compte en lecture seule. Cet identifiant public n’est ni un credential ni une preuve d’accès.
Confirmer cette origine avant toute inscription de passkey. Le validateur
exige explicitement cette adresse et refuse les valeurs absentes ou toute autre origine, sans
contourner la vérification obligatoire de `CLOUDFLARE_ACCOUNT_ID`. Il ne prouve pas la propriété du
compte ni l’existence du Worker. `.env.example` contient l’origine prévue et cet identifiant non
secret ; son `ORIGIN` local reste inchangé. Ne pas copier ce fichier sur le `.env` de la démo.

La chaîne de configuration est identique dans le workflow : variable GitHub
`COURSELY_PRODUCTION_ORIGIN` → préparation validée → `vars.ORIGIN` du Worker. Better Auth utilise
cette même origine pour `baseURL`, `trustedOrigins` et l’origine du plugin passkey ; son `rpID`
est le hostname **`mds.leohilaire-1f7.workers.dev`**, sans protocole ni chemin. Aucune valeur
distincte de `rpID` n’est à configurer. Le workflow reprend les variables de dépôt correspondantes.

La projection conserve seulement les assets et le code nécessaires ; tout nouveau binding dans
la source impose une revue. `ORIGIN` est une variable publique de configuration, injectée dans
le Worker à l’exécution. Les trois secrets requis sont déclarés par leur **nom**. Les logs sont
échantillonnés à 10 %, les traces à 1 %, avec suppression des query strings et sans destination
externe. Ne jamais journaliser corps, cookies, clés, liens d’invitation ou données étudiantes.
Les chemins et identifiants peuvent rester visibles dans la télémétrie : réserver son accès aux
opérateurs. [Configuration Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/),
[logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[traces](https://developers.cloudflare.com/workers/observability/traces/).

## Gratuité : preuves et limites

La documentation officielle consultée le 16 octobre 2026 donne, pour Workers Free :

| Ressource                                        | Limite                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| Code du Worker                                   | 64 Mio **non compressés**, sans plafond gzip distinct |
| CPU par requête HTTP                             | 10 ms ; attente réseau exclue                         |
| Mémoire par isolate                              | 128 Mo                                                |
| Requêtes                                         | 100 000/jour, partagées au niveau du compte           |
| Sous-requêtes / connexions sortantes simultanées | 50 / 6 par requête                                    |
| Démarrage                                        | 1 seconde                                             |
| Assets                                           | 20 000 fichiers, 25 Mio maximum par fichier           |

Source : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/).
Le dry-run fournit la taille brute et gzip ; le script vérifie le budget brut et les assets.
Un succès local ne mesure ni CPU distant, ni démarrage à froid, ni mémoire sous concurrence.
Le SSR SvelteKit, la vérification cryptographique des passkeys, les calculs, les projections
d’export et les transactions Turso restent à mesurer. Aucun réglage `limits.cpu_ms` payant n’est
ajouté. Si Free échoue, arrêter le lancement et examiner des optimisations ; ne pas souscrire
automatiquement. [Tarification Workers](https://developers.cloudflare.com/workers/platform/pricing/).

Le PDF est généré dans le navigateur avec `pdfmake` et ses polices locales, chargés à la demande.
Le Worker autorise et produit les projections de notes ; il ne rend pas le PDF. Le contrôle du
metafile signale le moteur PDF encore inclus dans le bundle serveur par les imports dynamiques
SSR, et bloque libSQL Node. Cette inclusion augmente le bundle malgré la génération navigateur ;
elle reste à considérer pour le démarrage et la mémoire, sans modifier les exports ici. Better Auth
minimal, son plugin passkey et libSQL web restent côté Worker avec `nodejs_compat` : le build et
le démarrage local vérifient leur assemblage, pas leur consommation CPU en production.

Workers Logs Free inclut actuellement 200 000 événements/jour et trois jours de rétention.
[Tarification des logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
Le changement Observability annoncé au **1 décembre 2026** regroupe logs/traces : Free annonce
0,5 Go/jour, sept jours de rétention et arrêt d’ingestion au quota. La préparation de production
se bloque à cette date pour imposer une revue du compte et des tarifs avant de retirer le garde.
Ce garde bloque les nouveaux lancements, sans désactiver un Worker déjà en ligne.
[Tarification Observability](https://developers.cloudflare.com/observability/pricing/).

Turso Free annonce 100 bases, 5 Go, 500 millions de lignes lues/mois, 10 millions écrites/mois
et 3 Go de synchronisation/mois. Vérifier les quotas réellement partagés par l’organisation,
le forfait gratuit et l’absence d’overages avant création ; aucun upgrade n’est prévu.
[Tarification Turso](https://turso.tech/pricing).

GitHub Actions peut consommer des minutes et du stockage facturables selon le dépôt et le compte.
Ne pas activer d’achat de minutes ; vérifier le solde et les limites de dépenses avant le lancement.
La CI complète s’exécute avant tout déploiement automatique après push sur `main`. Aucune preuve locale ne garantit
un coût total nul pour ces comptes.
[Facturation Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## GitHub : push sur main, puis déploiement après CI

Le dépôt **privé `Nekxio/Coursely`** n’a actuellement ni environnement GitHub ni protection de
branche, selon l’état transmis. Le pipeline préparé ne dépend d’aucun de ces mécanismes et ne demande
pas d’offre payante. Il utilise uniquement **`.github/workflows/ci.yml`**, avec `quality` puis `deploy`.
L’ancien workflow de production manuel a été retiré ; **ne pas connecter Workers Builds au dépôt**
ni créer un second workflow de déploiement.

| Événement                                                   | Vérifications                                               | Déploiement                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Push sur `main`, CI réussie, activation renseignée          | Toutes                                                      | Automatique pour le même commit, s’il est toujours en tête de main au contrôle final |
| Push sur `main`, test/build/contrôle échoué ou annulé       | Échec ou annulation                                         | Aucun                                                                                |
| Push sur `main`, activation absente ou différente de `true` | Toutes                                                      | Job ignoré ; pipeline encore désactivé                                               |
| Pull request, y compris vers `main`                         | Toutes                                                      | Aucun, sans secrets de production                                                    |
| Push sur `develop`                                          | Toutes                                                      | Aucun                                                                                |
| Push sur une autre branche ou un tag                        | Pas de workflow push ; les PR éventuelles restent vérifiées | Aucun                                                                                |
| Déclenchement manuel de CI                                  | Toutes                                                      | Aucun                                                                                |

Le job `deploy` dépend du succès de **tous** les contrôles : format/lint, types application/scripts,
unitaires/intégration, navigateurs fictifs desktop/mobile, build, budget Workers Free et smoke local
sur 4173. `quality` publie automatiquement le SHA de son checkout ; `deploy` checkout ce SHA du push
et vérifie son identité avec le commit testé. Aucun SHA à saisir ni confirmation manuelle à chaque
push. Une nouvelle construction et un dry-run de la cible finale précèdent l’accès aux secrets.

Juste avant le déploiement, le jeton automatique `GITHUB_TOKEN` du job lit **uniquement** la référence
`main` dans ce dépôt via l’API GitHub. Si main a avancé, l’ancien job est ignoré avant les secrets
Cloudflare/Turso ; une erreur de lecture bloque le déploiement. Cette vérification évite les anciennes
relances et les commits dépassés en attente, sans prétendre verrouiller la branche pendant l’upload.
Le jeton reste limité à `contents: read` et à cette étape ; aucun PAT ni connexion OAuth n’est requis.
[Lecture d’une référence Git](https://docs.github.com/en/rest/git/refs#get-a-reference).

Les contrôles concurrents dépassés peuvent être annulés **au niveau du job qualité**. Le déploiement
utilise son propre groupe `coursely-production`, avec `cancel-in-progress: false` : un nouveau push
ne tue pas un upload en cours. Un job en attente peut être remplacé ; l’ordre des versions en attente
n’est pas déduit de l’ordre des pushes, d’où le contrôle de main avant l’upload.
[Concurrence GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Les actions restent épinglées, les checkouts ne conservent pas les credentials. Permissions GitHub :
**`contents: read` seulement**, sans écriture Git, permissions de PR ou OIDC. Aucun `environment:`
n’est déclaré. L’absence de protection de branche signifie que les personnes pouvant écrire sur
`main` contrôlent les prochains déploiements et peuvent modifier le workflow ; la condition CI ne
remplace pas ce contrôle d’accès. Aucune protection payante n’est présumée ni activée.

### Paramètres à saisir dans GitHub pour activer le pipeline

Dans **Settings → Secrets and variables → Actions** du dépôt, utiliser les variables et secrets
**du dépôt**. Leur valeur ou existence actuelle n’a pas été inspectée ici ; aucun réglage n’a été
créé par cette passe. Les secrets ne sont référencés dans le YAML que dans la dernière étape de
`deploy`, jamais dans `quality`, l’installation, le build ou le dry-run.

| Portée            | Nom                           | Valeur / usage                                                                   |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Variable de dépôt | `CLOUDFLARE_ACCOUNT_ID`       | `1f7361109db586cc5f7f3f7c8ea636e6`                                               |
| Variable de dépôt | `COURSELY_PRODUCTION_ORIGIN`  | `https://mds.leohilaire-1f7.workers.dev`                                         |
| Variable de dépôt | `COURSELY_PRODUCTION_ENABLED` | `true` seulement lorsque la base, les secrets et le premier lancement sont prêts |
| Secret de dépôt   | `CLOUDFLARE_API_TOKEN`        | Jeton Cloudflare de déploiement, fourni par saisie sécurisée                     |
| Secret de dépôt   | `BETTER_AUTH_SECRET`          | Secret aléatoire stable, 32 caractères minimum                                   |
| Secret de dépôt   | `TURSO_DATABASE_URL`          | URL de la base de production dédiée, déjà migrée                                 |
| Secret de dépôt   | `TURSO_AUTH_TOKEN`            | Accès limité à cette base                                                        |

Pas d’environnement GitHub à créer, de SHA à recopier ou de validation manuelle par release.
Conserver `COURSELY_PRODUCTION_ENABLED` absent ou `false` jusqu’à la préparation réelle. L’ajouter
à `true` ne lance pas à lui seul un workflow ; **le prochain push sur main** peut déployer. Ne pas
mettre cette activation dans un fichier `.env` de démo. Les secrets de dépôt ne constituent pas
une isolation contre une personne autorisée à modifier les workflows du même dépôt.
[Secrets de dépôt GitHub](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-a-repository).

L’étape finale écrit un JSON éphémère en mode 0600 dans `RUNNER_TEMP`, transmet son chemin à
`wrangler deploy --secrets-file`, puis le supprime même en cas d’erreur. Aucun secret en argument
littéral, dans le bundle ou en artifact. Les secrets sont joints à la version de code d’un même
déploiement ; les secrets omis ne sont pas supprimés par Wrangler. Les secrets manquants arrêtent
l’étape avant l’upload. Les logs Wrangler et ce JSON ne sont pas publiés comme artifacts.
[Secrets avec le code](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code).

Le jeton Cloudflare doit viser le seul compte retenu. La création initiale d’un Worker inexistant
demande actuellement le rôle Workers **Admin au niveau produit** ; un jeton **Editor limité au
Worker `mds` existant** suffit aux déploiements suivants et doit remplacer ce droit initial.
Vérifier les intitulés réellement proposés et l’expiration lors de la création sécurisée. Pas de
droits DNS/zone, KV, R2, D1, facturation ou gestion des membres, et pas de connexion OAuth.
Le namespace fourni est `leohilaire-1f7.workers.dev` ; vérifier qu’il appartient bien au compte retenu.
S’il diffère ou demande une configuration, arrêter et faire autoriser cette modification de compte.
[Droits Workers actuels](https://developers.cloudflare.com/workers/authorization/workers/#wrangler).

## Checklist opérateur avant la première mise en ligne

- [ ] Avant l’activation, confirmer le compte, l’origine stable, Workers Free et les quotas GitHub
      Actions. Le déploiement après push sur main est le fonctionnement demandé ; aucune règle
      d’approbation GitHub ni protection de branche n’est exigée par ce pipeline.
- [ ] Choisir une base Turso **neuve, dédiée et vide**, sans réutiliser le prototype ni importer
      `data/`, `db:fixtures` ou les bases navigateur. Vérifier organisation, région, forfait, quotas
      partagés et absence d’overages. Aucun credential de Turso dans Cloudflare autre que les secrets
      nécessaires au Worker ; aucun accès Drive ou stockage à ajouter.
- [ ] Relire la totalité du journal `drizzle/meta/_journal.json` et les migrations `0000` à `0010`.
      Exécuter `scripts/db-migrate.ts` seulement comme opération explicitement autorisée, avec les
      variables de cette base fournies par un mécanisme sécurisé. Ne pas charger le `.env` de démo.
      La commande `pnpm db:migrate` charge `.env` : pour la production, utiliser un checkout opérateur
      propre et `pnpm exec tsx scripts/db-migrate.ts` avec environnement sécurisé. La CI ne migre pas.
- [ ] Vérifier le journal de migrations et le schéma complet avant de démarrer le code. Les tests
      SQLite locaux ne prouvent pas l’application sur Turso ; toutes les migrations restent distantes
      non appliquées par cette préparation. Prévoir une sauvegarde/restauration contrôlée avant une
      future évolution d’une base contenant des données.
- [ ] Saisir les secrets et les variables exacts via les interfaces sécurisées choisies. Conserver
      `BETTER_AUTH_SECRET` et `ORIGIN` entre versions. Better Auth dérive `trustedOrigins` et le
      `rpID` du même `ORIGIN` ; un changement de hostname peut empêcher les passkeys de fonctionner.
- [ ] Une fois la base et les secrets prêts, renseigner les variables de dépôt, activer
      `COURSELY_PRODUCTION_ENABLED=true`, puis pousser le code revu sur `main`. La CI puis le
      déploiement s’enchaînent sans autre saisie. Aucun commit ou push n’est fait par cette préparation.
      Relever ensuite SHA, identifiant de version Cloudflare et origine effective, sans secret.
- [ ] Vérifier l’origine retournée avant le bootstrap. Au premier déploiement, aucune ancienne
      version applicative ne sera disponible pour rollback.
- [ ] Créer le premier enseignant via `scripts/auth-invite.ts` seulement après autorisation opérateur,
      depuis le checkout propre, avec la même origine, le même secret et la base dédiée. Exemple
      de forme : `pnpm exec tsx scripts/auth-invite.ts <email-validé> "<nom-validé>"` avec environnement
      sécurisé. Aucun email n’est envoyé. Ouvrir le HTML privé généré dans `data/invitations/`, sans
      partager sa valeur dans les logs/chat. Le token reste dans le fragment, à usage unique, 24 h.
- [ ] Activer la passkey avec vérification sur l’appareil, tester la reconnexion puis la déconnexion.
      Pas d’inscription ouverte, de mot de passe, de compte étudiant ou de clé MCP créée par la CI.

## Recette HTTPS avant données étudiantes réelles

Faire une recette isolée et autorisée avec données strictement fictives ; conserver le site sans
données réelles tant que ces points ne sont pas validés. Les contrôles locaux ne les remplacent pas.

- Accès anonyme : `/connexion` disponible, accueil et pages enseignant redirigés ; API privées et
  exports refusés avant lecture privée. Vérifier cookies Secure/HttpOnly/SameSite, `no-store`,
  erreurs publiques `noindex`, absence de session dans les projections publiques.
- Invitation expirée/réutilisée refusée, session de huit heures et vérification de l’appareil.
  Tester une passkey physique sur l’origine stable et l’usage desktop/mobile, clavier et lecteur
  d’écran. Tester un `Origin` étranger sur une écriture privée : refus attendu.
- Créer un module et une classe fictifs, noter, tester les conflits/réessais, exporter classe entière
  et individu ; contrôler que le PDF se génère localement dans le navigateur avec les bons champs.
- Publier puis retirer un contenu fictif après revue ; les données privées ne doivent jamais être
  exposées. Tester les liens externes et leurs droits hors Coursely. Ne pas purger de vrais records.
- Mesurer CPU p50/p95/p99 et erreurs `exceededCpu`/1102 sur passkeys, sessions, SSR, grilles,
  publications, export et grandes classes fictives ; vérifier démarrage froid, mémoire, sous-requêtes,
  quotas Workers/Turso et consommation Actions. La latence HTTP seule ne mesure pas le CPU.
  Les échantillons peuvent manquer une erreur : recouper avec les métriques agrégées.

## Rollback et arrêt

Avant une version suivante, noter l’identifiant de la dernière version saine et la compatibilité
du schéma. Un rollback Cloudflare vers cette version est une **action de production** à autoriser
séparément ; vérifier la cible et utiliser le dashboard ou la commande Wrangler documentée avec
l’identifiant explicite. Il ne restaure pas Turso, les migrations ou les fichiers externes ; ne pas
exécuter de migration descendante improvisée. Conserver le même hostname et les secrets requis.
[Rollback Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

En cas d’échec du premier lancement, il n’existe pas encore de version saine. Laisser le bootstrap
et les données réelles en attente, désactiver `COURSELY_PRODUCTION_ENABLED` pour les futurs runs
et décider séparément d’une correction ou d’une suspension du Worker. Cette variable n’arrête pas
un site déjà déployé. Ne jamais rediriger silencieusement vers le prototype ou une autre origine.

## Vérification locale reproductible

Travailler dans une copie excluant `.env*`, `.dev.vars*`, `data/`, `.wrangler`, `.svelte-kit`,
`.git`, les configurations privées et les artifacts ; seuls les packages installés sont nécessaires.
Ne pas modifier ni arrêter la démo 53962. Depuis cette copie, sans credentials d’environnement :

```sh
pnpm lint
pnpm check
pnpm test
pnpm check:browser
pnpm build
pnpm worker:dry-run
```

`worker:dry-run` refuse les fichiers de secrets présents et les credentials d’environnement.
Il appelle uniquement `wrangler deploy --dry-run`, sans upload, et produit le metafile et
`.wrangler/preflight/summary.json`. Il ne contacte pas Turso. Le port de preview local reste 4173
dans la CI existante ; utiliser un autre port libre pour une vérification isolée si nécessaire.

Avec les deux variables **renseignées à partir des informations fournies**, `pnpm production:prepare`, puis
`pnpm worker:dry-run .wrangler/production/wrangler.json` contrôlent la projection finale sans
déploiement. Sans ces variables, l’échec explicite est attendu ; aucune fausse URL ne les remplace.
Les paramètres synthétiques des tests unitaires n’appartiennent jamais à une cible déployable.
L’identifiant réel fourni reste dans la configuration et ce guide ; les tests conservent leur
identifiant synthétique indépendant.

Les résultats de la préparation sont consignés ci-dessous après exécution locale ; aucune réussite
de workflow distant, protection GitHub, migration Turso ou recette HTTPS n’est présumée.

### Résultats initiaux du 16 octobre 2026, avant réception du compte

Copie de validation : `/tmp/coursely-production-check.U9Pcp7`, sans secrets ni données de démo.
Node 26.11.1, pnpm 12.11.2 et Wrangler installé 4.149.0, sans mise à jour de dépendance. Les packages
installés ont été réutilisés avec un répertoire `$app` propre à la copie ; la vérification automatique
d’installation de pnpm a été désactivée uniquement dans cette copie. Le premier essai avec un
`node_modules` entièrement lié empêchait la résolution des types de routes ; l’isolation a été corrigée
avant les contrôles réussis ci-dessous. Les tests ouvrant un serveur fictif ont été exécutés avec
autorisation loopback, après le refus réseau du sandbox. Aucun service distant n’a été utilisé.

| Contrôle                                                       | Résultat                                                                                | Preuve locale temporaire                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Formatage et ESLint complets, puis ESLint des scripts modifiés | Réussite                                                                                | `/tmp/coursely-production-lint.log`, `/tmp/coursely-production-changed-eslint.log` |
| Types application/Svelte et scripts                            | 0 erreur, 0 avertissement Svelte ; tsc réussi                                           | `/tmp/coursely-production-types-isolated.log`                                      |
| Types tests navigateur                                         | Réussite                                                                                | `/tmp/coursely-production-browser-types.log`                                       |
| Tests unitaires/intégration fictifs                            | **384/384**, 43 fichiers ; dont 21 tests de préparation                                 | `/tmp/coursely-production-tests.log`, `/tmp/coursely-production-unit.log`          |
| Build adaptateur Workers                                       | Réussite                                                                                | `/tmp/coursely-production-build-final.log`                                         |
| `pnpm worker:dry-run`                                          | Réussite, aucun upload                                                                  | `/tmp/coursely-production-dry-run.log`                                             |
| Budget du bundle                                               | **10 589 003 octets bruts**, gzip **2 090,96 Kio** ; 123 assets, maximum 971 079 octets | `.wrangler/preflight/summary.json` et `metafile.json` dans la copie                |
| HTTP du Worker compilé, loopback 54173                         | **10/10** : connexion, redirections, API privées, erreurs publiques et cache            | `/tmp/coursely-production-http.json`                                               |
| Workflow YAML                                                  | Parsing local réussi, neuf invariants de déclenchement/permissions/dépendances validés  | Contrôle local du YAML ; pas d’exécution GitHub                                    |
| Cible finale manquante                                         | Échec attendu avec message `CLOUDFLARE_ACCOUNT_ID` ; aucun fichier final généré         | `/tmp/coursely-production-missing-target.log`                                      |

Le serveur temporaire 54173 a été arrêté ; la démo 53962 n’a été ni utilisée ni modifiée. Le build
signale les gros chunks navigateur existants, notamment le PDF ; le bundle serveur contient également
le moteur PDF et ses polices. Ces avertissements sont conservés. Aucun écran n’a changé, et la suite
Playwright complète n’a pas été relancée ici : elle reste obligatoire dans la CI du commit de release.
La validation locale du YAML ne remplace pas celle de GitHub Actions.

**Restent en attente** : confirmation en lecture seule du namespace et de l’état du compte fourni ;
existence et état HTTPS du Worker prévu ; état distant des offres gratuites et quotas ;
quota et réglages Actions du dépôt privé ; variables et secrets de dépôt ; création
de la base et migrations ; première mise en ligne autorisée ; bootstrap enseignant et recette HTTPS.
La génération et le dry-run de la cible finale, avec l’identifiant fourni, complètent ci-dessous
les contrôles initiaux du bundle. CPU, mémoire, démarrage et coût total ne sont pas validés en
production. Aucun déploiement, workflow distant, commit/push ou migration distante n’a eu lieu.

### Mise à jour de la cible `mds`

Le choix explicite de Léo remplace l’ancien nom de Worker prévu par `mds`. L’exemple public,
la projection de production, sa validation d’origine, la description du workflow et ce guide
reprennent `https://mds.leohilaire-1f7.workers.dev`. Le projet, son dossier, son nom de Worker local
et ses paramètres de passkey locaux sont conservés. Le nom local n’impose plus le nom de production.

Contrôles de cette mise à jour : **49/49 tests ciblés** sur la préparation et l’authentification
(`/tmp/coursely-production-mds-tests.log`), types application/scripts et Svelte sans erreur ni
avertissement (`/tmp/coursely-production-mds-types.log`), ESLint des fichiers modifiés et formatage
réussis. Neuf invariants locaux contrôlent la cohérence exemple/configuration/workflow et la
conservation du local. Avec l’origine prévue mais sans identifiant compte, la préparation échoue
comme attendu (`/tmp/coursely-production-mds-missing-account.log`). Ces résultats précèdent la
génération de la cible avec l’identifiant réel, détaillée ci-dessous.
Cet essai de refus précédait la réception de l’identifiant ; la préparation réelle de la cible
est désormais possible sans credential. Aucun contrôle HTTPS ni passkey sur ce hostname n’est revendiqué.

### Configuration finale avec l’identifiant fourni

Le fichier **`.wrangler/production/wrangler.json` est maintenant généré dans le workspace**, avec
`name: mds`, `account_id: 1f7361109db586cc5f7f3f7c8ea636e6` et l’origine HTTPS prévue. Il reste ignoré
par Git. La même projection, avec uniquement des chemins de build adaptés à la copie sans secrets,
a été soumise à Wrangler 4.149.0. Aucun credential n’est nécessaire à ce dry-run.

| Vérification finale                            | Résultat                                                                                       | Preuve locale                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Build de l’application actuelle                | Réussite                                                                                       | `/tmp/coursely-production-mds-account-build.log`                                                         |
| Génération de la configuration réelle          | Réussite                                                                                       | `.wrangler/production/wrangler.json`, `/tmp/coursely-production-mds-account-prepare.log`                 |
| Types des bindings de production               | Générés ; `ORIGIN` exact et trois secrets déclarés comme chaînes, sans valeur                  | `/tmp/coursely-production-mds-account-types.log` et `.wrangler/production/worker-env.d.ts` dans la copie |
| Dry-run de la cible finale                     | **Réussite, sans upload**                                                                      | `/tmp/coursely-production-mds-account-dry-run.log`                                                       |
| Bundle final                                   | **10 599 967 octets bruts / 2 091,38 Kio gzip**, 123 assets ; plus gros asset : 971 079 octets | `.wrangler/production/preflight-summary.json`                                                            |
| Préparation et authentification                | **49/49 tests ciblés réussis**                                                                 | `/tmp/coursely-production-mds-account-tests.log`                                                         |
| Cohérence configuration/exemple/workflow/local | Dix invariants réussis ; configurations racine/copie identiques hors chemins                   | Contrôle local sans accès distant                                                                        |

Les types runtime de la même date et des mêmes flags sont déjà générés par le build. La génération
additionnelle des seuls bindings utilise `--include-runtime=false` : une première tentative de
régénération runtime a été refusée par le sandbox sur un socket loopback. Aucun accès distant ni
nouvelle permission n’a été nécessaire pour produire les bindings. Le code PDF reste présent dans
le bundle, avec génération navigateur conservée ; les mesures CPU/mémoire distantes restent ouvertes.

L’origine produit bien le hostname de passkey `mds.leohilaire-1f7.workers.dev`. La configuration
ne contient que les **noms** des secrets requis. Aucune clé, session de compte, base distante ou
URL déployée n’a été validée par cette génération. Le compte fourni et le namespace doivent encore
être confirmés ensemble avant la première mise en ligne. La démo 53962 reste intacte.

### Vérification du passage au déploiement après push

Le fonctionnement automatique décrit plus haut remplace la préparation manuelle initiale. Le
workflow séparé a été retiré ; il n’existe qu’un appel de déploiement Wrangler dans les workflows.
Les preuves précédentes de bundle/configuration restent utiles ; les anciennes validations du
lancement manuel ne sont plus le contrat courant.

| Contrôle de cette modification               | Résultat                                                                                                               | Preuve locale temporaire                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Tests ciblés préparation et authentification | **70/70**, deux fichiers                                                                                               | `/tmp/coursely-production-auto-tests.log`     |
| Scénarios appliqués au YAML réel             | **13/13** : main réussi/échoué/annulé/inactif, PR, autres branches, tag, dispatch, fork, SHA divergent, commit dépassé | `/tmp/coursely-production-auto-workflow.json` |
| Invariants structurels du workflow           | 13 réussis : permissions, unicité, SHA automatique, secrets, absence d’environnement et annulation séparée             | `/tmp/coursely-production-auto-workflow.log`  |
| CLI réelle de validation locale              | **4/4** : main réussi accepté, PR/échec/SHA différent refusés                                                          | `/tmp/coursely-production-auto-cli.log`       |
| Types application/Svelte et scripts          | Réussite ; 0 erreur et 0 avertissement Svelte                                                                          | `/tmp/coursely-production-auto-types.log`     |
| Formatage et ESLint complets                 | Réussite                                                                                                               | `/tmp/coursely-production-auto-lint.log`      |

La vérification de main est testée avec des réponses GitHub **simulées**, y compris références
invalides, erreur HTTP/réseau et ancien commit. Aucun jeton réel n’a été créé ou envoyé, aucune
API privée ni workflow distant exécuté. Le parsing et la simulation locale ne prouvent pas une
exécution GitHub ; elle ne pourra être observée qu’après configuration et push. La suite navigateur
complète sera exécutée par `quality` avant tout déploiement ; elle n’a pas été relancée ici pour
cette modification de CI sans changement d’écran. La démo 53962 et les passkeys locales restent intactes.

### Étapes utilisateur minimales pour activer

1. Confirmer Workers Free et le namespace du compte fourni, puis préparer la base Turso dédiée et
   appliquer ses migrations comme opération opérateur séparée. Sans preuve d’une base migrée, ne
   pas activer le pipeline. Aucun credential ni accès au compte n’est établi par l’Account ID seul.
2. Dans les paramètres Actions du dépôt privé, vérifier que les workflows et les runners Ubuntu
   sont autorisés et que les quotas gratuits suffisent. Saisir les **quatre secrets** et les **deux
   variables de cible** du tableau, puis mettre `COURSELY_PRODUCTION_ENABLED=true` quand tout est prêt.
   Ne pas configurer d’environnement `production` ni de connexion Workers Builds.
3. Amener ces fichiers revus sur `main` par le processus Git habituel et pousser. Ce push déclenchera
   les contrôles ; le déploiement `mds` ne commencera que si leur commit réussit et reste courant.
   Un dispatch manuel sert seulement à vérifier la CI. Aucun workflow distant n’a été exécuté ici.

Les lectures du forfait, du namespace, des quotas Actions et des noms de paramètres existants
peuvent être faites sans changement dans des sessions déjà ouvertes. Une nouvelle connexion,
la saisie des credentials, les réglages distants, la migration et le push ne sont pas effectués
par cette passe. Safari n’a pas été utilisé. Le pipeline automatique est **préparé localement** ;
son activation effective et l’existence de l’URL ne sont pas confirmées.
