"use client";
import { useActionState } from "react";
import { saveProrata } from "./actions";

export function ProrataForm({ slug, current, labels, disabled }: { slug: string; current: "calendaire" | "ouvres" | "aucun" | null; labels: Record<"calendaire" | "ouvres" | "aucun", string>; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveProrata.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice" role="status">{state.ok}</p>}
      <fieldset className="checks" disabled={disabled}>
        <legend className="label">Prorata d'une entrée ou d'une sortie en cours de mois</legend>
        {(["calendaire", "ouvres", "aucun"] as const).map((v) => (
          <label key={v} className="check">
            <input type="radio" name="prorata" value={v} defaultChecked={current === v} data-testid={`setting-projection-${v}`} />
            <span>{labels[v]}</span>
          </label>
        ))}
      </fieldset>
      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-projection-save">{pending ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      )}
    </form>
  );
}
