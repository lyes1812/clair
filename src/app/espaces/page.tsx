import { TopBar } from "@/components/TopBar";
import { ROLE_LABELS } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { listWorkspaces } from "@/lib/workspace";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";

export const dynamic = "force-dynamic";

export default async function EspacesPage() {
  const session = await requireUser("/espaces");
  const workspaces = await listWorkspaces(session.user.id);
  return (
    <>
      <TopBar email={session.user.email} />
      <main className="page">
        <div style={{ display: "grid", gap: 8 }}>
          <span className="label">Clair</span>
          <h1>Mes espaces</h1>
        </div>
        <section className="panel" aria-labelledby="ws-list">
          <h2 id="ws-list">Espaces auxquels vous avez accès</h2>
          {workspaces.length === 0 ? (
            <p className="muted" data-testid="no-workspace">Aucun espace pour l'instant.</p>
          ) : (
            <ul className="list" data-testid="workspace-list">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <a href={`/e/${w.slug}`} style={{ fontWeight: 600 }}>{w.name}</a>
                  <span className="tag">{ROLE_LABELS[w.role]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Nouvel espace</h2>
          <CreateWorkspaceForm />
        </section>
      </main>
    </>
  );
}
