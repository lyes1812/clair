"use client";
import { useActionState } from "react";
import { savePayrollGrid } from "./actions";

type Row = { id: string; label: string; role: string; prefixes: string[] };

export function PayrollGridForm({ slug, rows, disabled }: { slug: string; rows: Row[]; disabled: boolean }) {
  const [state, action, pending] = useActionState(savePayrollGrid.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice" role="status">{state.ok}</p>}
      <fieldset className="checks" disabled={disabled}>
        <legend className="label">Préfixes de comptes par rubrique (séparés par des virgules)</legend>
        {rows.map((r) => (
          <div key={r.id} className="field-row">
            <label htmlFor={`grid-${r.id}`}>
              {r.label} <span className="tile-foot">({r.role === "brut" ? "brut" : r.role === "cotisations" ? "cotisations patronales" : "hors masse chargée"})</span>
            </label>
            <input className="input" id={`grid-${r.id}`} name={r.id} defaultValue={r.prefixes.join(", ")} data-testid={`setting-payroll-${r.id}`} />
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
