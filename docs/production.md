# Mise en production Coursely

## Cible et état de préparation

Coursely cible le Worker **`mds`**, dans le compte public
`1f7361109db586cc5f7f3f7c8ea636e6`, à l’origine stable
**`https://mds.leohilaire-1f7.workers.dev`**. Aucun domaine personnalisé, DNS, Managed Challenge,
Workers Builds, service de rendu PDF ou stockage supplémentaire n’est nécessaire.

La configuration locale `wrangler.jsonc` conserve le nom `coursely`. La production utilise seulement
la projection ignorée `.wrangler/production/wrangler.json`, générée par `pnpm production:prepare`.
Les variables `CLOUDFLARE_ACCOUNT_ID` et `COURSELY_PRODUCTION_ORIGIN` sont obligatoires ; une origine
absente ou différente échoue explicitement. La date de compatibilité et `nodejs_compat` sont conservés.
Ne pas remplacer le `.env` ou les paramètres des démos locales.

État communiqué le 17 octobre 2026 : base Turso dédiée créée, migrations **0000–0010** appliquées,
premier enseignant et invitation préparés par l’opérateur, paramètres GitHub saisis. La migration
**0011 a ensuite été appliquée personnellement par l’opérateur**, qui a rapporté douze
empreintes/dates conformes, le trigger vérifié et les compteurs applicatifs inchangés. Ces informations ne prouvent pas la disponibilité HTTPS du
Worker. Le premier déploiement, l’activation et la recette distante restent en attente.
**`COURSELY_PRODUCTION_ENABLED=false` doit être conservé jusque-là.**

Better Auth dérive `baseURL`, `trustedOrigins`, l’origine passkey et le `rpID` du même `ORIGIN`.
Le `rpID` est `mds.leohilaire-1f7.workers.dev`. Conserver le hostname et `BETTER_AUTH_SECRET` entre
versions : les changer peut empêcher les passkeys existantes de fonctionner.

## Vérifications locales et CI

Dans une copie propre sans `.env*`, `.dev.vars*`, credentials, bases ni données de démo :

```sh
pnpm lint
pnpm check
pnpm test
pnpm check:browser
pnpm build
pnpm worker:dry-run
```

Le dry-run refuse les fichiers de secrets et credentials d’environnement. Il ne contacte pas Turso
et utilise uniquement `wrangler deploy --dry-run`, sans upload. Son rapport est
`.wrangler/preflight/summary.json`, accompagné du metafile des dépendances.
Avec les deux variables publiques de cible, exécuter également `pnpm production:prepare`, puis
`pnpm worker:dry-run .wrangler/production/wrangler.json`. Aucun secret n’est nécessaire.

Les tests navigateur restent **locaux**, avec leurs fixtures isolées, authentificateurs virtuels,
projets desktop/mobile et dépendances épinglées :

```sh
pnpm exec playwright install chromium
pnpm check:browser
pnpm test:browser
```

Conserver une recette navigateur locale réussie du candidat avant la première mise en ligne.
Après une modification ciblée, conserver aussi les preuves des scénarios concernés, notamment
`tests/browser/errors.spec.ts`, `framing.spec.ts` et l’authentification OAuth/passkey.
Les copies de test ne chargent pas les secrets et ne modifient pas les démos existantes.
Les tests automatisés ne remplacent pas les essais au lecteur d’écran et sur appareil physique.

Le workflow unique `.github/workflows/ci.yml` exécute lint, types application/scripts, tests unitaires
et intégration, types des tests navigateur, build, budget Workers Free et smoke HTTP du Worker local
sur 4173. **Il n’installe pas Chromium et n’exécute pas Playwright à distance**, afin de limiter
les minutes Actions. Le job qualité utilise `ubuntu-24.04` et un timeout de quinze minutes.
Un dépassement ou une erreur bloque le déploiement ; ne pas contourner un contrôle échoué.

