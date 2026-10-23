"use client";
import { useActionState } from "react";
import { Feedback } from "./Feedback";
import { savePayfitHistory } from "./actions";

const CHOICES = [
  { value: "raw", label: "Brut : chiffres tels que l'API PayFit les renvoie, avec une mention unique en tête d'écran sur la limite de conservation." },
  { value: "flagged", label: "Signalé : mois antérieurs à la limite affichés « ≥ » (effectifs, entrées) ou n.d. (sorties, turnover, absentéisme)." },
] as const;

export function PayfitHistoryForm({ slug, mode, disabled }: { slug: string; mode: "raw" | "flagged"; disabled: boolean }) {
  const [state, action, pending] = useActionState(savePayfitHistory.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <fieldset className="checks pm-checks pm-choices" disabled={disabled}>
        <legend className="label">Mois antérieurs à la limite de conservation PayFit</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="check">
            <input type="radio" name="mode" value={c.value} defaultChecked={mode === c.value} data-testid={`setting-payfit-history-${c.value}`} />
            <span>{c.label}</span>
          </label>
        ))}
      </fieldset>
      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-payfit-history-save">{pending ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      )}
    </form>
  );
}
