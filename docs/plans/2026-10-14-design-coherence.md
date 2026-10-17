# Design et accessibilité — implémentation validée

Léo a validé les 14 compositions et autorisé leur implémentation le 14 octobre 2026. Les précisions calendrier sont intégrées : visuel avec points de séance, mois repliable sur téléphone. Le travail se fait dans le workspace GitButler. Aucune migration cloud, déploiement ou donnée étudiante réelle ne fait partie des vérifications.

# Plan de design retenu — 14 pages

Compositions choisies par Léo. Ce brief incorpore les précisions du calendrier et propose les corrections de la revue croisée. L’implémentation de ces compositions et des corrections a été autorisée par Léo.

## Règles partagées

luma, Inter, Lucide et composants existants ; contexte et retours cohérents ; actions explicites et nommées par portée ; point/commentaire indépendants ; aucun état de réussite inventé ; brouillons et aperçus retenus sur erreur/409. Pages publiques limitées au snapshot approuvé. Formulaires Formsnap/Superforms/Zod et règles de calcul/conservation inchangées.

## 1. Accueil

**Route :** `/`

**Tâche :** Retrouver la prochaine séance et ouvrir le bon travail.

**Composition :** Séance puis actions du module.

**Zones :** Prochaine intervention, Mes modules, Accès à la préparation, publication et notation.

**Action :** Préparer un module — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Composition compatible. Amendement confirmé : calendrier visuel avec points sur les jours de séance et mois repliable sur téléphone. Garder le bouton de préparation compact.

**Responsive et interaction :** Détail de prochaine séance et calendrier sur ordinateur ; mois fermé par défaut sur téléphone pour laisser les modules accessibles. Aucun choix de jour, agenda, détail supplémentaire ou échéance de remise.

**États à couvrir :** Sans séance future, Bibliothèque vide, Recherche sans résultat, Module associé à plusieurs classes.

**Protections :** Même source de séances que Classes et planning, classées selon Europe/Paris ; ne pas modifier les dates en les affichant. Repère de séance avec équivalent textuel et légende.

## 2. Classes

**Route :** `/enseignant/classes`

**Tâche :** Gérer la liste commune et les modules de la classe annuelle.

**Composition :** Vue de travail de la classe.

**Zones :** Classe et année, Étudiants, Modules associés, Import avec aperçu.

**Action :** Ajouter un étudiant — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Composition compatible avec les accès aux modules et au planning. Les deux déclencheurs Ajouter un étudiant doivent ouvrir le même formulaire et conserver le même brouillon.

**Responsive et interaction :** Liste dominante et modules voisins sur ordinateur ; raccourcis Étudiants/Modules sur téléphone pour ne pas parcourir toute la liste.

**États à couvrir :** Classe vide, Import invalide et doublons, Dialogues modifiés puis fermés, Année en lecture seule.

**Protections :** Classe et année restent identifiables. Import avec aperçu ; erreurs et doublons avant validation. Fermeture de dialogue modifié protégée ; année archivée en lecture seule.

## 3. Création du module

**Route :** `/enseignant/modules/nouveau`

**Tâche :** Créer un brouillon réutilisable sans classe obligatoire.

**Composition :** Fiche et résumé adjacent.

**Zones :** Informations, Préparation privée, Liens étudiants, Classes et planning.

**Action :** Créer le brouillon — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Défaut de maquette : action Créer le brouillon hors du premier écran, contrairement à édition et barème. Copie corrigée proposée avec action en bas à droite ; colonnes et quatre sections conservées.

**Responsive et interaction :** Formulaire et aide adjacents sur ordinateur ; une colonne et action proche du travail sur mobile, avec place réservée si elle reste visible. La page réelle conserve son défilement.

**États à couvrir :** Nom manquant, URL invalide, Réponse de création perdue, Brouillon après navigation annulée.

**Protections :** Pas de classe obligatoire. Aide réservée à la création. Erreurs vers le champ exact et sa section ; brouillon retenu et reçu de nouvelle tentative conservé. Aucun faux état de succès.

## 4. Édition du module

**Route :** `/enseignant/modules/[moduleId]`

**Tâche :** Retrouver le module et préparer son contenu sans perdre le brouillon.

**Composition :** Contexte et travail séparés.

**Zones :** Nom du module permanent, Quatre sections libres, Navigation Publication/Barème/Grille, Échéances depuis le planning.

