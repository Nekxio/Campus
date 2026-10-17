# Mise en service HTTPS — point du 17 octobre 2026

**Le lancement n’est pas effectué.** Ce point prépare la coordination avec Léo. L’agent n’a créé
aucune clé réelle, lu aucune valeur de credential de compte, ouvert aucune nouvelle connexion OAuth,
ni exécuté de migration distante ou de déploiement. Les opérations Git locales autorisées sont
suivies dans le rapport de publication ignoré par Git. Les lectures GitHub utilisent la session
existante autorisée. Safari n’a pas été utilisé. Aucun nouveau scan de sécurité n’a été lancé.

## Cible et contenu du premier lancement

| Élément                         | Cible                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Dépôt privé et branche distante | `Nekxio/Coursely`, `main`                                                                                    |
| SHA distant constaté            | `46a3c62d8407c2e0128ac320b74a7cb90d9abe26`                                                                   |
| Checkout local                  | `gitbutler/workspace`, HEAD `fe39b235086aaee57513e13dae2299de5ad3d6d7`, avec les modifications non commitées |
| Worker final                    | `mds`                                                                                                        |
| Compte Cloudflare fourni        | `1f7361109db586cc5f7f3f7c8ea636e6` ; accès/forfait à confirmer dans le compte                                |
| Origine stable                  | `https://mds.leohilaire-1f7.workers.dev`                                                                     |
| Endpoint MCP distant            | `https://mds.leohilaire-1f7.workers.dev/mcp`                                                                 |
| Base de production              | `coursely-prod`, AWS Ireland, fournie par Léo ; identité et contenu à vérifier avant migration               |

URL fournie par Léo : `libsql://coursely-prod-nekxio.aws-eu-west-1.turso.io`. Sa réponse HTTPS anonyme
est **401**, avec certificat TLS valide et sans redirection : le service est joignable, mais ce
résultat ne prouve ni l’identité de la base dans le compte ni son absence de données. Ne pas modifier
le `.env` local pour renseigner cette cible.

Mise à jour opérateur : Léo a confirmé `coursely-prod` sur Turso Free, AWS Ireland, exécuté la
requête `sqlite_schema` ci-dessous avec résultat **« no rows »**, puis rapporté la réussite du script :
**onze hashes et dates conformes**, aucun enseignant, élève ou contenu de démo importé. Une première
confirmation incomplète s’était arrêtée sans écriture. Ce sont ses retours opérateur ; l’agent n’a
pas interrogé la base authentifiée ni relancé les migrations distantes. Les quatre noms de secrets
GitHub sont vérifiés présents, et les trois variables sont conformes, dont
`COURSELY_PRODUCTION_ENABLED=false`, relue explicitement après son bilan de migration. Léo a aussi
rapporté la réussite du bootstrap personnel : invitation privée sauvegardée sur son Mac et valable
jusqu’au 18 octobre. Ne pas lire ce fichier avec un outil d’agent ni l’ouvrir avant la recette HTTPS.
Les constats « zéro secret/variable » plus bas décrivent l’état antérieur, avant saisie par Léo.

Le code intégré comprend l’application enseignante, le MCP OAuth distant, les trois écrans approuvés
(`/connexion/application`, `/autoriser`, `/enseignant/applications`), P3, les onze migrations et le
pipeline de déploiement après CI réussie du même push sur main. Les huit outils stdio sont conservés.
Le MCP distant n’a pas accès aux dossiers du Mac ; aucun fichier de démo ou de connexion agent ne
doit être ajouté au commit. Ne pas pousser directement la branche de synthèse GitButler sans préparer
le commit de main avec les sélections explicites prévues par le projet.

GitButler **fonctionne hors sandbox** : `but status --no-hint --format json` réussit, alors que
la même lecture dans la sandbox échoue avec `unable to open database file`. Le projet est déjà
configuré ; ne pas lancer `but setup` pour contourner cette restriction. Le contrôle initial a trouvé
la cible `origin/develop`, la branche appliquée `temp` avec six commits devant main et 293 changements
non commités. La préparation autorisée crée un point de retour oplog, puis une branche de publication
**au-dessus de `temp`**, afin de préserver cette branche et ses six commits historiques. La cible
locale reste develop. Le SHA du candidat et les validations sont consignés dans
`data/recovery/production-readiness-20261017/publication/`, jamais les invitations privées.

