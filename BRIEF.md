# BRIEF — Studio RH, V1

Objectif : un Studio RH utilisable au quotidien par un DAF, sur données réelles importées, avec une projection de masse salariale traçable. Ordre imposé ; chaque module a ses critères d'acceptation.

## Module 0 — Socle
- Projet, base PostgreSQL, authentification, espaces clients, rôles, déploiement Scalingo TEST.
- Charte reprise de la version de référence (« 101 ») : voir `ref/design/typography.css` et `ref/design/controls.css`. Fond blanc, gris/noir, bleu mesuré, police Inter.
**Accepté quand :** un utilisateur se connecte sur TEST, crée un espace, voit le menu figé (Données + 5 sous-modules Studio RH), et un second utilisateur ne voit pas cet espace (test d'accès croisé).

## Module 1 — Données
- Upload DSN (normes P25V01/P26V01) et connecteur PayFit en lecture seule : collaborateurs, contrats, temps, journal comptable.
- Synchronisation à la demande, date de dernière synchro, historique des imports, aperçu avant application.
- **Rapprochement DSN–PayFit** : correspondance des personnes et contrats, écarts par champ, décision tracée pour chaque écart.
**Accepté quand :** sur la fixture fictive, chaque personne et chaque contrat est rapproché ou explicitement signalé ; les écarts sont listés ; un réimport du même fichier est détecté et ne crée pas de doublon.

## Module 2 — Collaborateurs
- Fiches individuelles, liste mensuelle, liste annuelle, entrées/sorties datées.
**Accepté quand :** l'effectif à une date donnée correspond à la source, et chaque fiche indique de quelle source vient chaque champ.

## Module 3 — KPI RH
- ETP, effectif moyen, turnover, absentéisme ; comparaison N-1.
- Définitions affichées et paramétrables par espace.
**Accepté quand :** chaque KPI recalculé à la main sur la fixture donne le même résultat ; un KPI non calculable affiche « n.d. » et la raison.

## Module 4 — Masse salariale (réel)
- Brut, charges, coût chargé par mois, par population ; primes et heures supplémentaires détaillées.
- Rapprochement avec la comptabilité : comptes 641/645 du journal PayFit ou du FEC.
**Accepté quand :** le total mensuel égale la somme des comptes 641/645 de la source, à l'euro près, ou l'écart est expliqué ligne par ligne.

## Module 5 — Hypothèses budgétaires et projection
- Base de référence figée à une date de bascule ; horizon paramétrable.
- Hypothèses datées : embauches, départs, remplacements, augmentations, enveloppes, quotités ; périmètre global, par société ou ciblé, avec règle de priorité visible.
- Scénarios indépendants ; comparaison budget / réel / N-1 ; pont d'écart (effectif, prix, mix).
**Accepté quand :** pour un mois projeté, on peut cliquer sur le montant et voir la liste des hypothèses qui le composent, et la somme tombe juste.

## Module 6 — Reporting social
- Rapport de synthèse et export PDF.
- Index égalité et BDESE : hors V1, affichés comme « prévu » dans l'interface.
**Accepté quand :** le PDF contient exactement les chiffres affichés à l'écran pour la même période.

## Hors V1
IA dans le produit, multidevise actif, SSO/SCIM, préréglages de conventions collectives, partie planification financière Pigment (après la V1 RH), connecteur Pennylane (après le FEC en upload).

## Lots d'ergonomie — 25 octobre 2026
Statut : mis en œuvre. Le catalogue, ses libellés et statuts, les calculs et les données restent inchangés. Les menus d'export ne proposent que les formats déjà disponibles dans la version concernée.
- **Filtres** : afficher seulement les champs utiles au mode temporel choisi dans KPI RH ; replier les longues listes de comparaisons en conservant les lectures sélectionnées et la limite de trois.
- **Menus déroulants** : regrouper les formats déjà disponibles sous « Exporter » et les choix Tout / Graphiques / Tableaux sous « Affichage », avec les mêmes fichiers, paramètres et adresses ; accès au clavier et sur mobile.
- **Informations répétées** : retirer les répétitions de contexte et de date, garder les définitions et détails accessibles depuis leur emplacement commun. Conserver visibles la source active, la période, N-1, les mois non clos, les limites de couverture et les raisons des « n.d. » ; distinguer la période du scénario de celle de la projection.
**Accepté quand :** les choix restent conservés après navigation, chaque action et information utile reste accessible, et une vérification sur TEST confirme le comportement sans modification de la navigation métier ni des résultats.

## Première consigne à donner
« Lis CLAUDE.md, BRIEF.md et HERITAGE-CODEX.md. Propose-moi le plan du module 0 uniquement, avec la pile technique retenue et pourquoi. Ne code rien avant ma validation. »
