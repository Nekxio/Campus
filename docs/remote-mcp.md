# MCP distant : connexion navigateur et droits enseignant

Cette fonctionnalité utilise le même Worker Coursely et la même base Turso que
l’application. La cible de production prévue reste `mds`, avec l’origine validée
dans `docs/production.md`. Aucun service OAuth externe n’est nécessaire.
Ce document décrit le candidat local ; il ne confirme aucun déploiement.

## Parcours

1. Ajouter l’URL `https://mds.leohilaire-1f7.workers.dev/mcp` dans Codex comme serveur
   Streamable HTTP. Cette adresse reste à vérifier lors de l’acceptation HTTPS.
2. Choisir l’authentification du serveur. Codex découvre le fournisseur et ouvre
   le navigateur. Une session absente ou une réauthentification demandée passe par
   `/connexion/application`, avec la passkey enseignant existante.
3. Sur `/autoriser`, vérifier le nom déclaré et l’identifiant du client, puis les
   seuls droits demandés. Le nom « Codex » n’est pas une preuve d’identité du client.
4. Autoriser ou refuser. Le retour va uniquement au callback loopback enregistré.
   Un refus conserve les autorisations qui auraient été accordées auparavant.
5. Retirer les droits dans **Applications connectées**, depuis le bas de la
   navigation enseignant. La confirmation ne ferme pas la session Coursely et ne
   supprime ni modules, ni notes, ni fichiers externes.

Exemple CLI, à exécuter volontairement après configuration et acceptation du service :

```sh
codex mcp add coursely-distant --url https://mds.leohilaire-1f7.workers.dev/mcp
codex mcp login coursely-distant --oauth-client-registration dcr
```

Le démarrage annonce seulement `modules:read`. Pour une demande de préparation
plus large, le CLI installé propose explicitement `--scopes` :

```sh
codex mcp login coursely-distant --oauth-client-registration dcr --scopes modules:read,modules:create,modules:update
```

Ajouter `modules:rubric` uniquement pour les barèmes ; ajouter
`corrections:read,corrections:propose` pour les propositions de correction.
`offline_access` est facultatif et décoché par défaut au consentement.
La priorité des scopes et l’interface exacte doivent être vérifiées sur le client
Codex utilisé. Aucune connexion réelle à Codex ni écriture dans son magasin de
credentials n’est faite par les tests du projet.

## Transports et outils

Le serveur stdio et ses huit outils sont conservés. Les clés agent locales ne
deviennent pas des sessions OAuth, et le MCP distant n’accepte pas ces clés.

| Outil distant            | Droits requis                                       |
| ------------------------ | --------------------------------------------------- |
| `get_import_context`     | `modules:read`                                      |
| `create_module_draft`    | `modules:read modules:create`                       |
| `update_module_draft`    | `modules:read modules:update`                       |
| `patch_module_draft`     | `modules:read modules:update`                       |
| `get_correction_context` | `modules:read corrections:read`                     |
| `propose_correction`     | `modules:read corrections:read corrections:propose` |

Un remplacement ou une suppression d’éléments de barème nécessite en plus
`modules:rubric`. La liste expose seulement les outils autorisés ; un appel
insuffisamment autorisé reçoit un challenge de scope. Le serveur réutilise les
contrats stricts, révisions, transactions et reçus de relance existants.
Il ne publie pas et n’accepte jamais une proposition à la place de l’enseignant.

`inspect_module_folder` et `bind_module_folder` restent **stdio uniquement**.
Le serveur distant n’importe aucun module filesystem et ne sait ni inventorier
le Mac, ni lire un document local, ni modifier `.coursely.json`. Ses commandes
utilisent les UUID métier et les révisions, sans paramètre `folder`.
Codex peut toujours lire des sources locales par ses outils locaux autorisés,
ou utiliser le MCP stdio pour conserver le lien au dossier sélectionné.

## Autorisation et limites

- Code d’autorisation et requête signée de consentement : 120 secondes.
- PKCE S256 obligatoire ; grants `authorization_code` et `refresh_token` seulement.
- JWT d’accès : 10 minutes ; signature, émetteur, audience exacte `/mcp`, expiration,
  session, rôle enseignant et consentement courant vérifiés à chaque requête.
