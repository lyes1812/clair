# Clair

SaaS de pilotage pour DAF (Studio RH d'abord). Règles du projet : `CLAUDE.md`. Périmètre : `BRIEF.md`.

## Pile
Next.js 15 (TypeScript) · PostgreSQL (RLS en mode FORCE) · Drizzle · Better Auth (espaces, rôles, TOTP) · Vitest · Playwright.

## En local
```sh
cp .env.example .env          # renseigner DATABASE_URL et BETTER_AUTH_SECRET
npm install
npm run db:migrate
npm run dev
```
La base doit être utilisée avec un rôle **non superutilisateur** (comme sur Scalingo), sinon la RLS ne s'applique pas.

## Tests
```sh
DATABASE_URL=<base de test migrée> npm test                 # unitaires + isolation RLS
E2E_BASE_URL=https://<environnement> npm run e2e            # acceptation, captures dans captures/ (E2E_PROXY si sortie par proxy)
```

## Scalingo (clair-test, osc-fr1)
- Variables : `BETTER_AUTH_SECRET` (32 octets aléatoires), `BETTER_AUTH_URL` (URL publique). La base est lue dans `DATABASE_URL` ou `SCALINGO_POSTGRESQL_URL`.
- Le `Procfile` applique les migrations au déploiement (`postdeploy`).
- Avant le **premier** déploiement : dump vérifié de la base, puis `scripts/codex-archive.sql` (déplace les tables Codex dans `codex_archive`, sans suppression).

## Organisation
- `src/lib/nav.ts` : menu figé (Données + 5 sous-modules Studio RH).
- `src/lib/workspace.ts` : garde d'accès à un espace, appelée par chaque page et action serveur.
- `src/db/workspace-scope.ts` : toute table métier se lit et s'écrit via `withWorkspace` (RLS).
- `ref/` : spécifications, charte et jeu fictif de référence.
