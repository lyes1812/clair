import { Brand } from "@/components/AuthCard";
import { SignOutButton } from "@/components/SignOutButton";
import { WorkspaceNav } from "@/components/WorkspaceNav";
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
        <div style={{ padding: "0 10px" }}><Brand /></div>
        <div className="ws">
          <span className="ws-name" data-testid="workspace-name">{workspace.name}</span>
          <span className="desc">{ROLE_LABELS[workspace.role]}</span>
        </div>
        <WorkspaceNav slug={slug} />
        <div className="sidebar-foot">
          <a href={`/e/${slug}/membres`}>Membres et accès</a>
          <a href="/espaces">Changer d'espace</a>
          <a href="/securite">Sécurité</a>
          <span className="muted" style={{ overflowWrap: "anywhere" }}>{session.user.email}</span>
          <SignOutButton />
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
