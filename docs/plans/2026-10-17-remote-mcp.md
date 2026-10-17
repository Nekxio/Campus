# MCP distant — réalisation locale autorisée

Autorisation de développement confirmée par Léo ; connexion, consentement et
applications connectées approuvés à partir du prototype du 17 octobre.

1. Restaurer l’état initial complet audité et P3 dans une copie durable isolée.
2. Reconstituer le fournisseur OAuth local, sa découverte et le MCP HTTP protégé.
3. Intégrer les trois écrans approuvés aux passkeys et sessions existantes.
4. Revalider protocole, refus, expiration, révocation, métier et stdio ; contrôler
   desktop/mobile, types, lint, build et packaging Worker.
5. Livrer le patch, les journaux et les étapes de connexion au parent, propriétaire
   de l’intégration. Aucun commit, push, déploiement ou migration distante.

Les dossiers `/tmp` antérieurs ont disparu après redémarrage. L’archive initiale
et P3 ont été récupérés par empreinte ; les sources OAuth sont reconstituées.
Les résultats de tests précédents ne sont pas utilisés pour valider ce candidat.
Voir `docs/remote-mcp.md` et le rapport durable de livraison pour les preuves finales.