### Procédure Git à autoriser séparément

1. Créer un point de retour avec `but oplog snapshot -m "Avant publication Coursely"` et conserver
   son SHA. Les fichiers privés ignorés ne sont pas une sauvegarde Git ; Léo les sauvegarde séparément
   si nécessaire, sans les exposer à l’agent ni les ajouter au commit.
2. Conserver `origin/develop` comme cible locale. La branche `temp` contient les six commits
   nécessaires au-delà de main : ne pas créer une branche parallèle qui omettrait ce contenu.
   Après le point de retour, utiliser `but branch new release/production --anchor temp` pour une
   branche dépendante, sans renommer `temp` ou réécrire ses commits.
3. Examiner les fichiers sélectionnés avec `but diff <id-fichier>`, rafraîchir les IDs, puis utiliser
   `but commit release/production --changes <ids-explicites> -m "<message-revu>"`. Exclure caches,
   `.pnpm-store`, serveurs et transferts des
   maquettes, données et configurations locales ; préserver leur contenu sur disque.
4. Vérifier le commit isolé et revoir le diff complet contre `origin/main`, sécurité comprise,
   avant la PR. Les contrôles du checkout ne suffisent pas si des modifications non commitées
   nécessaires au build ont été laissées hors de la branche.
5. Après validation des prérequis et autorisation du push, utiliser `but push release/production`
   avec le nom retenu, puis créer la PR dans GitHub avec **base `main` explicitement choisie**.
   Ne pas pousser `gitbutler/workspace`. Avec la cible actuelle, `but land` viserait develop ;
   une création de PR par défaut ne garantit pas une base main.
6. La fusion sur main demande la décision de lancement de Léo : si l’activation est renseignée,
   son push peut déclencher le déploiement après CI. Aucun snapshot, commit, push, changement de
   cible, PR ou fusion ne doit être déduit d’un simple contrôle local ; suivre l’autorisation de
   chaque phase. L’autorisation de préparation du candidat local ne vaut pas autorisation de fusion.

