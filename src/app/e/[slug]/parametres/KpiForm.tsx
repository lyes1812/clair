"use client";
import { useActionState } from "react";
import type { OriginKind } from "../donnees/ui";
import { Feedback } from "./Feedback";
import { saveKpiSettings } from "./actions";

type Values = {
  fullTimeIsOne: boolean;
  capAtOne: boolean;
  forfaitJoursIsOne: boolean;
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
  origins: Record<string, string>; // clé du paramètre → « Valeur par défaut … » / « Modifié le … »
  kinds: Record<string, OriginKind>; // clé du paramètre → nature de l'origine
  notes: { etp: string | null; turnover: string | null; absence: string | null }; // phrase unique de chaque carte (défauts validés)
  natures: { code: string; label: string }[];
  types: { type: string; label: string | null; count: number; inRead: boolean }[];
  readLabel: string | null; // « lecture du 21/10/2026 » ; null si aucune lecture PayFit appliquée
  statuses: { code: string; label: string }[];
  disabled: boolean;
};

// Origine d'une règle : rien pour un défaut validé (dit une fois par carte), sa mention pour une exception (modifiée, proposée, illisible).
function Origin({ id, name, kinds, origins }: { id: string; name: string; kinds: KpiFormProps["kinds"]; origins: KpiFormProps["origins"] }) {
  if (kinds[name] === "validated") return null;
  return (
    <span className="desc pm-origin" data-missing={kinds[name] === "invalid" ? "true" : undefined} data-testid={`setting-kpi-origin-${id}`}>
      {origins[name]}
    </span>
  );
}

// Phrase unique d'une carte : l'origine des défauts validés.
const CardNote = ({ id, text }: { id: string; text: string | null }) =>
  text ? <p className="desc pm-origin pm-card-note" data-testid={`setting-kpi-defaults-${id}`}>{text}</p> : null;

