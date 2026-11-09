"use client";

import { Printer } from "lucide-react";

/** L'enregistrement PDF reste celui du navigateur ; aucune requête de téléchargement n'est promise. */
export function PrintAction() {
  return (
    <button className="btn rs-screen-only rs-print" type="button" onClick={() => window.print()} data-testid="rs-print">
      <Printer size={15} aria-hidden="true" />
      Imprimer / Enregistrer en PDF
    </button>
  );
}
