"use client";
import { useActionState } from "react";
import { Feedback } from "./Feedback";
import { saveHeadcountNatures } from "./actions";

export function HeadcountForm({ slug, choices, selected, disabled }: { slug: string; choices: { code: string; label: string }[]; selected: string[]; disabled: boolean }) {
  const [state, action, pending] = useActionState(saveHeadcountNatures.bind(null, slug), undefined);
  const known = new Set(choices.map((c) => c.code));
  const extra = selected.filter((c) => !known.has(c));
  return (
    <form className="form" action={action}>
      <Feedback state={state} />
      <fieldset className="checks pm-checks pm-chips" disabled={disabled}>
        <legend className="label">Natures comptées dans l'effectif</legend>
        {choices.map((c) => (
          <label key={c.code} className="check">
            <input type="checkbox" name="natures" value={c.code} defaultChecked={selected.includes(c.code)} />
            <span>{c.label} <code>{c.code}</code></span>
          </label>
        ))}
      </fieldset>
      <div className="field-row pm-field-narrow">
        <label htmlFor="extra">Autres codes de nature (deux chiffres, séparés par des virgules)</label>
        <input className="input" id="extra" name="extra" defaultValue={extra.join(", ")} disabled={disabled} placeholder="ex. 50, 60" />
      </div>
      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer les natures comptées"}</button>
        </div>
      )}
    </form>
  );
}