La syntaxe ci-dessus correspond à **but 0.21.0 installé**, dont `but commit --changes` ; les exemples
de versions plus récentes peuvent différer. Changer durablement la cible vers main serait une
décision distincte (`but config target origin/main`), précédée du point de retour.
[Branche workspace GitButler](https://docs.gitbutler.com/workspace-branch),
[snapshots](https://docs.gitbutler.com/cli-guides/cli-tutorial/operations-log).

## État distant vérifié en lecture seule

- GitHub Actions est activé, avec les actions autorisées ; **aucun workflow distant** n’est actuellement
  listé et `.github/workflows/ci.yml` est absent sur main (404).
- **Zéro secret Actions et zéro variable Actions** au moment du contrôle ; aucune valeur de secret
  n’a été demandée. Aucun environnement GitHub, et main n’est pas protégée. Le pipeline local ne
  dépend d’aucune protection payante ni d’un environnement `production`.
- Une lecture HTTPS anonyme de `/mcp` retourne **404**. Cela ne prouve pas à elle seule l’absence
  d’un Worker dans le compte ; le endpoint prévu n’est pas encore confirmé comme service MCP.
- Aucun accès de compte Cloudflare ni de base Turso n’est établi par les outils disponibles. Le
  CLI Turso n’est pas installé ; aucun outil n’a été installé et aucune nouvelle session ouverte.

Contrôle complémentaire après réception de l’URL : GitHub donne les droits admin/push sur ce dépôt,
Actions est activé et main est toujours au SHA ci-dessus. Il n’y a toujours ni secret, ni variable,
ni workflow, ni environnement distant ; main n’est pas protégée. Wrangler `whoami --json` indique
`loggedIn: false`, les variables de credentials de l’environnement sont absentes et l’IDE ne
configure aucune connexion de base. Aucun fichier de secrets n’a été lu. L’origine finale répond
404 sur `/connexion` ; cela ne permet pas de vérifier l’existence du Worker dans le compte.

Les premiers essais CLI étaient bloqués par le réseau/DNS du sandbox ; les lectures autorisées avec
accès réseau ont ensuite fourni les résultats ci-dessus. Le connecteur GitHub seul retournait 404 :
ce résultat isolé n’a pas été interprété comme une preuve d’absence du dépôt.

## Préparer les credentials par handoff utilisateur

La création de chaque accès persistant et sa transmission au service choisi demandent l’accord
spécifique de Léo et une saisie sécurisée, **jamais une clé dans le chat ou un journal d’agent**.

| Accès                        | Droits minimaux et destination                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jeton Cloudflare de CI       | Compte fourni seulement. Si `mds` existe déjà : Workers **Editor sur ce Worker**. Si sa création est nécessaire : Workers **Admin au niveau produit** pour la première création, puis remplacer par Editor sur `mds`. Expiration finie. Aucun droit DNS/zone, gestion des membres, facturation, R2, KV, D1 ou autre produit. Destination : secret Actions `CLOUDFLARE_API_TOKEN`. |
| Accès Turso de l’application | Jeton **lecture/écriture d’une seule base**, la nouvelle base vérifiée. Une clé lecture seule ne permet pas passkeys, sessions, consentements et notes. Pas de jeton de plateforme/organisation dans l’application ou la CI. Destination : `TURSO_AUTH_TOKEN`.                                                                                                                    |
| Accès opérateur de migration | Droit d’appliquer le schéma sur **cette seule base**, après validation de sa cible vide. Aucun accès général aux bases du compte. Exécution hors CI, avec variables fournies par l’utilisateur dans un terminal sécurisé.                                                                                                                                                         |
| Secret Better Auth           | Valeur aléatoire stable, au moins 32 caractères, créée/saisie par Léo de manière sécurisée. Sert également à protéger les clés de signature OAuth ; ne pas la remplacer entre migration, bootstrap et déploiement. Destination : `BETTER_AUTH_SECRET`.                                                                                                                            |
| Client Codex distant         | Après mise en ligne seulement : consentement navigateur explicite, commencer par `modules:read`. Pas d’`offline_access`, de correction ou d’écriture pour le premier contrôle de lecture.                                                                                                                                                                                         |

Les rôles Cloudflare actuels sont documentés dans
[les autorisations Workers](https://developers.cloudflare.com/workers/authorization/workers/#wrangler).
Le jeton Turso de connexion vise une base, avec un mode lecture seule distinct :
[jetons Turso](https://docs.turso.tech/cli/db/tokens/create).
Aucun fournisseur OAuth externe, client secret Codex ou service payant supplémentaire n’est nécessaire
à l’architecture intégrée ; le fournisseur est dans le même Worker et la même base.

### Handoff Turso immédiat, sans jeton dans le chat

Le script interactif local prêt à l’emploi est
`data/recovery/production-readiness-20261017/operator/migrate-turso.mjs` :

```sh
node /Users/leo/Dev/Education/coursely/data/recovery/production-readiness-20261017/operator/migrate-turso.mjs
```

Léo le lance personnellement dans Terminal, sans redirection ni journal de session. Il colle le jeton
de cette base dans la saisie masquée. Le script affiche la cible exacte, lit uniquement le catalogue,
refuse tout objet non système, puis demande **`MIGRER coursely-prod`**. Il relit le catalogue après
cette confirmation avant toute migration. Les onze SQL sont copiés dans le dossier opérateur et
vérifiés par leurs empreintes ; aucun `.env` n’est chargé, aucun fichier de jeton n’est créé. Les
requêtes authentifiées restent sur le hostname exact, en HTTPS, sans redirection. Après application,
les onze hashes et dates du journal Drizzle sont vérifiés. En cas d’erreur, aucun détail SDK ou
credential n’est affiché ; ne pas relancer aveuglément après une réponse perdue ou un échec.

Ce script a **14 tests locaux réussis**, dont une migration complète en mémoire ; aucune migration
distante n’a été lancée par l’agent. Il ne crée pas le premier enseignant et n’active pas la CI.
Le jeton Cloudflare Admin créé personnellement par Léo expire après sept jours ; après création de
`mds`, Léo devra le remplacer dans GitHub par **Editor sur `mds` seulement**, avant son expiration.
L’agent ne modifie aucun accès.

1. Léo ouvre personnellement `coursely-prod` dans son compte Turso et vérifie AWS Ireland et l’URL
   exacte ci-dessus. Dans sa console SQL, exécuter uniquement :

   ```sql
   SELECT type, name
   FROM sqlite_schema
   WHERE name NOT LIKE 'sqlite_%'
   ORDER BY type, name;
   ```

   Transmettre seulement la liste des objets et la confirmation de cible, pas de lignes métier.
   Zéro objet applicatif est attendu avant une migration neuve. Si des objets sont présents,
   examiner leur nature et le journal de migrations avant toute décision ; ne rien supprimer.

2. Après confirmation spécifique de création d’accès, générer un **jeton de cette seule base**,
   lecture/écriture, sans mode lecture seule et sans jeton de plateforme/organisation. Proposition
   d’expiration pour le jeton applicatif : **90 jours**, à valider par Léo et renouveler avant son
   échéance. Les unités en jours et l’option lecture seule sont documentées par
   [Turso](https://docs.turso.tech/cli/db/tokens/create). Le CLI n’étant pas installé ici, utiliser
   la fiche de connexion/jetons de la base ; aucune installation ni connexion supplémentaire par
   l’agent. Ne pas activer de plan payant ou de dépassement.
3. Copier directement le jeton dans le secret de dépôt GitHub `TURSO_AUTH_TOKEN` et le conserver
   dans le gestionnaire sécurisé de Léo. GitHub ne permettra pas de relire sa valeur ensuite.
   Saisir aussi `TURSO_DATABASE_URL` avec l’URL exacte fournie. Ne pas transmettre ces valeurs à
   l’agent et ne pas les mettre dans `.env`, une commande enregistrée ou un fichier de livraison.
4. Le même jeton de base peut être fourni temporairement à l’opérateur depuis le terminal privé
   de Léo ; aucun jeton d’organisation ou nouveau jeton opérateur n’est nécessaire. **Après** le
   contrôle de cible, le constat de base vide et l’autorisation de migration, utiliser la copie
   isolée vérifiée, puis un shell Bash privé avec cette saisie masquée :

   ```bash
   set +x
   export TURSO_DATABASE_URL='libsql://coursely-prod-nekxio.aws-eu-west-1.turso.io'
   read -r -s -p 'Jeton Turso de cette base : ' TURSO_AUTH_TOKEN
   printf '\n'
   export TURSO_AUTH_TOKEN
   pnpm exec tsx scripts/db-migrate.ts
   unset TURSO_AUTH_TOKEN TURSO_DATABASE_URL
   ```

   Ces commandes sont une procédure pour Léo, **non exécutée par l’agent**. Le répertoire doit
   être une copie propre des sources validées, sans fichier `.env` ou `.dev.vars` de démo. Ne pas
   utiliser `pnpm db:migrate`, qui charge le `.env` du checkout. Ne pas journaliser la session
   de saisie. Le script applique le journal 0000–0010 ; vérifier ensuite les onze hashes/entrées
   Drizzle avant le bootstrap enseignant. Aucun contenu de fixture n’est à importer.

GitHub : [Settings → Secrets and variables → Actions](https://github.com/Nekxio/Coursely/settings/secrets/actions),
onglet Secrets, puis **New repository secret** pour chaque nom. Les deux secrets Turso ne suffisent
pas au déploiement : `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET` et les variables ci-dessous restent
à préparer par saisie directe après accord. Les secrets runtime seront transmis à Cloudflare par
le seul job CI ; ne pas faire de `wrangler secret put` séparé, qui déploierait une version.

Dans **Settings → Secrets and variables → Actions** de `Nekxio/Coursely`, Léo devra saisir directement :

- Quatre secrets de dépôt : `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET`, `TURSO_DATABASE_URL`,
  `TURSO_AUTH_TOKEN`.
- Deux variables de cible : `CLOUDFLARE_ACCOUNT_ID=1f7361109db586cc5f7f3f7c8ea636e6` et
  `COURSELY_PRODUCTION_ORIGIN=https://mds.leohilaire-1f7.workers.dev`.
- **En dernier**, `COURSELY_PRODUCTION_ENABLED=true`, une fois la base et le bootstrap prêts et
  le premier push coordonné. Cette variable seule ne lance pas une CI ; le push suivant sur main
  peut déployer. Aucun environnement GitHub et aucune connexion Workers Builds à créer.

## Ordre impératif pour la base et le lancement

1. Dans les comptes déjà ouverts, confirmer Workers Free, le namespace et les quotas, puis vérifier
   la **base Turso dédiée fournie**, `coursely-prod` en AWS Ireland, avec l’URL exacte ci-dessus et
   sa compatibilité libSQL. Ne pas copier le prototype, une base locale, une fixture, un dump, des
   élèves ou un fichier `data/`. Ne pas choisir un upgrade ou activer les overages. Le nom et l’URL
   sont fournis ; la confirmation d’identité et de contenu reste nécessaire, pas son jeton en chat.
2. Contrôler cette cible en lecture seule avant toute écriture : identité de base, schéma et journal
   de migrations. Si elle contient des données applicatives, arrêter la procédure « base vide » et
   revalider la portée ; ne rien supprimer et ne pas la remplacer silencieusement.
3. Après validation de la cible et handoff sécurisé, exécuter l’opérateur existant depuis un checkout
   propre sans `.env` de démo : `pnpm exec tsx scripts/db-migrate.ts`, avec les variables Turso de
   la base choisie fournies de manière sécurisée. **Ne pas lancer `pnpm db:migrate` depuis le
   checkout courant** : cette commande charge son `.env`, qui n’a pas été lu et dont la cible est inconnue.
4. Pour une base neuve, appliquer **0000 à 0010**, dans l’ordre du journal. `0008` porte les workflows
   pédagogiques ; `0009_condemned_sue_storm.sql` crée OAuth/JWKS ; `0010_boring_skin.sql` ajoute
   l’unicité du consentement enseignant/client. Vérifier ensuite les onze entrées et les hashes du
   journal Drizzle. La CI ne migre pas. Ne pas réexécuter `db:fixtures` ni importer un compte de démo.
5. Après réussite des migrations, Léo utilise le bootstrap interactif ci-dessous. Le nom et l’adresse
   du premier enseignant sont saisis personnellement, sans les inventer. Conserver le HTML privé ;
   aucune URL d’invitation dans le chat. L’activation sur l’origine finale se fera après déploiement.
6. Une fois secrets/variables saisis, base migrée et cible validée, le parent prépare le commit
   complet et le push sur main. La CI doit réussir avant tout upload. Garder une seule mécanique,
   GitHub Actions ; ne pas activer Workers Builds en parallèle.

### Bootstrap prêt, sans invitation réelle créée par l’agent

Après le bilan de migration reçu, **ne pas relancer la migration**. La prochaine commande à lancer
personnellement dans Terminal est :

```sh
node /Users/leo/Dev/Education/coursely/data/recovery/production-readiness-20261017/operator/bootstrap-teacher.mjs
```

Le script demande le jeton Turso en saisie masquée, l’adresse et le nom du premier enseignant, puis
la confirmation exacte **`INVITER LE PREMIER ENSEIGNANT`**. Il vérifie d’abord les onze migrations
et l’absence de comptes, passkeys, sessions et invitations ; il refait le contrôle des compteurs
après confirmation. Il réutilise `issueInvitation` et `invitationDocument`, déjà testés dans le
projet : rôle `teacher`, usage unique, expiration 24 heures et lien sur `/activation#…` à l’origine
HTTPS finale. Ces fonctions n’utilisent pas `BETTER_AUTH_SECRET` ; aucune copie ou valeur de secours
de ce secret n’est demandée. La valeur stable enregistrée dans GitHub n’est pas modifiée.

Les fichiers privés sont créés uniquement à l’exécution personnelle dans
`data/recovery/production-readiness-20261017/operator/private-invitations/`, dossier 0700, fichiers
0600, ignorés par Git. Le script affiche le chemin du HTML, jamais le token ou le lien. **L’agent
ne doit pas lire, copier, inventorier ou inclure ces fichiers dans des rapports.** Si des données
d’accès sont déjà présentes, ou si une réponse/sauvegarde est perdue, arrêter et vérifier l’état ;
ne pas régénérer aveuglément une invitation. Le bootstrap a six tests locaux réussis, notamment
le refus d’un second bootstrap qui pourrait invalider la première invitation.

Ordre de lancement : migrations vérifiées → bootstrap personnel et HTML privé → préparation et
revue du commit isolé → push/PR explicitement vers main après autorisation → CI de PR avec activation
encore `false` → décision de première mise en ligne → activation `true` en dernier juste avant la
fusion autorisée vers main → CI du commit de main puis déploiement → contrôle HTTPS → ouverture
personnelle du HTML et enregistrement de la passkey sur le hostname final. Changer une variable
seule ne lance aucun workflow ; le déclenchement manuel actuel ne fait que les vérifications.
Rester dans les 24 heures de validité de l’invitation. Ne pas réutiliser une passkey localhost.

## Recette HTTPS après le premier déploiement

Vérifier d’abord que `/connexion` est disponible, les pages enseignantes restent privées et
`/mcp` sans jeton émet un challenge OAuth 401. Les deux découvertes publiques doivent répondre avec
l’origine et la ressource exactes : `/.well-known/oauth-protected-resource/mcp` et
`/.well-known/oauth-authorization-server/api/auth`. Une réponse 503 indique une configuration ou
une base non prête ; ne pas lancer le login Codex tant que ce contrôle échoue.

Léo ouvre son invitation privée, enregistre sa passkey sur le hostname final, puis vérifie connexion
et déconnexion. Les passkeys localhost de la démo ne sont pas réutilisées pour ce hostname.
Après accord de connexion persistante, exécuter volontairement dans son propre Codex :

```sh
codex mcp add coursely-distant --url https://mds.leohilaire-1f7.workers.dev/mcp
codex mcp login coursely-distant --oauth-client-registration dcr --scopes modules:read --no-browser
```

Le navigateur est choisi par Léo (Chrome/Chromium), sans Safari automatique. Il valide lui-même la
passkey et le consentement. La liste des modules d’une production vide sera normalement vide ;
ne pas importer les trois modules fictifs du test local pour modifier ce résultat. Vérifier ensuite
la révocation depuis Applications connectées, puis le refus ou la réauthentification au prochain
appel, tout en conservant la session enseignante. Aucun élève réel avant recette HTTPS complète.

## Preuves locales indépendantes de cette passe

- Le contrôle précédent a confirmé **719/719 sources** du manifeste de livraison intégré, avant
  les mises à jour documentaires. Après le correctif, les **480 sources, scripts, migrations et
  entrées CI/configuration** contrôlés correspondent exactement à la copie isolée utilisée pour
  les vérifications. Avant sa mise à jour, seuls le hook corrigé et son nouveau test différaient.
  Preuve durable : `data/recovery/production-readiness-20261017/delivery/validated-source.json`.
- Cette passe a exécuté **lint, types, les 490 tests unitaires de 46 fichiers, build et dry-run** :
  tous réussis ; le typage relève zéro erreur et zéro avertissement. Les neuf nouveaux cas couvrent
  les deux découvertes en 200/503 avec ou sans cookie, la conservation du CORS et du corps, l’absence
  d’hydratation de session par le hook et le cache d’un autre chemin `/.well-known/`.
  Les journaux et codes de sortie sont dans le dossier durable `delivery/` ci-dessus.
- Les deux scénarios navigateur de l’intégration et l’essai réel Codex local raconté par Léo restent
  des preuves antérieures ; ils n’ont pas été rejoués pour ce changement d’en-têtes. Rapport :
  `data/recovery/remote-mcp-20261017/delivery/integration-report.md`. Aucun nouveau scan de sécurité.
- Dry-run de la cible finale, sans upload ni credentials : **11 647 410 octets bruts / 2 303,20 Kio
  gzip**, 138 assets, plus gros fichier 971 079 octets. Aucun adaptateur libSQL Node, entrée de
  fixture/configuration secrète trouvé dans les entrées du bundle. Le moteur PDF reste inclus mais
  sa génération est navigateur. Le build conserve son avertissement de gros chunks client ; aucune
  dépendance ni configuration de build n’a été modifiée pour le masquer. Preuves durables :
  `delivery/worker-dry-run.log`, `delivery/bundle-summary.json` et `delivery/verification.json`.
- Les dépendances installées : Better Auth, passkey, API Key, MCP et OAuth provider **1.7.7** ;
  SDK stdio **1.32.1**, serveur HTTP **2.3.1**, adaptateur Cloudflare **8.0.0**, Wrangler **4.149.0**,
  Zod **4.6.5**. Aucune mise à jour ni installation de cette passe.
- Le bundle corrigé démarre sous workerd local : **six contrôles HTTP réussis**, dont les deux
  découvertes en 503 désormais `private, no-store`, sans cookie émis. La correction ne modifie que
  les deux chemins exacts du hook ; elle n’ajoute aucune authentification ni règle CORS. Les 200
  sont couverts au niveau du hook et les métadonnées par les tests existants ; les vrais 200 de
  découverte HTTPS avec la base finale restent à vérifier. Preuves avant/après durables :
  `delivery/worker-smoke-before.json` et `delivery/worker-smoke-after.json`. Le serveur temporaire
  54871 a été arrêté, sans toucher aux démos.
- Un 503 sans directive ne démontre pas une fuite ou un cache effectif : il n’est pas réutilisable
  par défaut selon [HTTP](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.1) et
  [Cloudflare](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#edge-ttl).
  Le correctif ferme l’écart de cohérence de la politique de cache, sans valider la recette distante.

Tous les chemins `delivery/` de cette section sont relatifs à
`data/recovery/production-readiness-20261017/`. Ce dossier est ignoré par Git et conserve aussi
`changes.patch`, le rapport `verification.json` et les opérateurs de vérification locale ; il ne
contient aucune valeur de credential de compte. Aucun workflow distant n’a été lancé.

## Limites gratuites et validations restant ouvertes

L’audit npm du 17 octobre relève **deux avis modérés, aucun élevé ou critique**. Le rapport est
conservé dans `data/recovery/production-readiness-20261017/delivery/dependency-audit.json`.

- `esbuild 0.18.20`, transitif de Drizzle Kit via `@esbuild-kit/esm-loader` : l’avis concerne la
  fonction serveur de développement `serve`, pas la seule compilation. Version corrigée : au
  moins 0.25.0. [Avis du mainteneur](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).
- `postcss-selector-parser 6.0.10`, transitif de Tailwind Typography : complexité quadratique de
  sélecteurs malveillants ; ici, usage de build sur les sources du projet. Version corrigée : au
  moins 7.1.6. [Avis du mainteneur](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf).

Ces deux dépendances sont classées développement et absentes des entrées du bundle Worker contrôlé.
L’application ne propose pas de parseur CSS public. Prévoir une mise à jour compatible des outils
parents ; aucune mise à jour ou override forcé n’a été appliqué. Le classement `devDependency` seul
n’est pas une preuve d’absence du Worker : le contrôle porte sur son metafile, contrairement au
moteur PDF qui reste embarqué.

La documentation officielle actuelle fixe Workers Free à **64 Mio non compressés**, **10 ms CPU
par requête**, 128 Mo de mémoire et une seconde de démarrage. Le package respecte le budget de
taille ; les CPU passkey/OAuth/JWT/SSR et le démarrage distant restent à mesurer lors de la recette.
Pas d’augmentation payante de CPU, de rendu PDF distant, de stockage ou de service OAuth externe.
[Limites Workers](https://developers.cloudflare.com/workers/platform/limits/).

Le plan Turso Free et les quotas Actions doivent encore être confirmés sur les comptes réels ;
aucune garantie de coût total nul ne découle du dry-run. Arrêter et examiner les optimisations si
Free ne convient pas, sans activer un abonnement. Les métriques de la première recette devront
relever CPU, erreurs `exceededCpu`/1102, ressources et consommation de quotas.
[Métriques Workers](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/),
[tarification Turso](https://turso.tech/pricing).
