"use client";

import { useEffect, useRef } from "react";
import { DropdownMenu } from "@/components/DropdownMenu";

// « Sommaire » : les dix chapitres sur un panneau (numéro, titre, une ligne de description). Divulgation native partagée
// (DropdownMenu : Échap et clic extérieur ferment, Échap rend le focus au bouton). À l'ouverture, le focus va au chapitre courant ;
// « Fermer » rend aussi le focus au bouton. Données sérialisables uniquement.
export type ChapterMenuItem = { id: string; num: string; title: string; description: string; href: string; prevu: boolean };

export function ChapterMenu({ items, current, total }: { items: ChapterMenuItem[]; current: string; total: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const details = wrap.current?.querySelector("details");
    const summary = details?.querySelector("summary");
    if (!details || !summary) return;
    const onToggle = () => {
      if (details.open) {
        details.querySelector<HTMLElement>('.cx-menu-grid a[aria-current="page"]')?.focus();
        return;
      }
      const active = document.activeElement;
      if (active && active !== summary && details.contains(active)) summary.focus();
    };
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);
  return (
    <div ref={wrap} className="cx-menu-wrap">
      <DropdownMenu label="Sommaire" testid="cx-chapter-menu" className="cx-menu">
        <div className="cx-menu-head">
          <p className="cx-menu-title">Explorer le rapport</p>
          <button type="button" className="btn small" data-dropdown-close>
            Fermer
          </button>
        </div>
        <nav aria-label="Sommaire des chapitres">
          <ol className="cx-menu-grid">
            {items.map((i) => (
              <li key={i.id}>
                <a className="cx-menu-item" href={i.href} aria-current={i.id === current ? "page" : undefined}>
                  <span className="cx-menu-num" aria-hidden="true">{i.num}</span>
                  <span className="cx-menu-text">
                    <span className="cx-menu-name">
                      <span className="ms-sr">Chapitre {i.num} sur {total} : </span>
                      {i.title}
                      {i.prevu && <span className="soon">Prévu</span>}
                    </span>
                    <span className="cx-menu-desc">{i.description}</span>
                  </span>
                  <span className="cx-menu-arrow" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </DropdownMenu>
    </div>
  );
}
