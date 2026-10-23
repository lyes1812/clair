"use client";
import { useActionState } from "react";
import { CATEGORY_IDS, CATEGORY_LABELS, type CategoryId } from "@/lib/budget/types";
import { saveCategoryNatures } from "./actions";

export function CategoryNaturesForm({ slug, natures, disabled }: { slug: string; natures: Record<CategoryId, string[]>; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveCategoryNatures.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice" role="status">{state.ok}</p>}
      <fieldset className="checks" disabled={disabled}>
        <legend className="label">Codes de nature de contrat (DSN) par catégorie, séparés par des virgules</legend>
        {CATEGORY_IDS.map((id) => (
          <div className="field-row" key={id} style={{ maxWidth: 360 }}>
            <label htmlFor={`cat-${id}`}>{CATEGORY_LABELS[id]}</label>
            <input className="input" id={`cat-${id}`} name={id} defaultValue={natures[id].join(", ")} data-testid={`setting-category-${id}`} />
          </div>
        ))}
      </fieldset>
      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-category-save">{pending ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      )}
    </form>
  );
}
