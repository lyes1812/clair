"use client";
import { useActionState } from "react";
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId } from "@/lib/budget/types";
import { Feedback } from "./Feedback";
import { saveCategoryNatures } from "./actions";

export function CategoryNaturesForm({ slug, natures, disabled }: { slug: string; natures: Record<CategoryId, string[]>; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveCategoryNatures.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <fieldset className="checks pm-grid-fields pm-grid-codes" disabled={disabled}>
        <legend className="label">Codes de nature de contrat (DSN) par catégorie, séparés par des virgules</legend>
        {CATEGORY_IDS.map((id) => (
          <div className="field-row" key={id}>
            <label htmlFor={`cat-${id}`}>{CATEGORY_LABELS[id]}</label>
            <input className="input" id={`cat-${id}`} name={id} defaultValue={natures[id].join(", ")} placeholder="aucun code" data-testid={`setting-category-${id}`} />
          </div>
        ))}
      </fieldset>
      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-category-save">{pending ? "Enregistrement…" : "Enregistrer les catégories"}</button>
        </div>
      )}
    </form>
  );
}