- Refresh : 8 heures, rotation stricte sans fenêtre de réutilisation. Une session
  enseignant vivante reste nécessaire, même avec `offline_access`.
- La révocation dans l’application retire immédiatement le consentement et
  révoque les refresh associés. Le JWT nomme la ligne exacte de consentement :
  un nouvel accord après révocation ne réactive pas un ancien JWT.
- Le endpoint RFC 7009 du fournisseur peut révoquer un refresh. Un JWT autonome
  ne s’y révoque pas individuellement ; le retrait immédiat de l’ensemble des droits
  se fait dans Applications connectées. Un simple logout du client Codex ne
  remplace pas cette décision dans Coursely.
- Refresh et codes sont stockés hachés. Les clés de signature du plugin sont
  chiffrées avec le secret Better Auth existant. Aucun nouveau secret d’opérateur
  n’est requis et aucun token n’est transmis à un autre service.
- DCR public limité aux clients natifs, callbacks HTTP loopback, hôte et chemin
  exacts ; variation du port locale permise par RFC 8252. Aucun redirect externe,
  wildcard, fragment, credential dans l’URI ou source de clés distante.
- CIMD n’est pas annoncé : le transport DNS avec adresse épinglée exigé par le
  plugin n’est pas établi pour cette application Workers. DPoP n’est pas activé.
- Origines tierces refusées sur les écritures et appels MCP ; seule la navigation
  GET vers l’autorisation OAuth est admise depuis un client tiers. Consentement et
  révocation restent protégés par la session et l’origine ; corps OAuth/browser limités à 16 Kio, MCP à 256 000 octets et sortie
  à 4 Mio. P3 conserve 1 Kio pour activation et 64 Kio pour les passkeys.
- Les sessions de protocole et les abonnements SSE ne sont pas proposés. Le SDK
  traite les requêtes 2026-07-28 et le mode HTTP stateless 2025 ; aucun état de
  protocole n’est utilisé comme preuve d’autorisation.

## Installation et validation

Les dépendances ajoutées sont `@better-auth/mcp@1.7.7` et
`@better-auth/oauth-provider@1.7.7` (MIT), ainsi que
`@modelcontextprotocol/server@2.3.1` (Apache-2.0). Le SDK stdio 1.32.1 reste installé.
La fabrique d’authentification est désormais attendue : l’initialisation du
fournisseur termine avant les opérations sur la base et avant sa fermeture.

Les migrations `0009_condemned_sue_storm.sql` (OAuth) et `0010_boring_skin.sql`
(unicité du consentement par enseignant/client) sont générées **hors ligne**.
L’opérateur doit examiner et appliquer toutes les migrations en attente avant
d’utiliser ces routes sur une base configurée. Aucun test ne migre Turso et
aucune commande de production ne doit être lancée comme contrôle de routine.

Les tests unitaires exécutent passkey synthétique, fournisseur OAuth et base
SQLite fictive ; les tests navigateur utilisent une copie privée du projet et
un authentificateur WebAuthn virtuel. Ils ne chargent aucun `.env`, ne copient
pas les credentials, n’utilisent pas Safari et ne changent pas les données de
la démo existante. Les captures, rapports et patchs de reconstruction sont
conservés dans `data/recovery/remote-mcp-20261017/delivery/`.

Le 17 octobre, Léo a confirmé avec le vrai client Codex le parcours local sur données fictives :
passkey sur son appareil, consentement, lecture des modules puis révocation effective au prochain
appel. Le rapport d’intégration et ses preuves sont dans
`data/recovery/remote-mcp-20261017/delivery/integration-report.md`.
Restent l’acceptation sur l’origine HTTPS finale, le lecteur d’écran et la recette complète sur
appareil physique. Un build ou un dry-run local ne valide pas les ressources distantes ni les
limites CPU réelles. Les étapes de mise en service sont dans
[le point production du 17 octobre](production-readiness-2026-10-17.md).

Références vérifiées le 17 octobre 2026 :
[MCP autorisation](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http),
[MCP Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Better Auth MCP](https://better-auth.com/docs/plugins/mcp),
[Better Auth OAuth](https://better-auth.com/docs/plugins/oauth-provider).
