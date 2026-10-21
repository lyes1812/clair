# Héritage Codex — tout ce qui existe, et comment le reprendre

Inventaire du dépôt `miimosa-planning-platform` au 21 octobre 2026 (dernier commit `f9a6de30`).
Lyes te confie **tout** : le code, l'historique, la documentation, et l'environnement Scalingo `clair-test`.
Le dépôt est dans `codex/` ; tous les chemins ci-dessous sont relatifs à ce dossier. Les copies dans `ref/` sont les fichiers sûrs, sans donnée réelle.

## 1. Ce que Codex a produit (13 → 21 octobre 2026)
- **1 758 commits en huit jours.** ~390 fichiers JS sans framework ni dépendance externe (Node 24, `node:sqlite` en local), 26 migrations SQL (Drizzle), 32 Mo de tests, 465 Mo de fichiers de recette (`.qa/`), 7 Mo de coordination. Dépôt complet : 660 Mo.
- **Partie financière façon Pigment** : P&L mensuel sur un jeu entièrement fictif, dimensions, formules, scénarios, import CSV, révisions (`src/engine.js`, `src/api.js`, `src/app.js`).
- **Studio RH** : construit autour d'un rapport HTML statique fourni par Lyes (« Pilotage de la masse salariale 2025–2026 », 29/09/2026), intégré dans une iframe, avec des données de paie réelles figées dans le code (`src/rh/generated/`, `src/rh/source-report.html`).
- **Sources RH** : lecteur DSN natif P25V01/P26V01 (`src/rh-dsn-*`), lecteurs PayFit collaborateurs/contrats/temps/journal comptable (`src/payfit-rh.js`, `src/platform/pilot/`), rapprochement DSN–PayFit partiel (`src/rh-source-diff-*`), moteur ETP (`src/rh-etp-engine.js`), 39 « lots » documentés dans `docs/studio-rh-lot*.md`.
- **Socle SaaS** (`src/platform/`, `src/client-*`) : espaces clients, imports, révisions, adaptateur PostgreSQL et Scalingo TEST.
- **Feuille de route** : 124 capacités / 413 critères calqués sur Pigment (`docs/clair-delivery-plan-2026-10-17.json`).
- **Scalingo `clair-test`** (osc-fr1) : écrans vides au 21 octobre 2026, y compris la page d'accueil.

## 2. Pourquoi Lyes a arrêté Codex
1. **Le processus a pris le pas sur le produit** : manifestes, oracles, reçus de publication, revues — peu d'écrans vérifiés.
2. **Le Studio RH était un rapport, pas un produit** : données lues une fois puis figées au build.
3. **Tout recodé à la main** (formules, grilles, auth) : coût énorme, aucune valeur différenciante.
4. **Périmètre trop large** (124 capacités) avant un premier module solide.
5. **« Déployé » sans vérification à l'écran.** Dernier rapport : correctifs déployés, écrans non revérifiés ; résultat constaté : application vide.

## 3. Comment reprendre
- **La nouvelle base de code part de zéro** sur la pile validée au module 0 (TypeScript, Next.js, PostgreSQL, Drizzle, Better Auth, RLS).
- **L'ancien code est une mine, pas une fondation.** Avant d'écrire un module, cherche ce que Codex avait déjà fait sur le sujet. Reprends une brique seulement si elle est testée et compréhensible, en la réécrivant dans la nouvelle pile. Candidats prioritaires :
  - lecteur DSN (module 1) ;
  - lecteurs PayFit et leurs scopes (module 1, voir `docs/payfit-connector.md`) ;
  - moteur de rapprochement DSN–PayFit (module 1) ;
  - moteur ETP et règles de prorata (module 3) ;
  - règles du budget, mouvements, bases T4 (module 5, `docs/studio-rh-lot6` à `lot15`).
- **Spécifications fonctionnelles** : `docs/studio-rh-budget-spec-2026-10-15.md` (sections 1 à 4) et `docs/studio-rh-budget-requirements-2026-10-15.json` (32 exigences). Les « états de lot » sont historiques.
- **Charte « 101 »** : `src/typography.css`, `src/rh/controls.css`, police Inter, fond blanc, gris/noir, bleu mesuré. Le rapport d'origine (`src/rh/source-report.html`) est la référence visuelle des écrans RH.
- **Jeu fictif** : `tests/fixtures/clair-test-generic-v1.json` (3 profils de 8, 18 et 45 personnes, 24 mois) pour tout le développement et les tests.

## 4. Où sont les données réelles (à ne jamais copier dans le nouveau dépôt)
Ces emplacements contiennent ou peuvent contenir des données de paie nominatives de MiiMOSA :
- `src/rh/generated/`, `src/rh/source-report.html`, `src/rh/source-workbook.xlsx` ;
- `.qa/` (dont `payfit-rh-live-september.json`, les `.sqlite`, captures et classeurs) ;
- `site.tar.gz`, `dist/`, `versions/` ;
- **l'historique Git** depuis le 13 octobre 2026.

Règles :
- Le dépôt Codex reste **local, en lecture seule**. Il ne doit **jamais** être poussé vers GitHub ou un autre dépôt distant.
- Aucun fichier, extrait, capture ou chiffre réel de ces emplacements dans le nouveau dépôt, les tests, les logs ou les comptes rendus.
- Pour reproduire un écran du rapport d'origine, tu en reprends la structure et les définitions, jamais les valeurs.

## 5. Environnement `clair-test` (Scalingo, osc-fr1)
Le nouveau code se déploie sur l'app existante. Avant tout déploiement :
1. sauvegarde complète de la base (dump), vérifiée par une restauration dans une base séparée ;
2. tables Codex déplacées dans un schéma `codex_archive`, jamais lues par le nouveau code, jamais supprimées sans accord de Lyes ;
3. variables PayFit et Pennylane déjà configurées conservées, en lecture seule (GET), jamais affichées.
Le premier déploiement remplace la version compilée par Codex, qui contenait encore des données réelles dans son code.

## 6. Contexte et décisions de Lyes
- **Clair** est un SaaS généraliste vendu à des entreprises clientes. MiiMOSA (plateforme de financement participatif agricole, où Lyes est DAF) est le **pilote réel**, pas la cible. Florian Breton, CEO de MiiMOSA, a donné son accord pour tester Clair sur les données PayFit et Pennylane de MiiMOSA.
- Positionnement : **PayFit dit ce qui s'est passé, Clair dit ce qui va se passer.** Le même schéma vaut pour la finance : FEC (API ou upload) = réel, Clair = projection. La masse salariale projetée alimente les comptes 64 du P&L projeté.
- Interface figée : module Données unique + Studio RH en cinq sous-modules (Collaborateurs, KPI RH, Masse salariale, Hypothèses budgétaires, Reporting social).
- Sources : Collaborateurs, KPI RH, Masse salariale réelle et Reporting social viennent de PayFit (ou DSN) ; Hypothèses budgétaires saisies dans Clair.
- France / EUR d'abord ; aucune convention collective codée en dur ; SYNTEC et autres préréglages en fin de projet.
- Reportés : IA dans le produit, agent local, multidevise actif, SSO/SCIM.
- Lyes veut un produit construit par l'IA, sans développeur humain ; il supervise et gère lui-même les clients pilotes.
- **Hors périmètre de ce dépôt** : « Clair Cap 13 » et « Clair Vigie » (restructuring et détection de signaux faibles sur le portefeuille de prêts MiiMOSA, via Metabase et n8n). Ce sont des produits séparés, même charte.
