"use client";
import { LayoutGrid, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MenuFamily } from "@/lib/menu";

// Menu général du Studio RH : les cinq familles et toutes leurs entrées sur un seul panneau, comme le menu de l'outil
// observé. Il s'ajoute au menu latéral (qui garde ses cinq sous-modules) : un clic atteint n'importe quelle entrée.
export function MegaMenu({ families, extras = [] }: { families: MenuFamily[]; extras?: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const sp = useSearchParams();
  useEffect(() => setOpen(false), [pathname, sp]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [open]);
  // Entrée courante : même chemin et, si l'entrée porte un paramètre « vue », même vue.
  const current = (href: string) => {
    const [path, query] = href.split("?");
    if (path !== pathname) return false;
    const want = new URLSearchParams(query ?? "").get("vue");
    const have = sp.get("vue");
    return want ? want === have : !have || !families.some((f) => f.entries.some((e) => e.href.startsWith(`${path}?`) && new URLSearchParams(e.href.split("?")[1]).get("vue") === have));
  };
  return (
    <div className="mega">
      <button ref={btn} type="button" className="btn small mega-btn" aria-expanded={open} aria-controls="mega-panel" onClick={() => setOpen((o) => !o)} data-testid="mega-button">
        {open ? <X size={15} strokeWidth={1.75} aria-hidden="true" /> : <LayoutGrid size={15} strokeWidth={1.75} aria-hidden="true" />}
        <span className="mega-long">Toutes les entrées</span>
        <span className="mega-short">Entrées</span>
      </button>
      {open && (
        <div ref={panel} id="mega-panel" className="mega-panel" role="navigation" aria-label="Toutes les entrées du Studio RH" data-testid="mega-panel">
          {families.map((f) => (
            <section key={f.label}>
              <h3><a href={f.href}>{f.label}</a></h3>
              <ul>
                {f.entries.map((e) => (
                  <li key={e.href}>
                    <a href={e.href} aria-current={current(e.href) ? "page" : undefined}>{e.label}{e.soon && <span className="soon">Prévu</span>}</a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {extras.length > 0 && (
            <footer className="mega-extras" aria-label="Espace">
              {extras.map((e) => <a key={e.href} href={e.href}>{e.label}</a>)}
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
