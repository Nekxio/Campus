# Choisir la grille de notation

Notation commence par **Année de travail**, puis **Classe et année** à gauche et **Module** à droite.
Le module ne propose que les rattachements actifs de la classe choisie. Sans classe, ce sélecteur est
désactivé et ne contient que son invitation à choisir : aucune ancienne grille, aucun bilan ni export
ne reste affiché. Changer de classe remet le module à choisir, sans en ouvrir un automatiquement.

## Année explicite et liens directs

Les années proviennent des classes non archivées et non clôturées, jamais de la date du Mac.
Une seule année ouverte peut être affichée directement ; plusieurs années demandent un choix explicite.
La préférence est conservée un an dans un cookie HttpOnly limité à `/enseignant`, associé à l'identité
de l'enseignant. Elle ne donne aucun droit et ne constitue pas une session. Une préférence devenue
indisponible ne sélectionne pas silencieusement une autre année. Clôture et réouverture restent manuelles.

Un lien valide contenant un module ou un contexte retrouve sa classe et son année, même si la
préférence conservée est différente. L'URL devient explicite : `annee`, `classe`, `module`, `contexte`,
puis `etudiant` lorsqu'il a été sélectionné. Une association ambiguë historique ne choisit pas la
première classe. Les identités incompatibles ou archivées renvoient une sélection indisponible.

## Chargement, brouillons et PDF

Un changement masque immédiatement les anciens résultats jusqu'à la réception de la nouvelle grille.
La recherche et le filtre d'état sont réinitialisés après ce changement. La navigation SvelteKit et
un identifiant de demande empêchent une réponse précédente de rétablir une sélection abandonnée.
Les protections de sortie des corrections et du barème restent actives ; revenir à la grille ne
sauvegarde ni ne supprime une saisie sans décision explicite.

Le bilan, les compteurs et les exports utilisent le contexte chargé. Les demandes PDF quittées
ignorent leurs réponses tardives, même après un aller-retour vers la même classe. Le contrat de
[l'export final](grade-export.md) reste inchangé : classe entière, données enregistrées et résultats
requis complets, aucun PDF final provisoire ni moyenne annuelle inventée.

Les tests utilisent des bases fictives neuves : B2/B3, classe sans module, plusieurs années ouvertes,
liens directs, sélection vide, réponses retardées et brouillons non enregistrés. Ils ne modifient
pas la base de la démo existante. Les contrôles Safari/iPhone connecté restent reportés.