export function KpiForm({ slug, values, origins, kinds, notes, natures, types, readLabel, statuses, disabled }: KpiFormProps) {
  const [state, action, pending] = useActionState(saveKpiSettings.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} testid="setting-kpi-status" />

      <div className="pm-cols">
        <fieldset className="pm-card" disabled={disabled}>
          <legend className="label">ETP contractuel</legend>
          <div className="pm-card-body">
            <CardNote id="etp" text={notes.etp} />
            <div className="pm-item">
              <label className="check">
                <input type="checkbox" name="fullTimeIsOne" defaultChecked={values.fullTimeIsOne} data-testid="setting-kpi-etp-full-time" />
                <span>Un contrat à temps plein vaut 1 ETP quelle que soit sa durée (39 h = 1 ; forfait jours à temps plein = 1). PayFit : indicateur « temps plein » ; DSN : modalité S21.G00.40.014 = 10.</span>
              </label>
              <Origin id="etp-full-time" name="fullTimeIsOne" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item">
              <label className="check">
                <input type="checkbox" name="capAtOne" defaultChecked={values.capAtOne} data-testid="setting-kpi-etp-cap" />
                <span>Un contrat ne vaut jamais plus de 1 ETP (rapport supérieur à 1 ramené à 1 et signalé).</span>
              </label>
              <Origin id="etp-cap" name="capAtOne" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item">
              <label className="check">
                <input type="checkbox" name="forfaitJoursIsOne" defaultChecked={values.forfaitJoursIsOne} data-testid="setting-kpi-etp-forfait-jours" />
                <span>PayFit : un contrat au forfait jours sans quotité ni indicateur « temps plein » renseignés vaut 1 ETP (signalé dans le détail). Un indicateur « temps plein » à non reste n.d.</span>
              </label>
              <Origin id="etp-forfait-jours" name="forfaitJoursIsOne" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item">
              <div className="field-row pm-field-narrow">
                <label htmlFor="etpDecimals">Décimales de la quotité de chaque contrat (arrondie avant la somme)</label>
                <select className="select" id="etpDecimals" name="etpDecimals" defaultValue={String(values.etpDecimals)} data-testid="setting-kpi-etp-decimals">
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </div>
              <Origin id="etp-decimals" name="etpDecimals" kinds={kinds} origins={origins} />
            </div>
          </div>
        </fieldset>

        <fieldset className="pm-card" disabled={disabled}>
          <legend className="label">Turnover</legend>
          <div className="pm-card-body">
            <CardNote id="turnover" text={notes.turnover} />
            <div className="pm-item">
              <label className="check">
                <input type="radio" name="turnoverFormula" value="half_sum" defaultChecked={values.turnoverFormula === "half_sum"} data-testid="setting-kpi-turnover-formula" />
                <span>((entrées + sorties) ÷ 2) ÷ effectif moyen de la période</span>
              </label>
              <label className="check">
                <input type="radio" name="turnoverFormula" value="exits_over_start" defaultChecked={values.turnoverFormula === "exits_over_start"} />
                <span>sorties ÷ effectif (personnes) au premier jour de la période</span>
              </label>
              <Origin id="turnover-formula" name="turnoverFormula" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item">
              <label className="check">
                <input type="checkbox" name="neutralizeContinuity" defaultChecked={values.neutralizeContinuity} data-testid="setting-kpi-turnover-continuity" />
                <span>Contrats continus neutralisés : fin le jour J et nouveau contrat de la même personne le jour J+1 (ex. CDD → CDI), les deux de natures comptées : ni sortie, ni entrée.</span>
              </label>
              <Origin id="turnover-continuity" name="neutralizeContinuity" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item" role="group" aria-labelledby="kpi-excluded-title">
              <span className="pm-item-title" id="kpi-excluded-title">Sorties non comptées au turnover, par nature</span>
              <p className="desc">Le motif DSN n'est pas utilisé : PayFit ne le fournit pas. Aucune nature cochée : toutes les sorties comptent.</p>
              <div className="pm-checks pm-chips">
                {natures.map((n) => (
                  <label key={n.code} className="check">
                    <input type="checkbox" name="excludedExitNatures" value={n.code} defaultChecked={values.excludedExitNatures.includes(n.code)} data-testid="setting-kpi-turnover-excluded" />
                    <span>{n.label} <code>{n.code}</code></span>
                  </label>
                ))}
              </div>
              <Origin id="turnover-excluded" name="excludedExitNatures" kinds={kinds} origins={origins} />
            </div>
          </div>
        </fieldset>

        <fieldset className="pm-card pm-wide" disabled={disabled}>
          <legend className="label">Absentéisme</legend>
          <div className="pm-card-body">
            <CardNote id="absence" text={notes.absence} />
            <div className="pm-item" role="group" aria-labelledby="kpi-types-title">
              <span className="pm-item-title" id="kpi-types-title">Types d'absence comptés</span>
              {readLabel === null ? (
                <p className="desc" data-testid="setting-kpi-types-empty">
                  Aucune lecture PayFit appliquée : les types ne peuvent pas encore être choisis ; en DSN, les arrêts ne sont pas extraits.
                </p>
              ) : (
                <p className="desc">Types présents dans la {readLabel}, avec leur nombre d'absences.</p>
              )}
              <div className="pm-checks">
                {types.map((t) => (
                  <label key={t.type} className="check">
                    <input type="checkbox" name="absenceTypes" value={t.type} defaultChecked={values.absenceTypes.includes(t.type)} data-testid="setting-kpi-absence-types" />
                    <span className="pm-type">
                      <span>{t.label ?? "Type sans libellé connu"} <code>{t.type}</code></span>
                      {t.inRead ? <span className="desc">{t.count} absence{t.count > 1 ? "s" : ""}</span> : <span className="desc" data-testid="setting-kpi-types-missing">absent de la lecture appliquée (sans effet)</span>}
                    </span>
                  </label>
                ))}
              </div>
              {values.absenceTypes.length === 0 && <p className="desc">Aucun type choisi : l'absentéisme est n.d.</p>}
              <Origin id="absence-types" name="absenceTypes" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item" role="group" aria-labelledby="kpi-statuses-title">
              <span className="pm-item-title" id="kpi-statuses-title">Statuts PayFit comptés</span>
              <p className="desc">Une absence sans statut n'est jamais comptée : le taux devient « ≥ x ».</p>
              <div className="pm-checks pm-chips">
                {statuses.map((s) => (
                  <label key={s.code} className="check">
                    <input type="checkbox" name="absenceStatuses" value={s.code} defaultChecked={values.absenceStatuses.includes(s.code)} data-testid="setting-kpi-absence-statuses" />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
              <Origin id="absence-statuses" name="absenceStatuses" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item" role="group" aria-labelledby="kpi-basis-title">
              <span className="pm-item-title" id="kpi-basis-title">Base de comptage des jours</span>
              <label className="check">
                <input type="radio" name="dayBasis" value="calendar" defaultChecked={values.dayBasis === "calendar"} data-testid="setting-kpi-absence-basis" />
                <span>Jours calendaires</span>
              </label>
              <label className="check">
                <input type="radio" name="dayBasis" value="weekdays" defaultChecked={values.dayBasis === "weekdays"} />
                <span>Jours du lundi au vendredi (aucun jour férié n'est connu de l'application)</span>
              </label>
              <Origin id="absence-basis" name="dayBasis" kinds={kinds} origins={origins} />
            </div>
          </div>
        </fieldset>
      </div>

      {!disabled && (
        <div className="actions">
          <button className="btn primary" type="submit" disabled={pending} data-testid="setting-kpi-save">{pending ? "Enregistrement…" : "Enregistrer les définitions des KPI"}</button>
        </div>
      )}
    </form>
  );
}