**Action :** Enregistrer le module — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Composition cohérente avec le barème. Conserver les mêmes noms de sections et repères de sauvegarde que la création. Les destinations Barème/Publication/Grille restent séparées de l’enregistrement.

**Responsive et interaction :** Contexte permanent, section de travail et action explicite en bas. Les panneaux latéraux se replacent dans un ordre utile sur mobile sans masquer le dernier champ.

**États à couvrir :** Brouillon modifié, Conflit 409, Sauvegarde échouée, Audience des notes de séance, Retrait local d’un lien.

**Protections :** Nom du module sur toutes les sections ; classe/année conservées lors des retours utiles. Liens et notes de séance précisent leur audience. Brouillons et aperçu retenus sur erreur/409.

## 5. Barème et calculs

**Route :** `/enseignant/modules/[moduleId]/bareme`

**Tâche :** Définir critères, groupes, calculs et échéances sans changer les points enregistrés.

**Composition :** Travail par groupe avec bilan.

**Zones :** Évaluations, Critères et groupes, Règles et résultats, Dates et consignes de remise.

**Action :** Enregistrer le barème — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Composition compatible : table de critères, calculs et dates à proximité, action cohérente avec l’édition.

**Responsive et interaction :** Table sur ordinateur ; groupes distincts et champs lisibles sur téléphone. Accès Échéances facile à retrouver depuis le planning. Le retour respecte sa provenance.

**États à couvrir :** Critère incomplet, Poids invalides, Barème déjà utilisé, Points dépassant le nouveau maximum, Conflit 409.

**Protections :** Points entiers, maximums dans les descriptions Formsnap, aucune réduction des points bruts stockés. Calculs existants et affichage final à une décimale ; erreurs et 409 retenus.

## 6. Grille de notes

**Route :** `/enseignant/notation`

**Tâche :** Voir la classe entière puis corriger un étudiant dans le bon contexte.

**Composition :** Grille et bilan adjacent.

**Zones :** Module, classe et année, Export PDF entier avant filtres, Résultats par étudiant, Bilan de la sélection.

**Action :** Ouvrir la correction — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Grille et bilan adjacent conservent grid-split. Le PDF reste sous les sélecteurs et avant les filtres. La zone de bilan ne doit pas être dupliquée comme une seconde commande d’export.

**Responsive et interaction :** Sur téléphone, la sélection indique clairement où ouvrir son bilan/correction. Les filtres sont près de la liste et leur compteur est annoncé discrètement.

**États à couvrir :** Résultats incomplets, Recherche vide, Absences, PDF bloqué, Retour depuis correction.

**Protections :** Export de toute la classe, résultats enregistrés et complets requis ; pas d’export du sous-ensemble filtré, pas de moyenne annuelle. Retours depuis correction contextualisés.

## 7. Correction détaillée

**Route :** `/enseignant/notation/[contextId]/[studentId]`

**Tâche :** Corriger une évaluation et garder le bilan, l’étudiant et la portée de sauvegarde visibles.

**Composition :** Contexte et bilan actuels.

**Zones :** Étudiant, classe, module et évaluation, Groupes de critères, Bilan bas sur ordinateur, Commentaire et historique séparés.

**Action :** Enregistrer Projet — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Contexte et bilan actuels restent compatibles avec la grille et les propositions. Les panneaux peuvent défiler à l’intérieur sur ordinateur sans cacher les actions ni le contexte.

**Responsive et interaction :** Bilan inférieur stable sur ordinateur ; sur téléphone, éviter les défilements concurrents et maintenir une action de portée claire avec le clavier ouvert.

**États à couvrir :** Vide distinct du zéro, Absence avec points conservés, Critère retiré, Conflit 409, Brouillons points/commentaire distincts.

**Protections :** Sauvegarde de l’évaluation explicite et commentaire semestriel indépendant. Vide distinct de zéro, quatre statuts, points conservés en absence. Historique et diagnostics accessibles ; brouillons/409 retenus.

## 8. Propositions privées

**Route :** `/enseignant/propositions`

**Tâche :** Comparer les points et décider séparément sur le commentaire privé.

**Composition :** Comparaison et contexte voisin.

**Zones :** Enregistré / Proposé / Retenu, Statut après validation, Impact sur les résultats, Commentaire à examiner.

