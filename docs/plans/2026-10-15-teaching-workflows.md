# Cadrage enseignant validé — 15 octobre 2026

Ce plan applique le cadrage validé après le diagnostic. Il remplace les anciennes
règles contradictoires du plan du 12 octobre : module partagé entre classes, cumul brut des quiz,
remplacement implicite des éléments par le MCP et délai de conservation automatique supposé.
Le périmètre actuel est MyDigitalSchool. Les sources restent locales, les fichiers étudiants sur
Drive par liens. Aucun déploiement, migration distante, donnée réelle ou changement de service externe.

## Parcours et modèle

- Un module actif appartient à une seule classe. Une autre classe reçoit une copie indépendante du
  patrimoine pédagogique, sans étudiants, résultats, séances, dates ou échéances.
- Les identités annuelles restent distinctes. Des références publiques durables associent les liens
  existants à la publication revue et au contexte courant ; conserver une URL ne mélange pas les notes.
- La clôture manuelle confirme une année et le sort de chaque module : reprendre ou mettre de côté.
  Les données étudiantes de l'année sont supprimées ; aucun module ni fichier Drive n'est supprimé.
  Une mise de côté désactive le lien public et conserve le contenu privé. Aucun calendrier automatique.
- Les publications restent manuelles. Préparation, étudiants, corrections et commentaires restent privés.
  Supports, consignes, critères vierges et exercices/corrigés sélectionnés sont publics sans verrou de date.

## Calculs et corrections

- Une section Quiz comprend une ligne par quiz ; maximum libre égal au nombre de questions.
  Chaque score est normalisé, puis les quiz ont le même poids dans la moyenne de section.
- Sections et résultats multiples restent configurables ; aucune structure 15/25/60 imposée.
- Vide = en attente. Une modification numérique du barème conserve les points et marque les corrections
  concernées à revoir. Aucun score n'est complété, effacé ou tronqué automatiquement.
- Absences décidées manuellement ; absence injustifiée = zéro, rattrapage conservé.
  Projet non remis = décision explicite de refus, jamais déduit d'un champ vide.
- Retard : jours calendaires de Paris, week-ends et fériés inclus ; 1 à 5 jours = −1 point/jour sur le
  projet /20 ; au-delà de 5 jours = zéro. Les exceptions explicites sont conservées, avec plancher zéro.

## Agent et publication

- Les modifications MCP sont ciblées : omission = conservation, éléments rapprochés par ID/clé stable,
  suppressions explicitement nommées. Révisions, transactions, reçus et reprises identiques sont conservés.
- Les imports marquent visiblement le module « Brouillon à relire » et exposent un accès direct et les
  changements. Ils ne publient jamais et ne lisent pas eux-mêmes les documents du Mac.

## PDF

- Individuel : étudiant, classe/année, module ; sections, critères obtenus/maxima, sous-totaux, section /20,
  poids et contributions aux résultats configurés. Absences incluses ; aucun commentaire ni description.
- Classe : noms, colonnes des sections /20 avec poids, tous les résultats finaux ; aucun critère/commentaire.
- Conservation de la garde finale : données requises manquantes/invalides = export bloqué. Aucun PDF
  incomplet présenté comme définitif. Génération navigateur, polices locales et chargement différé conservés.

## Mise en œuvre

1. Adapter contrats, schémas et migration versionnée hors ligne ; conserver les données préexistantes.
2. Adapter services modules/publication et MCP ; compléter les écrans existants et les indicateurs.
3. Adapter calculs, révision des corrections et deux projections PDF privées.
4. Adapter clôture/reprise, copie indépendante, mise de côté et résolution des liens publics durables.
5. Tests synthétiques : confidentialité, omissions MCP, maxima quiz différents, retards 0/1/5/6 jours,
   modifications de barème, exports, pause/reprise, clôture et stabilité des liens. Puis lint, types,
   build dans une copie sans secrets et parcours locaux desktop/mobile selon les outils disponibles.

## Protections et validation

Les changements locaux déjà présents sont conservés. Authentification enseignant avant les lectures,
contrats Zod stricts, appartenance à la classe, origine et révisions restent contrôlés côté serveur.
Les anciens états multi-classes ne seront jamais convertis en supprimant des notes : ils doivent
être isolés ou signalés explicitement lors de leur adaptation. Les preuves finales distingueront
les contrôles passés, échoués et non exécutés. HTTPS réel, lecteur d'écran et appareil physique
ne seront pas présentés comme vérifiés par une simple émulation.

## État de l’implémentation et preuves

Les étapes 1 à 4 sont implémentées dans le workspace, en conservant les changements de design
préexistants. Aucun commit, déploiement, service externe ou migration de base existante n’est inclus.

