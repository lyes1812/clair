"use client";
import { useEffect } from "react";

// « Tout déplier / Tout replier » : ouvre ou ferme toutes les sections repliables (data-fold) du conteneur désigné.
// Un lien d'ancre (« #contrat-1 ») vers une section repliée la déplie avant d'y aller.
// Sans JavaScript, chaque section reste repliable à la main.
export function FoldAll({ scope }: { scope: string }) {
  const folds = () => document.querySelectorAll<HTMLDetailsElement>(`[id="${scope}"] details[data-fold]`);
  const set = (open: boolean) => folds().forEach((el) => { el.open = open; });

  useEffect(() => {
    const reveal = (hash: string) => {
      if (hash.length < 2) return;
      let id = hash.slice(1);
      try { id = decodeURIComponent(id); } catch { /* adresse mal formée : l'ancre est prise telle quelle */ }
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement && el.hasAttribute("data-fold") && el.closest(`[id="${scope}"]`)) el.open = true;
    };
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href^='#']") : null;
      if (a) reveal(a.getAttribute("href") ?? "");
    };
    const onHash = () => reveal(window.location.hash);
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
    };
  }, [scope]);

  return (
    <div className="fold-tools" role="group" aria-label="Sections de la fiche">
      <button type="button" className="btn small" onClick={() => set(true)}>Tout déplier</button>
      <button type="button" className="btn small" onClick={() => set(false)}>Tout replier</button>
    </div>
  );
}
