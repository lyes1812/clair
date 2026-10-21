-- À exécuter UNE FOIS sur la base de clair-test, après le dump vérifié et avant le premier déploiement.
-- Déplace tout ce que Codex a créé (schémas public et drizzle) dans codex_archive, sans rien supprimer.
-- Le nouveau code ne lit jamais codex_archive. Annulable : ALTER ... SET SCHEMA public.
BEGIN;
CREATE SCHEMA IF NOT EXISTS codex_archive;

DO $$
DECLARE r record;
BEGIN
  -- Vues d'abord (elles dépendent des tables), puis tables (leurs séquences liées suivent), puis le reste.
  FOR r IN SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('v', 'm') LOOP
    EXECUTE format('ALTER %s %I.%I SET SCHEMA codex_archive',
                   CASE r.relkind WHEN 'v' THEN 'VIEW' ELSE 'MATERIALIZED VIEW' END, r.nspname, r.relname);
  END LOOP;
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p') AND NOT c.relispartition LOOP
    EXECUTE format('ALTER TABLE %I.%I SET SCHEMA codex_archive', r.nspname, r.relname);
  END LOOP;
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('public', 'drizzle') AND c.relkind = 'S' LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I SET SCHEMA codex_archive', r.nspname, r.relname);
  END LOOP;
  FOR r IN SELECT n.nspname, t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname IN ('public', 'drizzle') AND t.typtype IN ('e', 'd') LOOP
    EXECUTE format('ALTER TYPE %I.%I SET SCHEMA codex_archive', r.nspname, r.typname);
  END LOOP;
  FOR r IN SELECT n.nspname, p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
           WHERE n.nspname IN ('public', 'drizzle') AND d.objid IS NULL LOOP
    EXECUTE format('ALTER ROUTINE %s SET SCHEMA codex_archive', r.sig);
  END LOOP;
END $$;

-- Contrôle : public et drizzle ne contiennent plus aucune relation.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('public', 'drizzle') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')) THEN
    RAISE EXCEPTION 'Archivage incomplet : des relations restent dans public ou drizzle';
  END IF;
END $$;
COMMIT;

SELECT count(*) AS relations_archivees FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'codex_archive' AND c.relkind IN ('r', 'p');
