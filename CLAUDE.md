# CLAUDE.md — Clair (reprise from scratch)

Ce fichier est lu à chaque session. Il prime sur tout autre document du dossier `ref/` et sur le code Codex.

**Tutoie Lyes** dans toutes tes réponses.

## Ce que tu reprends
- L'**ancien dépôt Codex** complet, dans le dossier `codex/` à côté de ce fichier (code, docs, historique). Il est en lecture seule, ignoré par Git (`codex/` dans `.gitignore`) et ne doit jamais être poussé. Il contient des données de paie réelles : lis `HERITAGE-CODEX.md` §4 avant d'y toucher.
- L'**app Scalingo `clair-test`** (osc-fr1) et sa base, avec les précautions de `HERITAGE-CODEX.md` §5 (dump vérifié, schéma `codex_archive`) avant tout déploiement.
- Le contexte et les décisions de Lyes : `HERITAGE-CODEX.md` §6.

## Le produit
Clair est un SaaS de pilotage pour DAF de PME et d'ESS, en France, en euros.
- **PayFit dit ce qui s'est passé, Clair dit ce qui va se passer.** Clair ne fait pas la paie. C'est la couche de pilotage au-dessus.
- Trois temps : **Importer** (API PayFit ou DSN, FEC) → **Analyser** le réel → **Projeter** à partir d'hypothèses saisies dans Clair.
- Premier livrable : **Studio RH**. La partie planification financière façon Pigment vient après, sur le même moteur de projection : la masse salariale projetée alimente les comptes 64 du P&L projeté.
- Clair est généraliste. Aucune convention collective codée en dur. Toute règle métier (ETP, prorata, absences, charges, arrondis) est un paramètre de l'espace client, sans valeur par défaut cachée. Si une règle requise manque, Clair refuse de calculer et le dit.

## Organisation figée de l'interface
- Un seul module **Données** : toutes les sources (API ou fichier), avec date et statut de dernière synchronisation.
- **Studio RH**, cinq sous-modules exactement : Collaborateurs · KPI RH · Masse salariale · Hypothèses budgétaires · Reporting social.
- Ne pas ajouter, fusionner ni masquer d'entrée de menu sans accord de Lyes.

## Règles non négociables
1. **Aucune valeur inventée.** Une donnée absente s'affiche « n.d. » avec sa raison. Jamais zéro, jamais une ventilation reconstituée.
2. **Aucune donnée réelle dans le code, le dépôt, les tests, les logs ou les captures.** Les données clients vivent uniquement en base. Le développement se fait sur `ref/fixtures/clair-test-generic-v1.json` (fictif).
3. **Aucun secret dans le dépôt.** Clés PayFit / Pennylane uniquement en variables d'environnement. Lecture seule (GET) sur les API.
4. **Les données sont lues à la demande** (bouton « Synchroniser »), stockées en base, jamais figées au moment du build.
5. **Analyse = exacte** (rapprochée de la source à l'euro près). **Projection = traçable** (chaque euro remonte à une hypothèse visible).
6. **Définitions écrites dans l'app** (ETP, effectif moyen, turnover, absentéisme…) et accessibles depuis chaque indicateur.
7. **Multi-clients dès le départ** : chaque requête vérifie l'espace côté serveur. Rôles : administrateur, éditeur, lecteur.

## Technique
- Pile validée au module 0 : TypeScript, Next.js, PostgreSQL (RLS en mode FORCE), Drizzle, Better Auth (organisations, TOTP obligatoire pour les administrateurs), Vitest, Playwright. Pas d'HyperFormula : les projections sont des calculs typés.
- Ne pas recoder ce qui existe. Toute licence payante ou copyleft = validation de Lyes.
- Dépôt GitHub privé sur le compte de Lyes, déploiement Scalingo depuis GitHub. E-mails : liens d'invitation copiables, pas de service d'envoi en V1.
- Hébergement cible : Scalingo, région Paris (osc-fr1).
- Montants en centimes entiers. Devise stockée avec chaque montant, même si seul l'EUR est actif.
- Un test automatisé pour chaque calcul, avec un cas de référence écrit à la main.

## Définition de « terminé »
Un écran est terminé seulement quand :
1. les tests passent ;
2. l'écran a été **ouvert et vérifié dans l'environnement déployé**, avec une capture à l'appui ;
3. les écarts et limites restants sont listés.
Des tests locaux sur données fictives ne suffisent jamais à déclarer « livré ».

## Rythme et compte rendu
- Un module à la fois. Ne pas ouvrir le suivant tant que le précédent n'est pas terminé au sens ci-dessus.
- Avant de coder un module : proposer un plan court et attendre la validation de Lyes.
- Pas de documentation de processus, de manifestes ni de « preuves de conservation » au-delà de ce qui est demandé. Le produit d'abord.
- Compte rendu à chaque fin de module, cinq lignes maximum : livré / en cours / blocage / prochaine étape / décision attendue.
- Solliciter Lyes uniquement pour : une dépense, une action irréversible, un envoi de données hors de l'application, ou un choix métier ambigu.
