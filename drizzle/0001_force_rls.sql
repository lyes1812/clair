-- Le propriétaire de la table (l'utilisateur de l'application sur Scalingo) est soumis aux politiques RLS.
ALTER TABLE "workspace_event" FORCE ROW LEVEL SECURITY;
