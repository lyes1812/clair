"use client";
import { useActionState } from "react";
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
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <fieldset className="checks pm-grid-fields" disabled={disabled}>
        <legend className="label">Préfixes de comptes par rubrique (séparés par des virgules)</legend>
        {groups.map((g) => (
          <div key={g.title} className="pm-box">
            <span className="pm-box-title">{g.title}</span>
            {g.rows.map((r) => (
              <div key={r.id} className="field-row">
                <label htmlFor={`grid-${r.id}`}>{r.label}</label>
                <input className="input" id={`grid-${r.id}`} name={r.id} defaultValue={r.prefixes.join(", ")} data-testid={`setting-payroll-${r.id}`} />
              </div>
            ))}
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