**Action :** Valider les points — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Comparaison et contexte voisin compatibles avec correction. La maquette tronque la zone du commentaire : elle devra défiler ou se développer. La reprise du texte doit rester près du texte complet examiné.

**Responsive et interaction :** Enregistré / Proposé / Retenu gardent des colonnes nommées. Bilan inférieur et décisions visibles sur ordinateur ; comparaison lisible et flux adapté sur téléphone.

**États à couvrir :** Proposition périmée, 409 et saisies conservées, Commentaire long, Refus des points avec décision de commentaire distincte, Proposition suivante.

**Protections :** Décisions points/commentaire indépendantes ; pas de validation globale implicite. Proposition périmée bloquée, remise/retard courants préservés, brouillon retenu sur 409. Aucun commentaire de critère ajouté.

## 9. Publication

**Route :** `/enseignant/modules/[moduleId]/publication`

**Tâche :** Examiner la projection exacte de la classe avant une publication volontaire.

**Composition :** Sections et aperçu existants.

**Zones :** Module, classe et année, Sections de vérification, Aperçu privé partagé, Version et décision.

**Action :** Mettre à jour la publication — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Composition choisie conservée. L’aperçu simplifié de la maquette n’est pas encore fidèle au cours étudiant choisi : il manque le rappel d’échéance et ne montre que trois des cinq sections.

**Responsive et interaction :** Contrôles de vérification distincts de l’aperçu. Dans ce dernier, reprendre le rendu public partagé, y compris en-tête, objectifs, rappel d’échéance et cinq panneaux. Vérifier aussi sa version mobile.

**États à couvrir :** Brouillon modifié, Informations de module modifiées, 409 avec aperçu conservé, Dépublication, Contexte archivé.

**Protections :** Sections = navigation, aucune coche de validation supposée. Changements titre/description/objectifs signalés. Publier la version réellement examinée ; 409 et reprise perdue conservent aperçu et commande.

## 10. Fin d’année et historique

**Route :** `/enseignant/classes/annees`

**Tâche :** Choisir l’année puis consulter les PDF et comprendre archive ou purge.

**Composition :** Historique et conservation séparés.

**Zones :** Année explicitement sélectionnée, PDF et historique, Données supprimées et durables, Archive et purge distinctes.

**Action :** Examiner le dossier — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Historique et conservation séparés restent dans un seul dossier annuel. La colonne secondaire ne doit pas atténuer la lecture de ce qui est supprimé et conservé avant une purge.

**Responsive et interaction :** Historique/PDF dominants, conservation proche et archive/purge distinctes. Sur téléphone, conséquences avant les actions ; la confirmation répète le périmètre exact.

**États à couvrir :** Aucune année choisie, Année active, Année archivée, Données purgées, Confirmation exacte et annulation, Ancienne relance.

**Protections :** Le millésime de démonstration est un état après sélection : aucune année préchoisie à l’ouverture. Purge manuelle un an après la fin réelle de l’année scolaire ; barème actuel, aucune archive figée inventée.

## 11. Classe publique

**Route :** `/classes/[classId]`

**Tâche :** Trouver les cours publiés pour sa classe, sans compte étudiant.

**Composition :** Classe puis liens des cours.

**Zones :** Nom de classe et année, Modules publiés, Résumé et accès au cours, État vide utile.

**Action :** Ouvrir le cours — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** En-tête de classe et titres de cours actionnables cohérents avec la lecture publique. Garder l’accès sans compte étudiant et les seuls modules effectivement publiés.

**Responsive et interaction :** Liste simple, titres longs repliables et liens suffisamment grands sur téléphone. Le retour depuis un cours existe seulement tant que l’annuaire est encore disponible.

**États à couvrir :** Aucun cours publié, Titre très long, Classe supprimée, Service indisponible.

**Protections :** Aucune identité étudiante ou note. Classe jamais publiée : état vide générique sans identité inédite. Après suppression annuelle, annuaire retiré ; publications de contexte conservées selon le contrat.

## 12. Cours étudiant

**Route :** `/modules/[contextId]`

**Tâche :** Trouver support, consigne, échéance et récapitulatif, y compris après une absence.

**Composition :** Échéance courte avant les onglets.

**Zones :** Student-tabs : un panneau, Documents nommés, Prochaine échéance et projet, Toutes les dates de remise, Récapitulatif et à faire.

