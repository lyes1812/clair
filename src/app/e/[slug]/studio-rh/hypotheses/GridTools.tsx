"use client";

// Outils d'une grille mensuelle (formulaire serveur à champs non contrôlés) : report d'une valeur sur les mois suivants
// d'une ligne, remise à zéro de la saisie non enregistrée, export CSV de ce qui est affiché. Rien n'est enregistré
// tant que le formulaire n'est pas envoyé : « Réinitialiser » annule tout report.
const inputsOf = (form: HTMLFormElement, row: string) => [...form.querySelectorAll<HTMLInputElement>(`input[data-row="${CSS.escape(row)}"][data-cell]`)];

export function RowFill({ row }: { row: string }) {
  return (
    <button
      type="button"
      className="btn small"
      data-testid={`fill-${row}`}
      title="Reporte la première valeur renseignée sur les mois suivants de la ligne (non enregistré tant que vous n'envoyez pas la grille)"
      onClick={(e) => {
        const form = e.currentTarget.closest("form")!;
        const cells = inputsOf(form, row);
        const first = cells.findIndex((c) => c.value.trim() !== "");
        if (first < 0) return;
        const v = cells[first].value;
        let n = 0;
        for (const c of cells.slice(first + 1)) {
          c.value = v;
          n += 1;
        }
        const note = form.querySelector<HTMLElement>("[data-fill-note]");
        if (note) note.textContent = n ? `Valeur « ${v} » reportée sur ${n} mois de la ligne, à enregistrer. « Réinitialiser » annule.` : "Aucun mois suivant.";
      }}
    >
      Reporter →
    </button>
  );
}

export function GridTools({ filename }: { filename: string }) {
  return (
    <div className="grid-tools">
      <button type="button" className="btn small" data-testid="grid-reset" onClick={(e) => {
        const form = e.currentTarget.closest("form")!;
        form.reset();
        const note = form.querySelector<HTMLElement>("[data-fill-note]");
        if (note) note.textContent = "Saisie réinitialisée aux valeurs enregistrées.";
      }}>Réinitialiser</button>
      <button type="button" className="btn small" data-testid="grid-csv" onClick={(e) => {
        const table = e.currentTarget.closest("form")!.querySelector("table")!;
        const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const lines = [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => {
          const i = c.querySelector<HTMLInputElement | HTMLSelectElement>("input:not([type=hidden]):not([type=checkbox]),select");
          const cb = c.querySelector<HTMLInputElement>("input[type=checkbox]");
          return q(cb ? (cb.checked ? "oui" : "non") : i ? i.value : (c.textContent ?? "").replace("Reporter →", "").trim());
        }).join(";"));
        const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }}>Télécharger (CSV)</button>
      <span className="tile-foot" data-fill-note aria-live="polite" />
    </div>
  );
}
