"use client";
import { useActionState } from "react";
import { saveKpiSettings } from "./actions";

type Values = {
  fullTimeIsOne: boolean;
  capAtOne: boolean;
  etpDecimals: number;
  turnoverFormula: string;
  excludedExitNatures: string[];
  neutralizeContinuity: boolean;
  absenceTypes: string[];
  absenceStatuses: string[];
  dayBasis: string;
};
export type KpiFormProps = {
  slug: string;
  values: Values;
  origins: Record<string, string>; // clé courte → « Valeur par défaut … » / « Modifié le … »
  natures: { code: string; label: string }[];
  types: { type: string; count: number; inRead: boolean }[];
  readLabel: string | null; // « lecture du 21/10/2026 » ; null si aucune lecture PayFit appliquée
  statuses: { code: string; label: string }[];
  disabled: boolean;
};

const Origin = ({ id, text }: { id: string; text: string }) => (
  <span className="desc" data-testid={`setting-kpi-origin-${id}`}>
    {text}
  </span>
);

export function KpiForm({ slug, values, origins, natures, types, readLabel, statuses, disabled }: KpiFormProps) {
  const [state, action, pending] = useActionState(saveKpiSettings.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="notice" role="status" data-testid="setting-kpi-status">{state.ok}</p>}

      <fieldset className="checks" disabled={disabled}>
        <legend className="label">ETP contractuel</legend>
        <label className="check">
          <input type="checkbox" name="fullTimeIsOne" defaultChecked={values.fullTimeIsOne} data-testid="setting-kpi-etp-full-time" />
          <span>Un contrat à temps plein vaut 1 ETP quelle que soit sa durée (39 h = 1 ; forfait jours à temps plein = 1). PayFit : indicateur « temps plein » ; DSN : modalité S21.G00.40.014 = 10.</span>
        </label>
        <Origin id="etp-full-time" text={origins.fullTimeIsOne} />
        <label className="check">
          <input type="checkbox" name="capAtOne" defaultChecked={values.capAtOne} data-testid="setting-kpi-etp-cap" />
          <span>Un contrat ne vaut jamais plus de 1 ETP (rapport supérieur à 1 ramené à 1 et signalé).</span>
        </label>
        <Origin id="etp-cap" text={origins.capAtOne} />
        <div className="field-row" style={{ maxWidth: 320 }}>
          <label htmlFor="etpDecimals">Décimales de la quotité de chaque contrat (arrondie avant la somme)</label>
          <select className="select" id="etpDecimals" name="etpDecimals" defaultValue={String(values.etpDecimals)} data-testid="setting-kpi-etp-decimals">
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </div>
        <Origin id="etp-decimals" text={origins.etpDecimals} />
      </fieldset>

      <fieldset className="checks" disabled={disabled}>
        <legend className="label">Turnover</legend>
        <label className="check">
          <input type="radio" name="turnoverFormula" value="half_sum" defaultChecked={values.turnoverFormula === "half_sum"} data-testid="setting-kpi-turnover-formula" />
          <span>((entrées + sorties) ÷ 2) ÷ effectif moyen de la période</span>
        </label>
        <label className="check">
          <input type="radio" name="turnoverFormula" value="exits_over_start" defaultChecked={values.turnoverFormula === "exits_over_start"} />
          <span>sorties ÷ effectif (personnes) au premier jour de la période</span>
        </label>
        <Origin id="turnover-formula" text={origins.turnoverFormula} />
        <label className="check">
          <input type="checkbox" name="neutralizeContinuity" defaultChecked={values.neutralizeContinuity} data-testid="setting-kpi-turnover-continuity" />
          <span>Contrats continus neutralisés : fin le jour J et nouveau contrat de la même personne le jour J+1 (ex. CDD → CDI), les deux de natures comptées : ni sortie, ni entrée.</span>
        </label>
        <Origin id="turnover-continuity" text={origins.neutralizeContinuity} />
        <span className="label">Sorties non comptées au turnover, par nature (le motif DSN n'est pas utilisé : PayFit ne le fournit pas)</span>
        {natures.map((n) => (
          <label key={n.code} className="check">
            <input type="checkbox" name="excludedExitNatures" value={n.code} defaultChecked={values.excludedExitNatures.includes(n.code)} data-testid="setting-kpi-turnover-excluded" />
            <span>{n.label} <code>{n.code}</code></span>
          </label>
        ))}
        <Origin id="turnover-excluded" text={origins.excludedExitNatures} />
      </fieldset>

      <fieldset className="checks" disabled={disabled}>
        <legend className="label">Absentéisme</legend>
        <span className="label">Types d'absence comptés</span>
        {readLabel === null && (
          <p className="desc" data-testid="setting-kpi-types-empty">
            Aucune lecture PayFit appliquée : les types ne peuvent pas encore être choisis ; en DSN, les arrêts ne sont pas extraits.
          </p>
        )}
        {types.map((t) => (
          <label key={t.type} className="check">
            <input type="checkbox" name="absenceTypes" value={t.type} defaultChecked={values.absenceTypes.includes(t.type)} data-testid="setting-kpi-absence-types" />
            <span>
              <code>{t.type}</code> — {t.inRead ? `${t.count} absence${t.count > 1 ? "s" : ""} dans la ${readLabel}` : <span data-testid="setting-kpi-types-missing">absent de la lecture appliquée (sans effet)</span>}
            </span>
          </label>
        ))}
        {values.absenceTypes.length === 0 && <p className="desc">Aucun type choisi : l'absentéisme est n.d.</p>}
        <Origin id="absence-types" text={origins.absenceTypes} />
        <span className="label">Statuts PayFit comptés (une absence sans statut n'est jamais comptée : le taux devient « ≥ x »)</span>
        {statuses.map((s) => (
          <label key={s.code} className="check">
            <input type="checkbox" name="absenceStatuses" value={s.code} defaultChecked={values.absenceStatuses.includes(s.code)} data-testid="setting-kpi-absence-statuses" />
            <span>{s.label}</span>
          </label>
        ))}
        <Origin id="absence-statuses" text={origins.absenceStatuses} />
        <label className="check">
          <input type="radio" name="dayBasis" value="calendar" defaultChecked={values.dayBasis === "calendar"} data-testid="setting-kpi-absence-basis" />
          <span>Jours calendaires</span>
        </label>
        <label className="check">
          <input type="radio" name="dayBasis" value="weekdays" defaultChecked={values.dayBasis === "weekdays"} />
          <span>Jours du lundi au vendredi (aucun jour férié n'est connu de l'application)</span>
        </label>
        <Origin id="absence-basis" text={origins.dayBasis} />
      </fieldset>

      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-kpi-save">{pending ? "Enregistrement…" : "Enregistrer les définitions des KPI"}</button>
        </div>
      )}
    </form>
  );
}