**Action :** Ouvrir le PDF — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Le rappel d’échéance avant les onglets répond au problème mobile relevé dans l’audit. Le rendu doit rester celui que Publication permet d’examiner.

**Responsive et interaction :** Un seul panneau actif et cinq sections conservées ; les trois noms de la maquette sont une simplification visuelle, pas une suppression de fonctions. Toutes les remises restent dans leur panneau.

**États à couvrir :** Sans documents dans une section, Plusieurs échéances, Notes de séance absentes, Classe retirée avec publication conservée, Lien 404 et service temporaire.

**Protections :** Dates Paris, titre/description/objectifs réels, documents nommés et liens extérieurs connus. Pas de brouillon, roster, note ou commentaire privé. 404 aide à vérifier/redemander le lien ; indisponibilité temporaire distincte.

## 13. Connexion

**Route :** `/connexion`

**Tâche :** Ouvrir son espace enseignant avec la clé d’accès existante.

**Composition :** Accès vertical avec reprise visible.

**Zones :** Colonne verticale, Une action de clé d’accès, État et erreur près du bouton, Activation par invitation.

**Action :** Me connecter — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Composition verticale conservée. Défaut avéré de maquette : texte du bouton à 2,29:1. Une copie corrigée rétablit le bouton primaire luma et un contraste mesuré de 17,93:1.

**Responsive et interaction :** Action unique et statut proche ; même colonne et mêmes repères que l’activation. Reprendre le vrai Button existant, sans la règle de style des onglets qui a altéré cette maquette.

**États à couvrir :** Préparation, Confirmation appareil, Annulation, Appareil incompatible, Session expirée.

**Protections :** Confirmation appareil, annulation, incompatibilité et session expirée distinctes ; relance explicite. Clés d’accès, origine stable et destination fixe conservées ; aucun nouveau canal d’accès.

## 14. Activation

**Route :** `/activation`

**Tâche :** Vérifier l’invitation, créer la clé et ouvrir automatiquement son espace.

**Composition :** Étapes compactes et état détaillé.

**Zones :** Identité readonly, Invitation → clé → accueil, Fragment retiré, Statut et reprise.

**Action :** Créer ma clé d’accès — uniquement dans sa portée métier existante.

**Raccord retenu / ajustement proposé :** Étapes compactes compatibles avec la connexion verticale. La progression reste informative ; éviter la répétition Invitation → clé → accueil en deux endroits.

**Responsive et interaction :** Identité readonly puis action et statut à proximité. Une colonne responsive ; erreurs et reprise restent visibles au même endroit.

**États à couvrir :** Invitation valide, Invitation expirée ou absente, Préparation, Demande appareil, Échec et reprise, Ouverture automatique.

**Protections :** Invitation dans le fragment puis retirée ; aucun token dans les vues ou journaux. Invitation absente/expirée, confirmation appareil et reprise distinguées. Pas de nouvelle inscription, mot de passe ou compte étudiant.

## Autorisation et raccords validés

Les harmonisations de la revue finale ont été retenues. Elles gardent les compositions choisies ; les copies corrigées documentent précisément la création et la connexion. Le calendrier visuel/repliable est confirmé. Léo a explicitement autorisé les modifications du code.

La vérification des régressions aura lieu sur l’application implémentée, avec les composants réels et les états métier, sans migration cloud, déploiement ou données étudiantes réelles.

---

# Revue finale des choix Coursely

Les **14 choix de composition et les deux précisions du calendrier** sont reçus. Ils sont globalement cohérents avec luma, Inter, Lucide et les tâches de Coursely. Les différences entre espace enseignant, lecture publique et accès sont utiles ; elles n’imposent pas un layout identique partout.

**Les maquettes ne doivent pas être portées telles quelles.** La revue relève deux défauts concrets de maquette et quatre raccords ou protections à traiter. La revue des maquettes a été conduite en lecture seule, avant l’autorisation d’implémenter. Les vérifications sur l’application et les limites de leur portée sont consignées en fin de tâche.

Les références retenues, y compris les deux copies corrigées et le calendrier final, sont dans `.impeccable/mocks/design-coherence-20261014/`. Les originaux du choix sont conservés.

## Les 14 choix retenus

