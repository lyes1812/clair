"use client";
import { useActionState } from "react";
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId } from "@/lib/budget/types";
import { saveContractCategories } from "./actions";

export type ContractRow = { id: string; label: string; natureLabel: string; proposed: CategoryId | null; chosen: CategoryId | null };

export function ContractCategoriesForm({ slug, rows, disabled }: { slug: string; rows: ContractRow[]; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveContractCategories.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice" role="status">{state.ok}</p>}
      <div className="table-wrap">
        <table className="data-table" data-testid="setting-contract-categories">
          <thead><tr><th>Contrat en cours</th><th>Nature</th><th>Proposée</th><th>Catégorie retenue</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.label}<input type="hidden" name="listed" value={r.id} /></td>
                <td>{r.natureLabel}</td>
                <td>{r.proposed ? CATEGORY_LABELS[r.proposed] : "non classé"}</td>
                <td>
                  <select className="select" name={`c:${r.id}`} defaultValue={r.chosen ?? ""} disabled={disabled} aria-label={`Catégorie de ${r.label}`}>
                    <option value="">Selon la nature</option>
                    {CATEGORY_IDS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && <div className="actions"><button className="btn primary" type="submit" disabled={pending} data-testid="setting-contract-categories-save">{pending ? "Enregistrement…" : "Enregistrer"}</button></div>}
    </form>
  );
}
