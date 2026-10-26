import type { ReactNode } from "react";
import { glossaryEntry, glossaryHref } from "@/lib/glossary";

// Bloc repliable (details / summary natifs, accessibles au clavier). Les définitions et la méthode ne sont pas recopiées : le bloc
// se termine par un lien vers l'entrée du glossaire (`term`). Fermé par défaut ; masqué à l'impression quand il est fermé.
export function Pliant({ title, children, open = false, id, testid, term, slug }: { title: ReactNode; children: ReactNode; open?: boolean; id?: string; testid?: string; term?: string; slug?: string }) {
  const def = term && slug && glossaryEntry(term) ? glossaryHref(slug, term) : null;
  return (
    <details className="cx-fold" id={id} data-testid={testid} open={open || undefined}>
      <summary>{title}</summary>
      <div className="cx-fold-body">
        {children}
        {def && (
          <p className="tile-foot cx-fold-def">
            <a href={def}>Définitions et méthode</a>
          </p>
        )}
      </div>
    </details>
  );
}
