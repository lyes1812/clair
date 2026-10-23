"use client";
import { useActionState, useState } from "react";
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId } from "@/lib/budget/types";
import { foldText, Pill } from "../donnees/ui";
import { Feedback } from "./Feedback";
import { saveContractCategories } from "./actions";

export type ContractRow = { id: string; label: string; natureLabel: string; proposed: CategoryId | null; chosen: CategoryId | null };

// Les lignes écartées par le filtre restent dans le formulaire (masquées) : leurs choix en cours sont envoyés avec les autres.
export function ContractCategoriesForm({ slug, rows, disabled }: { slug: string; rows: ContractRow[]; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveContractCategories.bind(null, slug), undefined);
  const [query, setQuery] = useState("");
  const q = foldText(query.trim());
  const visible = (r: ContractRow) => q === "" || foldText(`${r.label} ${r.natureLabel}`).includes(q);
  const shown = rows.filter(visible).length;
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      {rows.length > 0 && (
        <div className="pm-table-tools">
          <div className="field-row pm-field-narrow">
            <label htmlFor="contract-filter">Filtrer les contrats</label>
            <input className="input" id="contract-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} placeholder="Nom ou nature du contrat" autoComplete="off" />
          </div>
          <p className="desc" aria-live="polite">{q === "" ? `${rows.length} contrat${rows.length > 1 ? "s" : ""} en cours` : `${shown} contrat${shown > 1 ? "s" : ""} affiché${shown > 1 ? "s" : ""} sur ${rows.length}`}</p>
        </div>
      )}
      <div className="table-wrap scroll pm-contracts">
        <table className="data-table sticky" data-testid="setting-contract-categories">
          <thead><tr><th scope="col">Contrat en cours</th><th scope="col">Nature</th><th scope="col">Proposée</th><th scope="col">Catégorie retenue</th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="wrap"><span className="nd">n.d. — aucun contrat en cours à lister (source RH non retenue, référentiel indisponible, ou tous les contrats terminés).</span></td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} hidden={!visible(r)}>
                <td>{r.label}<input type="hidden" name="listed" value={r.id} /></td>
                <td>{r.natureLabel}</td>
                <td>{r.proposed ? CATEGORY_LABELS[r.proposed] : <span className="nd">non classé</span>}</td>
                <td>
                  <span className="pm-choice-cell">
                    <select className="select" name={`c:${r.id}`} defaultValue={r.chosen ?? ""} disabled={disabled} aria-label={`Catégorie de ${r.label}`}>
                      <option value="">Selon la nature</option>
                      {CATEGORY_IDS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                    {r.chosen && <Pill tone="preview">Corrigée</Pill>}
                  </span>
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
