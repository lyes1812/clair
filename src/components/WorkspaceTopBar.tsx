"use client";
import { usePathname } from "next/navigation";
import { ALL_ITEMS } from "@/lib/nav";
import { SignOutButton } from "./SignOutButton";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

export function WorkspaceTopBar({ slug, workspaceName, userName, email }: { slug: string; workspaceName: string; userName: string; email: string }) {
  const pathname = usePathname();
  const rest = pathname.replace(`/e/${slug}/`, "");
  const item = [...ALL_ITEMS].sort((a, b) => b.path.length - a.path.length).find((i) => rest === i.path || rest.startsWith(`${i.path}/`));
  const page = rest === "membres" ? "Membres et accès" : item?.label;
  return (
    <header className="ws-topbar">
      <nav className="breadcrumb" aria-label="Fil d'Ariane">
        <span>Espace {workspaceName}</span>
        {page && (<><span aria-hidden="true">/</span><strong>{page}</strong></>)}
      </nav>
      <details className="user-menu">
        <summary aria-label={`Compte de ${userName}`} data-testid="user-menu"><span className="avatar">{initials(userName)}</span></summary>
        <div className="user-menu-panel">
          <div className="user-menu-id"><strong>{userName}</strong><span className="muted" data-testid="current-user">{email}</span></div>
          <a href={`/e/${slug}/membres`}>Membres et accès</a>
          <a href="/espaces">Changer d'espace</a>
          <a href="/securite">Sécurité</a>
          <SignOutButton />
        </div>
      </details>
    </header>
  );
}
