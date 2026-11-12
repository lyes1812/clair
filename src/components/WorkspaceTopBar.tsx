"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ALL_ITEMS } from "@/lib/nav";
import type { MenuFamily } from "@/lib/menu";
import { MegaMenu } from "./MegaMenu";
import { SignOutButton } from "./SignOutButton";
import { TableDensity } from "./TableDensity";
import { CurrencySwitch } from "./CurrencyPreference";
import { DropdownMenu } from "./DropdownMenu";
import "@/styles/ms-page-actions.css";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

export function WorkspaceTopBar({ slug, workspaceName, userName, email, families }: { slug: string; workspaceName: string; userName: string; email: string; families: MenuFamily[] }) {
  const pathname = usePathname();
  const accountRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (accountRef.current?.open && !accountRef.current.contains(event.target as Node)) accountRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !accountRef.current?.open || !accountRef.current.contains(document.activeElement)) return;
      accountRef.current.open = false;
      accountRef.current.querySelector("summary")?.focus();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const studioRhPath = `/e/${slug}/studio-rh`;
  const inStudioRh = pathname === studioRhPath || pathname.startsWith(`${studioRhPath}/`);
  const rest = pathname.replace(`/e/${slug}/`, "");
  const item = [...ALL_ITEMS].sort((a, b) => b.path.length - a.path.length).find((i) => rest === i.path || rest.startsWith(`${i.path}/`));
  const page = rest === "membres" ? "Membres et accès" : rest === "parametres" ? "Paramètres" : rest === "glossaire" ? "Glossaire" : rest === "studio-rh" ? "Synthèse du Studio RH" : item?.label;
  return (
    <header className="ws-topbar">
      <div className="topbar-left">
        {inStudioRh && <MegaMenu label="Fonctionnalités" className="ws-features" families={families} extras={[{ label: "Données", href: `/e/${slug}/donnees` }, { label: "Studio Finance", href: `/e/${slug}/studio-finance` }, { label: "Studio Restructuring", href: `/e/${slug}/studio-restructuring` }, { label: "Paramètres", href: `/e/${slug}/parametres` }, { label: "Membres et accès", href: `/e/${slug}/membres` }, { label: "Glossaire", href: `/e/${slug}/glossaire` }]} />}
        <nav className="breadcrumb" aria-label="Fil d'Ariane">
          <span className="crumb-space">Espace {workspaceName}</span>
          {page && (<><span className="crumb-sep" aria-hidden="true">/</span><strong aria-current="page">{page}</strong></>)}
        </nav>
      </div>
      <div className="workspace-display-tools" onClickCapture={(event) => {
        const target = event.target as Element;
        const opening = target.closest("summary")?.closest("details");
        if (!opening) return;
        for (const menu of event.currentTarget.querySelectorAll<HTMLDetailsElement>("details[open]")) {
          if (menu !== opening) menu.open = false;
        }
      }}>
      <DropdownMenu label="Affichage" className="display-preferences" testid="display-preferences">
        <div className="display-setting">
          <p className="display-setting-title">Montants</p>
          <CurrencySwitch />
        </div>
        <div className="display-setting">
          <p className="display-setting-title">Densité des tableaux</p>
          <TableDensity />
        </div>
      </DropdownMenu>
      <details ref={accountRef} className="user-menu">
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