| Événement                                       | Qualité             | Déploiement                                    |
| ----------------------------------------------- | ------------------- | ---------------------------------------------- |
| Pull request, push `develop`, dispatch manuel   | Oui                 | Aucun                                          |
| Push `main`, activation absente ou `false`      | Oui                 | Aucun                                          |
| Push `main`, activation `true`, qualité réussie | Oui                 | Même commit, s’il est encore en tête de `main` |
| Échec ou annulation de qualité                  | Échec               | Aucun                                          |
| Autre branche ou tag                            | Aucun workflow push | Aucun                                          |

`deploy` dépend de `quality`, reprend son SHA et vérifie à nouveau `main` avant d’accéder aux
secrets de production. Le groupe qualité annule les contrôles dépassés ; le groupe
`coursely-production` utilise `cancel-in-progress: false` pour préserver un upload en cours.
Cette vérification ne verrouille pas la branche pendant l’upload.
Les actions sont épinglées, les checkouts ne conservent pas les credentials et les permissions
GitHub sont limitées à `contents: read` ; aucun PAT ni OIDC.

Le dépôt privé ne dépend d’aucun environnement GitHub payant ni protection de branche présumée.
Aucun `environment:` n’est déclaré. Les personnes autorisées à modifier les workflows peuvent
accéder aux secrets du dépôt : les conditions CI ne remplacent pas les droits d’accès GitHub.
Un dispatch manuel vérifie seulement le code ; il ne déploie jamais.

## Paramètres et accès opérateur

Dans **Settings → Secrets and variables → Actions**, conserver ces paramètres de dépôt :

| Type     | Nom                           | Usage                                                    |
| -------- | ----------------------------- | -------------------------------------------------------- |
| Variable | `CLOUDFLARE_ACCOUNT_ID`       | `1f7361109db586cc5f7f3f7c8ea636e6`                       |
| Variable | `COURSELY_PRODUCTION_ORIGIN`  | `https://mds.leohilaire-1f7.workers.dev`                 |
| Variable | `COURSELY_PRODUCTION_ENABLED` | **`false`**, jusqu’à autorisation distincte du lancement |
| Secret   | `CLOUDFLARE_API_TOKEN`        | Déploiement du seul Worker retenu                        |
| Secret   | `BETTER_AUTH_SECRET`          | Secret stable, au moins 32 caractères                    |
| Secret   | `TURSO_DATABASE_URL`          | Base dédiée déjà migrée                                  |
| Secret   | `TURSO_AUTH_TOKEN`            | Accès limité à cette base                                |

Les valeurs secrètes restent dans les interfaces sécurisées. Ne pas les saisir dans le chat,
les commandes, fichiers suivis ou logs. La CI n’y accède que dans l’étape finale de déploiement,
après installation, build, dry-run et vérification du SHA. Elle écrit un JSON éphémère mode 0600
dans `RUNNER_TEMP`, transmis par chemin à `wrangler deploy --secrets-file`, puis supprimé même en cas
d’erreur. Aucun artifact de secrets ou log Wrangler n’est publié.

