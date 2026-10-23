"use client";
import { useActionState } from "react";
import { Feedback } from "./Feedback";
import { saveServiceAxis } from "./actions";

export function ServiceAxisForm({ slug, axes, current, disabled }: { slug: string; axes: string[]; current: string | null; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveServiceAxis.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <div className="inline-form pm-inline">
        <div className="field-row pm-field-narrow">
          <label htmlFor="serviceAxis">Axe analytique qui porte le service (journal PayFit)</label>
          <select className="select" id="serviceAxis" name="serviceAxis" defaultValue={current ?? ""} disabled={disabled} data-testid="setting-payroll-axis">
            <option value="">Aucun (pas de ventilation par service)</option>
            {axes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {!disabled && (
          <button className="btn" type="submit" disabled={pending} data-testid="setting-payroll-axis-save">{pending ? "Enregistrement…" : "Enregistrer l'axe"}</button>
        )}
      </div>
    </form>
  );
}
