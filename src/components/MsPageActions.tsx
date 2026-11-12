"use client";

import { Download } from "lucide-react";
import { menuFamilies } from "@/lib/menu";
import { DropdownMenu } from "./DropdownMenu";
import { MegaMenu } from "./MegaMenu";
import "@/styles/ms-page-actions.css";

/** Le navigateur conserve les valeurs affichées et inclut la provenance dans le document imprimé. */
function printSynthese() {
  const details = Array.from(document.querySelectorAll<HTMLDetailsElement>("details[data-ms-print-details], details[data-ms-print-details] details:not(:has(form))"));
  const previous = details.map((detail) => ({ detail, open: detail.open }));
  const previousMode = document.body.dataset.msPdf;
  document.body.dataset.msPdf = "synthese";
  details.forEach((detail) => { detail.open = true; });
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    previous.forEach(({ detail, open }) => { detail.open = open; });
    if (previousMode === undefined) delete document.body.dataset.msPdf;
    else document.body.dataset.msPdf = previousMode;
    window.removeEventListener("afterprint", done);
    window.removeEventListener("pointerdown", done);
    window.removeEventListener("keydown", done);
  };
  window.addEventListener("afterprint", done);
  try {
    window.print();
  } catch (error) {
    done();
    throw error;
  }
  // Même repli que l'impression croisée : certains navigateurs ne déclenchent pas afterprint.
  if (!finished) {
    window.addEventListener("pointerdown", done);
    window.addEventListener("keydown", done);
  }
}

export function MsPageActions({ slug, exportHref }: { slug: string; exportHref?: string }) {
  return (
    <div className="ms-page-actions" data-testid="ms-page-actions">
      <MegaMenu variant="page" label="Fonctionnalités" families={menuFamilies(slug)} extras={[
        { label: "Données", href: `/e/${slug}/donnees` },
        { label: "Studio Finance", href: `/e/${slug}/studio-finance` },
        { label: "Studio Restructuring", href: `/e/${slug}/studio-restructuring` },
        { label: "Paramètres", href: `/e/${slug}/parametres` },
        { label: "Membres et accès", href: `/e/${slug}/membres` },
        { label: "Glossaire", href: `/e/${slug}/glossaire` },
      ]} />
      {exportHref && <DropdownMenu label="Exporter" className="export-menu ms-page-export" testid="ms-export">
        <button type="button" className="ms-export-action" data-dropdown-close data-testid="ms-export-pdf" onClick={printSynthese}>
          <Download size={14} aria-hidden="true" />Imprimer / Enregistrer en PDF
        </button>
        <a href={exportHref} data-testid="ms-export-xlsx"><Download size={14} aria-hidden="true" />Excel (.xlsx)</a>
      </DropdownMenu>}
    </div>
  );
}