| Page                      | Composition retenue                                                 | Raccord ou protection                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accueil                   | Séance puis actions du module + calendrier visuel, repliable mobile | Composition compatible. Amendement confirmé : calendrier visuel avec points sur les jours de séance et mois repliable sur téléphone. Garder le bouton de préparation compact.                                |
| Classes                   | Vue de travail de la classe                                         | Composition compatible avec les accès aux modules et au planning. Les deux déclencheurs Ajouter un étudiant doivent ouvrir le même formulaire et conserver le même brouillon.                                |
| Création du module        | Fiche et résumé adjacent                                            | Défaut de maquette : action Créer le brouillon hors du premier écran, contrairement à édition et barème. Copie corrigée proposée avec action en bas à droite ; colonnes et quatre sections conservées.       |
| Édition du module         | Contexte et travail séparés                                         | Composition cohérente avec le barème. Conserver les mêmes noms de sections et repères de sauvegarde que la création. Les destinations Barème/Publication/Grille restent séparées de l’enregistrement.        |
| Barème et calculs         | Travail par groupe avec bilan                                       | Composition compatible : table de critères, calculs et dates à proximité, action cohérente avec l’édition.                                                                                                   |
| Grille de notes           | Grille et bilan adjacent                                            | Grille et bilan adjacent conservent grid-split. Le PDF reste sous les sélecteurs et avant les filtres. La zone de bilan ne doit pas être dupliquée comme une seconde commande d’export.                      |
| Correction détaillée      | Contexte et bilan actuels                                           | Contexte et bilan actuels restent compatibles avec la grille et les propositions. Les panneaux peuvent défiler à l’intérieur sur ordinateur sans cacher les actions ni le contexte.                          |
| Propositions privées      | Comparaison et contexte voisin                                      | Comparaison et contexte voisin compatibles avec correction. La maquette tronque la zone du commentaire : elle devra défiler ou se développer. La reprise du texte doit rester près du texte complet examiné. |
| Publication               | Sections et aperçu existants                                        | Composition choisie conservée. L’aperçu simplifié de la maquette n’est pas encore fidèle au cours étudiant choisi : il manque le rappel d’échéance et ne montre que trois des cinq sections.                 |
| Fin d’année et historique | Historique et conservation séparés                                  | Historique et conservation séparés restent dans un seul dossier annuel. La colonne secondaire ne doit pas atténuer la lecture de ce qui est supprimé et conservé avant une purge.                            |
| Classe publique           | Classe puis liens des cours                                         | En-tête de classe et titres de cours actionnables cohérents avec la lecture publique. Garder l’accès sans compte étudiant et les seuls modules effectivement publiés.                                        |
| Cours étudiant            | Échéance courte avant les onglets                                   | Le rappel d’échéance avant les onglets répond au problème mobile relevé dans l’audit. Le rendu doit rester celui que Publication permet d’examiner.                                                          |
| Connexion                 | Accès vertical avec reprise visible                                 | Composition verticale conservée. Défaut avéré de maquette : texte du bouton à 2,29:1. Une copie corrigée rétablit le bouton primaire luma et un contraste mesuré de 17,93:1.                                 |
| Activation                | Étapes compactes et état détaillé                                   | Étapes compactes compatibles avec la connexion verticale. La progression reste informative ; éviter la répétition Invitation → clé → accueil en deux endroits.                                               |

## Six points de revue

### R01 — défaut de maquette confirmé

Texte du bouton Me connecter à 2,294:1 sur son fond, en raison d’une règle de style tabs appliquée au conteneur.

**Proposition :** Reprendre le Button primaire luma ; copie hors projet corrigée à 17,928:1 et arrondi rétabli.

**État :** copie corrigée vérifiée ; application inchangée.

### R02 — défaut de maquette confirmé

Footer de création commence à y=952 dans un premier écran de 900 px, alors que les actions édition/barème sont visibles en bas.

**Proposition :** Même repère d’action en bas à droite et portée explicite ; défilement réel et réserve pour focus/clavier. La copie corrigée place le bouton entre y=838 et y=882.

**État :** copie corrigée vérifiée ; application inchangée.

### R03 — incohérence de représentation

L’aperçu choisi est simplifié et n’inclut pas le rappel d’échéance avant les onglets du cours choisi ; trois sections illustrées contre cinq fonctions existantes.

**Proposition :** Partager le renderer public complet ; préserver les cinq sections et vérifier le rendu mobile dans l’aperçu. Les contrôles de publication peuvent garder leur organisation propre.

**État :** harmonisation nécessaire avant implémentation.

