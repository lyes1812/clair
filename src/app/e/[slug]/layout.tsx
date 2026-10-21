import { Brand } from "@/components/AuthCard";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { WorkspaceTopBar } from "@/components/WorkspaceTopBar";
import { ROLE_LABELS } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, workspace } = await requireWorkspace(slug);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><Brand /></div>
        <a className="ws-card" href="/espaces" title="Changer d'espace">
          <span className="ws-mark" aria-hidden="true">{workspace.name.trim()[0]?.toUpperCase() ?? "?"}</span>
          <span className="ws">
            <span className="ws-name" data-testid="workspace-name">{workspace.name}</span>
            <span className="desc">{ROLE_LABELS[workspace.role]}</span>
          </span>
        </a>
        <WorkspaceNav slug={slug} />
        <div className="sidebar-foot">
          <p><span className="dot" aria-hidden="true" />Lecture seule des sources</p>
          <p className="muted">PayFit dit ce qui s'est passé. Clair dit ce qui va se passer.</p>
        </div>
      </aside>
      <div className="shell-main">
        <WorkspaceTopBar slug={slug} workspaceName={workspace.name} userName={session.user.name} email={session.user.email} />
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