| Périmètre                            | Fichiers principaux                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Contenu public et revue du brouillon | `domain/pedagogy.ts`, `StudentContentEditor.svelte`, `ModuleCourseContent.svelte`, `publications.ts` |
| Modifications MCP ciblées            | `domain/module-patch.ts`, `server/agent/patch.ts`, `scripts/mcp/operations.ts` et `server.ts`        |
| Calculs et résultats à revoir        | `domain/grade-calculation.ts`, `server/teaching/grading.ts`, `DetailedCorrectionDraft.svelte`        |
| Deux exports privés                  | `domain/student-export.ts`, `domain/grade-export.ts`, `client/student-grade-pdf.ts`, routes d’export |
| Copie et clôture annuelle            | `server/teaching/service.ts`, `annual.ts`, `AnnualConfirmation.svelte`, `AnnualModuleChoice.svelte`  |
| Identités publiques durables         | `db/public-links.schema.ts`, migration hors ligne `drizzle/0008_lucky_puppet_master.sql`             |

La suite locale comprend maintenant 329 tests sur 37 fichiers, tous réussis. Elle inclut les
reprises exactes d’anciens imports, la conservation du contenu public absent des anciens clients,
les suppressions MCP étrangères refusées et les accès aux deux exports avant décodage des identités.
Les guides d’import, publication, PDF et clôture reflètent ces contrats.

La recette Chromium a mis en évidence des défauts corrigés : action PDF disponible avant
l’initialisation de son gestionnaire client, option JSON manquante sur le formulaire annuel à
tableau imbriqué, et état vide affiché malgré les nouvelles consignes/grilles publiques. La pagination
du PDF individuel garde ensemble le total, le retard et les contributions d’une section.

La détection Tailwind est limitée explicitement à `src/` pour exclure les maquettes et les copies
générées, selon le [contrat Tailwind 4](https://tailwindcss.com/docs/detecting-classes-in-source-files#setting-your-base-path).
Dans la même recette locale, les quatre démarrages isolés sont passés à 6,3–11,3 secondes, contre
environ 60–80 secondes auparavant ; ce n’est pas une mesure de performance en production.

| Contrôle final                                                                    | Résultat                                          | Preuve locale temporaire                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Unitaire et intégration                                                           | 329/329, 37 fichiers                              | `/tmp/coursely-workflows-final-unit.log`                                                       |
| Types application/Svelte                                                          | 0 erreur, 0 avertissement                         | `/tmp/coursely-workflows-final-types.log`                                                      |
| Types scripts et tests navigateur                                                 | Réussite                                          | `/tmp/coursely-workflows-final-scripts.log`, `/tmp/coursely-workflows-final-browser-types.log` |
| Formatage et ESLint                                                               | Réussite                                          | `/tmp/coursely-workflows-final-lint.log`                                                       |
| Nouveaux parcours Chromium                                                        | 4/4 desktop et mobile                             | `/tmp/coursely-workflows-browser-confirm.log`                                                  |
| Régressions création/retry, correction/409 et publication                         | 6/6 desktop et mobile                             | `/tmp/coursely-workflows-browser-regressions.log`                                              |
| Construction Workers, adaptateur de production, copie sans secrets                | Réussite                                          | `/tmp/coursely-workflows-build-verified.log`                                                   |
| Worker compilé local : connexion, redirections, export privé et erreurs publiques | 6/6 réponses attendues                            | `/tmp/coursely-workflows-worker-http.json`                                                     |
| Svelte autofixer                                                                  | Aucune erreur ; suggestion de store typé vérifiée | `/tmp/coursely-workflows-svelte.json`                                                          |
| Détecteur Impeccable                                                              | Trois avis de styles existants, aucun bloquant    | `/tmp/coursely-workflows-impeccable.json`                                                      |

Les captures desktop/mobile, PDF fictifs et rapports Playwright sont conservés dans
`.playwright-mcp/browser-tests/workflows-confirm/` et `workflows-regressions/`, ignorés par Git.
Les captures ont été examinées en un passage puis une confirmation après corrections. Le PDF de
classe et les deux pages du PDF individuel ont aussi été rendus pour vérification visuelle.
Le formulaire annuel a été capturé en haut et en bas de son viewport, avec focus visible.

Les tests utilisent le Chromium installé sur le Mac, un profil temporaire, des passkeys virtuelles
et des bases fictives. La construction restaure l’adaptateur libSQL web de production ; les essais
UI utilisent une substitution limitée à la base locale isolée. Aucune donnée réelle, clé réelle,
installation, migration d’une base existante, publication distante ou déploiement n’a été effectué.
La migration `0008` reste à appliquer par l’opérateur avant usage de ces champs sur une installation
existante. HTTPS réel, passkey physique, droits Drive, lecteur d’écran, appareil physique et suite
Playwright complète restent hors de cette recette ciblée ; aucune conformité WCAG globale n’est revendiquée.