### R04 — risque d’accessibilité et de décision

Le commentaire des propositions est tronqué par la zone de premier écran. Copier overflow hidden rendrait une partie du texte et une action inaccessibles.

**Proposition :** Défilement interne accessible sur ordinateur, flux adapté sur téléphone, texte complet près de sa décision ; commentaires et points restent indépendants.

**État :** protection nécessaire dans l’implémentation.

### R05 — risque mobile réduit par choix confirmé

Calendrier entièrement visible repousse la bibliothèque sur téléphone.

**Proposition :** Mois repliable choisi par Léo et calendrier seulement visuel avec points de séance ; pas de sélection de jour, détail supplémentaire, agenda ou remise.

**État :** périmètre confirmé ; maquette dédiée vérifiée.

### R06 — risque de hiérarchie et de conservation

Conservation en colonne secondaire et millésime de démonstration déjà sélectionné pourraient être interprétés comme un comportement de l’application.

**Proposition :** Un seul dossier, aucune année préchoisie, conséquences avant confirmation exacte. Rappel du délai choisi ; annuaire retiré après suppression de classe, cours de contexte conservé selon le contrat.

**État :** règles explicites à conserver dans l’implémentation.

Le texte courant doit atteindre 4,5:1 ; le défaut du bouton Connexion concerne uniquement la maquette. [Critère de contraste du texte — W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). La copie corrigée dépasse ce seuil pour ce bouton, ce qui ne certifie pas l’accessibilité de toute une page.

## Cohérence entre parcours

| Parcours / règle                    | Conclusion                              | Condition                                                                                                                                                            |
| ----------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation enseignante              | Compatible sous condition               | Même shell, noms de destinations et contexte module/classe/année ; provenance des retours conservée. Les liens # des maquettes ne sont pas des routes à recopier.    |
| Création / édition / barème         | À harmoniser                            | Quatre sections communes, nom du module permanent et repère d’action cohérent. Correction R02 proposée.                                                              |
| Grille / correction / propositions  | Compatible sous condition               | grid-split, bilan inférieur et comparaison inline conservés ; calculs/points et décisions indépendantes intacts. Protection R04.                                     |
| Publication / cours étudiant        | À harmoniser                            | Renderer, projection et cinq sections partagés ; rappel d’échéance identique dans aperçu et lecture. Correction R03.                                                 |
| Annuaire / purge / cours retenu     | Compatible sous condition               | La suppression annuelle retire l’annuaire et son retour ; une publication de contexte retenue ne doit pas dépendre de ce lien.                                       |
| PDF / historique                    | Compatible                              | Export entier après scope et avant recherche ; résultats enregistrés, barème actuel, aucun export provisoire ni moyenne annuelle.                                    |
| Conservation annuelle               | Compatible sous condition               | Un an après la fin réelle de l’année scolaire, puis purge manuelle et revue explicite. Aucun calendrier de purge inventé.                                            |
| Calendrier / planning               | Périmètre confirmé                      | Repère visuel des séances déjà planifiées, affichées selon Europe/Paris ; mois repliable mobile ; pas de deuxième planning modifiable.                               |
| Connexion / activation              | Compatible après correction de maquette | Colonne verticale et une action ; statuts distincts. R01 corrigé dans une copie ; pas de nouveau canal.                                                              |
| Accessibilité / responsive / thèmes | Validation réelle à venir               | Les maquettes sont fixes et majoritairement claires. Reflow, clavier, focus, textes, thème choisi, erreurs et compteur live doivent être vérifiés sur la future app. |
| Données publiques / privées         | Compatible sous condition               | Projection publique existante et allowlist strictes conservées ; calendrier sans identité étudiante, score ou commentaire.                                           |

## Socle d’accessibilité implémenté

Les corrections communes relevées dans l’audit ont été implémentées : contraste du focus et des petits textes, indication visible du thème sélectionné, annonce du compteur filtré, liens d’erreur ciblant le vrai champ et fermeture mobile au confort de 44 px. Les layouts conservent labels/descriptions/erreurs Formsnap, ordre DOM cohérent, retours de focus des dialogues, brouillons sur erreur/409 et mouvement réduit.

Ne pas copier les hauteurs fixes, overflow hidden, champs simplifiés, liens fictifs ou noms de démonstration des sketches. Pour correction/propositions sur ordinateur, garder les zones internes défilantes et le bilan visible ; sur téléphone, conserver un défilement compréhensible et le focus visible avec le clavier.

