"use client";
import { usePathname } from "next/navigation";
import { ALL_ITEMS } from "@/lib/nav";
import type { MenuFamily } from "@/lib/menu";
import { MegaMenu } from "./MegaMenu";
import { SignOutButton } from "./SignOutButton";
import { TableDensity } from "./TableDensity";
import { CurrencySwitch } from "./CurrencyPreference";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

export function WorkspaceTopBar({ slug, workspaceName, userName, email, families }: { slug: string; workspaceName: string; userName: string; email: string; families: MenuFamily[] }) {
  const pathname = usePathname();
  const rest = pathname.replace(`/e/${slug}/`, "");
  const item = [...ALL_ITEMS].sort((a, b) => b.path.length - a.path.length).find((i) => rest === i.path || rest.startsWith(`${i.path}/`));
  const page = rest === "membres" ? "Membres et accès" : rest === "parametres" ? "Paramètres" : rest === "glossaire" ? "Glossaire" : rest === "studio-rh" ? "Synthèse du Studio RH" : item?.label;
  return (
    <header className="ws-topbar">
      <div className="topbar-left">
        <MegaMenu families={families} extras={[{ label: "Données", href: `/e/${slug}/donnees` }, { label: "Studio Finance", href: `/e/${slug}/studio-finance` }, { label: "Paramètres", href: `/e/${slug}/parametres` }, { label: "Membres et accès", href: `/e/${slug}/membres` }, { label: "Glossaire", href: `/e/${slug}/glossaire` }]} />
        <nav className="breadcrumb" aria-label="Fil d'Ariane">
          <span className="crumb-space">Espace {workspaceName}</span>
          {page && (<><span className="crumb-sep" aria-hidden="true">/</span><strong>{page}</strong></>)}
        </nav>
      </div>
      <div className="workspace-display-tools">
      <CurrencySwitch />
      <TableDensity />
      <details className="user-menu">
        <summary aria-label={`Compte de ${userName}`} data-testid="user-menu"><span className="avatar">{initials(userName)}</span></summary>
        <div className="user-menu-panel">
          <div className="user-menu-id"><strong>{userName}</strong><span className="muted" data-testid="current-user">{email}</span></div>
          <a href={`/e/${slug}/membres`}>Membres et accès</a>
          <a href={`/e/${slug}/parametres`}>Paramètres de l'espace</a>
          <a href={`/e/${slug}/glossaire`}>Glossaire</a>
          <a href="/espaces">Changer d'espace</a>
          <a href="/securite">Sécurité</a>
          <SignOutButton />
        </div>
      </details>
      </div>
    </header>
  );
}
