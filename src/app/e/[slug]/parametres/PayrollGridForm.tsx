"use client";
import { useActionState } from "react";
import { balanceColumns } from "../donnees/ui";
import { Feedback } from "./Feedback";
import { savePayrollGrid } from "./actions";

type Row = { id: string; label: string; role: string; prefixes: string[] };

// Les rubriques sont regroupées par rôle dans la masse chargée ; le rôle de chaque rubrique est fixe, seuls les préfixes se paramètrent.
const GROUPS: { role: string; title: string }[] = [
  { role: "brut", title: "Brut" },
  { role: "cotisations", title: "Cotisations patronales" },
  { role: "hors-masse", title: "Hors masse chargée" },
];

export function PayrollGridForm({ slug, rows, disabled }: { slug: string; rows: Row[]; disabled: boolean }) {
  const [state, action, pending] = useActionState(savePayrollGrid.bind(null, slug), undefined);
  const known = new Set(GROUPS.map((g) => g.role));
  const groups = [...GROUPS, { role: "", title: "Autres rubriques" }]
    .map((g) => ({ ...g, rows: rows.filter((r) => (g.role === "" ? !known.has(r.role) : r.role === g.role)) }))
    .filter((g) => g.rows.length > 0);
  // Deux colonnes de hauteurs voisines : chaque boîte va dans la colonne la moins haute.
  const columns = balanceColumns(groups.map((g) => g.rows.length));
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <fieldset className="checks pm-grid-fields pm-grid-two" disabled={disabled}>
        <legend className="label">Préfixes de comptes par rubrique (séparés par des virgules)</legend>
        {columns.map((indices, c) => (
          <div key={c} className="pm-col">
            {indices.map((i) => {
              const g = groups[i];
              return (
                <div key={g.title} className="pm-box">
                  <span className="pm-box-title">{g.title}</span>
                  {g.rows.map((r) => (
                    <div key={r.id} className="field-row">
                      {/* Un libellé identique au titre de la boîte reste lu par les lecteurs d'écran, sans doublon visuel. */}
                      <label htmlFor={`grid-${r.id}`} className={r.label === g.title ? "pm-vh" : undefined}>{r.label}</label>
                      <input className="input" id={`grid-${r.id}`} name={r.id} defaultValue={r.prefixes.join(", ")} placeholder="aucun préfixe" data-testid={`setting-payroll-${r.id}`} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </fieldset>
      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-payroll-save">{pending ? "Enregistrement…" : "Enregistrer la grille"}</button>
        </div>
      )}
    </form>
  );
}
