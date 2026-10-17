# Barème par sections — simplification validée le 15 octobre 2026

Le choix validé est un éditeur centré sur les sections, les critères et leurs points. Les maxima des
sections déterminent leur part dans le total, ensuite ramené sur 20. Les valeurs 60/35/20 ne
sont qu’un exemple de calcul ; aucun trio ni maximum n’est imposé. Un dossier seul, un dossier
et une soutenance ou tout autre ensemble de livrables sont possibles.

## Choix d’implémentation

- Les nouveaux barèmes vides utilisent le mode par sections. Hors Quiz, le maximum d’une section
  est la somme des maxima de ses critères. Les sections formatives restent hors note finale.
- Chaque ligne d’une section Quiz représente un quiz avec son maximum propre. Les scores sont
  normalisés, moyennés à poids égal, puis convertis sur le maximum de section choisi explicitement.
  La somme des nombres de questions ne fixe jamais le poids de la section.
- Le mode simple compile les maxima en une règle `weighted` existante, une composante par section,
  avec pleine précision. `sectionPoints.quizMaxima` conserve le mode d’édition et les maxima des
  sections Quiz dans le JSON de la règle. Aucun changement SQL ni nouvelle dépendance.
- La validation serveur vérifie les références Quiz, l’ensemble des sections notées et la cohérence
  entre maxima et poids. Une copie pédagogique remappe aussi les identifiants de cette métadonnée.
- Le retard existant reste calculé sur le projet /20, puis sa note pénalisée contribue à son maximum
  de section. Les absences, les refus/exemptions, les champs vides et les évaluations à revoir gardent
  leurs règles actuelles. Une modification du maximum de section Quiz marque aussi ses corrections
  à revoir sans toucher aux points.

## Interface et compatibilité

Le résumé du total est placé au-dessus des sections. Le tableau de critères existant, les groupes,
les échéances, Formsnap, la sauvegarde explicite et la conservation du brouillon sur 409 restent
actifs. Les libellés distinguent maximum des lignes Quiz, maximum retenu pour la section et total
du module. Le panneau latéral répétitif est retiré.

Les barèmes déjà configurés restent en mode compatible, avec leurs règles et tous leurs résultats
indépendants inchangés. La configuration existante est accessible par un dépliant. Un barème ayant
au plus un résultat peut prévisualiser le calcul par sections, puis l’adopter explicitement dans
le brouillon avant sauvegarde. Les barèmes à plusieurs résultats ne proposent aucun regroupement.
Le mode simple permet aussi de passer explicitement aux résultats indépendants en conservant
ses poids actuels. Aucune conversion n’est exécutée sur la démo utilisateur.

## Validation et coordination

Les tests couvrent dossier seul, sections multiples, quiz de maxima différents, retards de 0/1/5/6
jours, champs vides, absences, exclusion formative, anciens résultats indépendants, validation des
poids, persistance et copie indépendante. Les parcours navigateur utilisent des copies et bases
fictives séparées. Le serveur démo de Notation, ses filtres et ses fichiers d’export restent sous la
responsabilité de la tâche concurrente. Dans `domain/grading.ts`, ce lot ne modifie que le validateur ;
les types destinés à Notation restent sous la responsabilité de la tâche concurrente.

## Preuves finales

| Contrôle                                 | Résultat                                                        | Preuve locale                                                                |
| ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Suite unitaire et intégration            | 357 tests, 41 fichiers, réussis                                 | `/tmp/coursely-rubric-all-tests.log`                                         |
| Types application, Svelte et scripts     | 0 erreur, 0 avertissement                                       | `/tmp/coursely-rubric-check.log`                                             |
| Types navigateur                         | Réussite                                                        | `/tmp/coursely-rubric-browser-types.log`                                     |
| Formatage et ESLint                      | Réussite                                                        | `/tmp/coursely-rubric-lint.log`                                              |
| Parcours Chromium desktop et mobile      | 4/4, dont conservation du brouillon sur HTTP 409                | `/tmp/coursely-rubric-browser-confirmation.log`                              |
| Build Workers, copie sans secrets        | Réussite ; avertissement existant de taille de certains bundles | `/tmp/coursely-rubric-build.log`                                             |
| Détecteur Impeccable et Svelte autofixer | Aucune erreur ni suggestion                                     | `/tmp/coursely-rubric-impeccable.json`, `/tmp/coursely-rubric-*-svelte.json` |

Les captures finales sont dans `.playwright-mcp/rubric-points/final-confirmation/`, avec profils,
passkeys virtuelles et bases fictives isolés. Le contrôle clavier et les noms accessibles sont
couverts par ces parcours. Lecteur d’écran, appareil physique, HTTPS réel et recette Playwright
globale restent hors de cette vérification ciblée ; aucune conformité WCAG globale n’est revendiquée.
Le sidecar de design global est signalé obsolète par Impeccable ; sa régénération reste un travail
distinct. Le brief de la surface barème documente la décision et la revue de ce lot.

Aucun commit, déploiement, migration distante, donnée réelle ou lecture de secrets n’est inclus.
La démo utilisateur n’a pas été synchronisée ni modifiée par ce lot. Les métadonnées facultatives
du mode simple sont stockées dans le JSON des règles déjà existant ; aucune migration SQL ajoutée.