La création initiale d’un Worker demande actuellement le rôle produit Workers **Admin**, limité
au seul compte, avec expiration courte. Dès que `mds` existe, le remplacer par **Editor limité à
ce Worker**. Aucun droit DNS/zone, KV, R2, D1, facturation ou membres, aucune connexion OAuth.
Vérifier les rôles réellement proposés avant une saisie autorisée.
[Permissions Workers](https://developers.cloudflare.com/workers/authorization/workers/#wrangler),
[secrets avec le code](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code).

## Mise à jour ciblée de la base existante : 0011

La cible fixe est **`libsql://coursely-prod-nekxio.aws-eu-west-1.turso.io`**. Elle contient déjà les
onze migrations 0000–0010 ainsi que l’enseignant et son invitation. **Ne pas relancer l’ancien
opérateur de base vide, `db:fixtures`, le bootstrap ou une importation de `data/`.**

Après revue et autorisation de l’opération distante, depuis le checkout contenant ce lot :

```sh
pnpm production:migrate
```

Lancer personnellement dans un terminal interactif, sans argument, redirection ni journal de
session. Le script ne charge aucun `.env` ni credential d’environnement. Il affiche l’unique cible,
demande le jeton Turso RW de cette base en **saisie masquée**, puis vérifie le journal distant.
La confirmation exacte demandée est **`APPLIQUER 0011 COURSELY-PROD`**.

Le manifeste versionné vérifie les douze fichiers SQL et leurs dates/empreintes avant tout accès.
L’opérateur refuse un journal distant divergent, un trigger non journalisé ou un schéma inattendu.
Dans une transaction d’écriture, il revalide 0000–0010, installe seulement le trigger 0011, ajoute
sa ligne de journal, vérifie les douze empreintes/dates et le SQL du trigger, puis contrôle que
les compteurs de toutes les tables applicatives sont inchangés avant commit. Aucune identité,
invitation ou valeur de ligne n’est affichée. La migration ne supprime aucune ligne existante.

En cas de perte de réponse, relancer **la même commande** : un journal 0000–0011 et un trigger
conformes donnent « déjà appliquée », sans nouvelle écriture. Toute divergence exige une revue,
jamais une modification manuelle du journal. Un nouveau lot de migrations nécessite un nouvel
opérateur revu. La CI ne migre jamais la base.

0011 borne atomiquement les clients OAuth publics inutilisés à 100. Le nettoyage à l’inscription
dynamique élimine par lots de 100 ceux âgés de plus de 24 h sans propriétaire, consentement ni token.
Les clients liés et les tokens, même expirés/révoqués, sont protégés ; les parcours de plus de 24 h
sans consentement doivent recommencer leur inscription. Voir [MCP distant](remote-mcp.md).
Conserver les sources opérateur, preuves de migration et invitation privée existante jusqu’à la
recette HTTPS. Ne pas ouvrir, copier ou publier cette invitation pendant les vérifications.

## Gratuité et mesures restantes

La documentation officielle consultée en octobre 2026 indique pour Workers Free :

| Ressource                              | Limite                                            |
| -------------------------------------- | ------------------------------------------------- |
| Code Worker                            | 64 Mio non compressés, sans plafond gzip distinct |
| CPU HTTP                               | 10 ms/requête, attente réseau exclue              |
| Mémoire / démarrage                    | 128 Mo / 1 seconde                                |
| Requêtes                               | 100 000/jour, partagées par le compte             |
| Sous-requêtes / connexions simultanées | 50 / 6 par requête                                |
| Assets                                 | 20 000 fichiers, 25 Mio maximum par fichier       |

[Limites Workers](https://developers.cloudflare.com/workers/platform/limits/),
[tarification](https://developers.cloudflare.com/workers/platform/pricing/).
Le contrôle local mesure le bundle brut/gzip et les assets ; il ne mesure pas CPU, mémoire,
démarrage froid ou concurrence en production. Aucun `limits.cpu_ms` payant n’est ajouté.
Si Free échoue, arrêter le lancement et étudier une optimisation sans souscription automatique.

Le PDF et les polices locales sont chargés à la demande et rendus **dans le navigateur**.
Le Worker autorise et construit les projections privées. Des imports SSR incluent encore le moteur
PDF dans son bundle : surveiller démarrage et mémoire. Le metafile bloque libSQL Node ; libSQL web,
Better Auth et les passkeys sont assemblés avec `nodejs_compat`. Les tests locaux ne prouvent pas
leur respect des 10 ms CPU distants.

Les logs sont échantillonnés à 10 %, les traces à 1 %, avec query strings supprimées et sans
destination externe. Ne jamais journaliser corps, cookies, clés, invitations ou données étudiantes.
Les chemins/identifiants peuvent rester visibles : réserver l’accès aux opérateurs.
Workers Logs Free annonce 200 000 événements/jour et trois jours de rétention. Le changement
Observability annoncé au **1 décembre 2026** prévoit 0,5 Go/jour, sept jours de rétention et arrêt
d’ingestion au quota : le préparateur se bloque à cette date jusqu’à revue des tarifs et du compte.
Ce garde n’arrête pas un Worker déjà déployé.
[Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[Observability](https://developers.cloudflare.com/observability/pricing/).

Turso Free annonce 100 bases, 5 Go, 500 millions de lignes lues/mois, 10 millions écrites/mois
et 3 Go de synchronisation/mois. Vérifier les quotas partagés et l’absence d’overages sur le compte.
Le forfait déclaré est Free, AWS Irlande. GitHub Actions dispose d’un quota gratuit partagé ;
le premier run de trente minutes a été arrêté au timeout. Contrôler le solde réel avant le suivant.
Ne pas ajouter de carte, acheter de minutes ou activer un service payant. **Aucun test local ne
permet de promettre un coût total nul.**
[Tarification Turso](https://turso.tech/pricing),
[facturation Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Checklist de lancement et recette HTTPS

- [ ] Vérifier compte, origine, forfaits et quotas ; conserver les démos et leurs passkeys.
- [x] Migration 0011 appliquée par l’opérateur ; résultat conforme rapporté, sans lecture privée.
- [ ] Valider le candidat localement, notamment les navigateurs, puis attendre la CI du même commit.
- [ ] Faire autoriser séparément le premier lancement. Seulement alors, activer le flag et amener
      le commit revu sur `main` ; le push déclenchera qualité puis déploiement. Une modification du
      flag seule ne lance rien. Aucun merge/déploiement n’est autorisé par la préparation.
- [ ] Relever SHA, identifiant de version Cloudflare et origine effective, sans secret.
- [ ] Utiliser l’invitation déjà préparée si encore valide ; si elle a expiré, faire autoriser une
      nouvelle invitation via l’opérateur sécurisé. Usage unique, 24 h, token uniquement en fragment,
      aucun email envoyé. Ne pas recréer l’enseignant ou exposer le lien.
- [ ] Sur l’origine finale, activer une passkey avec vérification d’appareil, tester reconnexion,
      déconnexion, session de huit heures et refus d’invitation expirée/réutilisée.
- [ ] Vérifier cookies Secure/HttpOnly/SameSite, redirections privées, refus des API/exports anonymes,
      `no-store`, `noindex`, erreurs sans détails internes et refus des origines étrangères.
- [ ] Tester MCP OAuth/PKCE, consentement et révocation ; vérifier les headers anti-iframe externes
      et le maintien des aperçus de même origine.
- [ ] Avec données uniquement fictives, créer classe/module, noter, tester conflits/réessais,
      publication/retrait et PDF classe entière/individu. Vérifier liens Drive hors Coursely.
- [ ] Mesurer CPU p50/p95/p99 et erreurs `exceededCpu`/1102 sur auth, SSR, grilles, publications,
      exports et grandes classes fictives ; vérifier démarrage, mémoire, sous-requêtes et quotas.
      La latence HTTP seule ne mesure pas le CPU ; recouper échantillons et métriques agrégées.
- [ ] Terminer clavier, lecteur d’écran et appareil physique avant toute donnée étudiante réelle.

## Rollback et conservation locale

Noter la dernière version saine et sa compatibilité de schéma avant chaque mise à jour. Un rollback
Cloudflare est une action de production à autoriser séparément, avec identifiant de version explicite.
Il ne restaure ni Turso, ni migrations, ni fichiers externes. Aucune migration descendante improvisée ;
conserver origine et secrets. La première mise en ligne ne dispose encore d’aucune version saine.
En cas d’échec, laisser les données réelles en attente, remettre le flag à `false` pour les prochains
runs et décider séparément de la correction/suspension. Le flag n’arrête pas le site déjà déployé.
[Rollback Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

`data/` reste exclu de Git. Les anciens aperçus de prototype inutilisés et le rapport conversationnel
ont été retirés de l’arbre suivi ; ils restent dans l’historique et une quarantaine locale réversible.
Le manifeste `data/quarantine/2026-10-17-production-cleanup/manifest.json` indique les déplacements.
Seules trois anciennes copies de validation de cette préparation y ont aussi été déplacées.
Les fixtures fonctionnelles, `data/mcp-demo`, les preuves, snapshots, archives source, opérateurs,
invitations privées et configurations d’agent sont conservés. Aucun nettoyage distant ou effacement
irréversible n’accompagne cette préparation.