## Calendrier confirmé

Calendrier simplement visuel, un point sur les jours de séance. Mois repliable sur téléphone. Pas de sélection de jour, détail supplémentaire, agenda, échéance de remise ou édition. Une équivalence textuelle et une légende accompagnent les points. Le mois se replie/s’ouvre au clavier et laisse le contexte principal accessible.

Le composant [Calendar shadcn-svelte](https://shadcn-svelte.com/docs/components/calendar) repose sur Bits UI et @internationalized/date, déjà présents. Le mode readonly est disponible dans [Bits UI Calendar](https://www.bits-ui.com/docs/components/calendar) et confirmé dans les types installés de Bits UI 2.19.5. Aucune bibliothèque d’agenda supplémentaire n’est nécessaire. Le composant UI a été ajouté avec le CLI shadcn-svelte, sans nouvelle dépendance et sans remplacer les composants existants.

## Conservation et données

Les choix conservent la séparation privé/public : pas de roster, note, correction ou commentaire dans le cours étudiant. Le calendrier utilise les séances prévues, sans identité étudiante. Classes et résultats restent conservés selon le délai choisi d’un an après la fin réelle de l’année scolaire, avec purge manuelle et confirmation exacte ; modules/préparation/rubriques/calendriers durables suivent les règles existantes. Une archive ne fige pas un barème distinct. Aucun transfert externe nouveau ni promesse de conformité juridique n’est introduit dans ce brief.

## Preuves et limites

- Les 14 réponses uniques sont conservées dans answers.json ; aucune réponse n’a été supposée.
- Les 14 maquettes choisies ont été capturées et examinées dans leur frame : 12 premières vues 1440×900 et deux lectures publiques 390×844. Données de géométrie et captures dans selected-review/.
- Deux copies corrigées vérifiées : bouton Connexion de 2,29:1 à 17,93:1 ; bouton de création visible à y=838–882 dans le frame de 900 px.
- Maquette du calendrier final contrôlée à 1440, 390 et 320 px ; contrôle clavier du repli sur mobile, calendrier visible sans débordement dans son état ouvert.
- L’audit initial de l’app reste distinct : 112 rendus clair/sombre, source et parcours contrôlés. Cette revue n’est pas un nouveau test des futurs layouts dans l’app.
- Vérification de l’implémentation : vrais composants et données fictives de test, thèmes clair/sombre, reflow mobile/desktop, clavier, noms/roles, erreurs/409 et parcours métier. Zoom réel, lecteur d’écran, appareil physique/clavier mobile et performances réelles restent à vérifier ; aucune certification WCAG ou RGPD n’est annoncée.

## Compte rendu d’implémentation

Les 14 compositions sont implémentées dans le workspace GitButler. Les références et la revue de maquettes ci-dessus décrivent les choix avant développement ; leur état historique ne décrit pas une limitation de l’implémentation actuelle.

| Page               | Résultat implémenté                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accueil            | Prochaine séance, calendrier mensuel visuel shadcn-svelte et modules ; point et équivalent textuel pour les jours de séance ; mois replié sur téléphone.  |
| Classes            | Liste de travail et modules voisins ; accès locaux Étudiants/Modules sur mobile ; brouillons de dialogue conservés ou abandon confirmé.                   |
| Création du module | Quatre sections, aide adjacente réservée à la création et action explicite Créer le brouillon.                                                            |
| Édition du module  | Nom du module permanent, contexte de classe, quatre sections et liens Publication/Barème/Notation ; sauvegarde près du travail.                           |
| Barème             | Groupes et critères séparés du bilan de calcul ; sauvegarde cohérente avec le module ; accès aux échéances de la classe et retour à la section d’origine. |
| Grille             | Sélecteurs puis PDF de la classe entière avant filtres ; grille et bilan adjacent ; compteur annoncé et étudiant sélectionné conservé au retour.          |
| Correction         | Contexte et résumé existants ; travail borné sur ordinateur, flux naturel sur téléphone ; accès au barème avec son contexte.                              |
| Propositions       | Comparaison Enregistré/Proposé/Retenu et contexte voisin ; commentaire complet examiné avant reprise ; décisions points/commentaire indépendantes.        |
| Publication        | Cinq sections de vérification et renderer public partagé ; identité modifiée signalée ; aperçu défilant et décision explicite.                            |
| Fin d’année        | PDF/historique et conservation séparés ; conséquences avant les actions mobiles ; aucune année automatiquement choisie ; accords des compteurs.           |
| Classe publique    | Classe et année puis liens explicites vers les cours publiés.                                                                                             |
| Module public      | Rappel d’échéance avant les cinq onglets ; mêmes contenus et composition que l’aperçu.                                                                    |
| Connexion          | Accès vertical avec état, action de connexion et aide de reprise visibles.                                                                                |
| Activation         | Trois étapes compactes, identité d’invitation fixe, état détaillé et aide proche de l’action.                                                             |

Les corrections transversales portent sur le contraste des textes secondaires, le focus solide dans les deux thèmes, les bordures des champs, l’indication du thème choisi, les cibles tactiles, les liens d’erreur et la navigation contextualisée. Les états invalides et cochés des contrôles conservent leur traitement spécifique.

### Revue indépendante et corrections finales

La revue complète des 56 captures des 14 écrans a confirmé les compositions et demandé quatre corrections, appliquées dans un même lot. Le verdict indépendant sur ce lot les classe toutes résolues et donne `ship` au périmètre F1–F4 ; il ne revendique pas un second audit complet des 14 pages :

- F1 : sélection Clair/Sombre/Système fondée sur `aria-checked`, sans dépendre des attributs du tooltip.
- F2 : classe et contexte validés transmis entre module, barème, publication et notation ; retour à la section d’origine et ancre d’échéances de la classe.
- F3 : textes réservés aux lecteurs d’écran rattachés au conteneur de l’aperçu ; document Publication de 1 511 à 988 px à viewport 1 440 × 900, avec défilement interne conservé. Aucun masquage global du débordement.
- F4 : noms et adjectifs accordés dans les compteurs annuels et les reçus.

La classe ajoutée au DTO privé du barème sert aux retours validés ; les réponses MCP gardent leur projection et leur contrat strict existants. Les tests d’import et de propositions couvrent cette frontière. Les filtres et le calendrier ne modifient aucun résultat, date enregistrée ni portée de publication.

### Vérifications

Types de l’app et des scripts, types des tests navigateur, lint, build et 311 tests unitaires réussis. Les analyses Svelte des composants modifiés ne signalent aucune issue.

La matrice finale, répétée après les corrections, couvre 112 rendus : 14 routes, quatre largeurs (320/390/768/1 440 px), deux thèmes, sans débordement horizontal ni erreur JavaScript. Les 56 captures ont toutes été actualisées. Les parcours sont vérifiés sur une copie locale fictive : un module associé à deux classes garde la classe et la section ouvertes entre module, échéances/barème, publication et notation ; correction/propositions conservent leur contexte au retour par le barème. La navigation modifiée peut être annulée puis confirmée sur ordinateur et téléphone.

Les trois modes de thème sont vérifiés au clavier avec une sélection unique et visible. Les cinq panneaux de publication sont accessibles au clavier ; le dernier lien de l’aperçu, le rappel de confidentialité, le champ Objectifs et son aide restent dégagés des barres d’action. Les contrôles métier ont couvert les brouillons et HTTP 409, vide distinct de zéro, PDF de la classe entière malgré les filtres, et stabilité du snapshot public après modification privée.

Les captures, mesures et packets de revue restent dans `.impeccable/review/coherence-20261014/`, ignoré par Git. Les 14 références de composition approuvées et leurs contrats sont conservés dans le projet. Le build conserve l’avertissement préexistant sur la taille des chunks PDF chargés à la demande.

Le reflow à petite largeur est vérifié ; il ne remplace pas un test de zoom réel. VoiceOver/NVDA, téléphone physique et clavier logiciel restent à vérifier. Aucun résultat automatisé ni revue visuelle ne constitue une certification WCAG ou RGPD.

## État du travail

Implémentation, corrections, vérifications et documentation terminées le 15 octobre 2026 dans le workspace GitButler principal. La revue complète initiale et le verdict de résolution F1–F4 sont clos. Aucun point ouvert dans ce lot ; aucune incohérence ou régression détectée dans les vérifications réalisées. Les limites manuelles ci-dessus restent explicites. DESIGN.md et sa sidecar sont synchronisés avec les changements approuvés, sans remplacement de l’identité luma.
