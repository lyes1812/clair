"use client";
import { useActionState, type ReactNode } from "react";
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
// Liens « ? » vers le glossaire, rendus par la page (composant serveur) : le glossaire n'est pas embarqué dans ce composant client.
export type KpiHelpKey = "etp" | "turnover" | "sortiesNonComptees" | "absenceTypes" | "absenceStatuts" | "absenceBase";
export type KpiFormProps = {
  slug: string;
  values: Values;
  origins: Record<string, string>; // clé du paramètre → « Valeur par défaut … » / « Modifié le … »
  kinds: Record<string, OriginKind>; // clé du paramètre → nature de l'origine
  notes: { etp: string | null; turnover: string | null; absence: string | null }; // phrase unique de chaque carte (défauts validés)
  natures: { code: string; label: string }[];
  // count : nombre d'absences du motif dans la lecture, null quand il est n.d. (jamais transmis au navigateur) ; countNd : raison du n.d.
  // (seuil de confidentialité : statut de typeCountMask, le même que KPI RH ; ou paramètre non défini ou illisible).
  types: { type: string; label: string | null; count: number | null; countNd: string | null; inRead: boolean }[];
  // Nombres n.d. parce que le seuil de confidentialité n'est pas défini ou est illisible : la raison et le lien vers sa section.
  countsNote?: { reason: string; href: string } | null;
  readLabel: string | null; // « lecture du 21/10/2026 » ; null si aucune lecture PayFit appliquée
  statuses: { code: string; label: string }[];
  disabled: boolean;
  helps?: Partial<Record<KpiHelpKey, ReactNode>>;
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

// Titre d'une règle : le « ? » du glossaire reste hors du libellé qui nomme le groupe (aria-labelledby).
const ItemHead = ({ id, title, help }: { id: string; title: string; help?: ReactNode }) => (
  <span className="pm-item-head">
    <span className="pm-item-title" id={id}>{title}</span>
    {help}
  </span>
);

// Phrase unique d'une carte : l'origine des défauts validés.
const CardNote = ({ id, text }: { id: string; text: string | null }) =>
  text ? <p className="desc pm-origin pm-card-note" data-testid={`setting-kpi-defaults-${id}`}>{text}</p> : null;

// Nombre d'absences d'un motif de la lecture : le nombre, ou n.d. avec sa raison au survol (comme la tuile Absentéisme de KPI RH).
function TypeCount({ count, nd }: { count: number | null; nd: string | null }) {
  if (nd !== null || count === null)
    return (
      <span className="desc" data-testid="setting-kpi-types-count">
        absences : <abbr className="nd" title={nd ?? "nombre non transmis"}>n.d.</abbr>
      </span>
    );
  return <span className="desc" data-testid="setting-kpi-types-count">{count} absence{count > 1 ? "s" : ""}</span>;
}

export function KpiForm({ slug, values, origins, kinds, notes, natures, types, countsNote = null, readLabel, statuses, disabled, helps = {} }: KpiFormProps) {
  const [state, action, pending] = useActionState(saveKpiSettings.bind(null, slug), undefined);
  return (
    <form className="form" action={action}>
      <Feedback state={state} testid="setting-kpi-status" />

      <div className="pm-cols">
        <fieldset className="pm-card" disabled={disabled}>
          <legend className="label">ETP contractuel{helps.etp}</legend>
          <div className="pm-card-body">
            <CardNote id="etp" text={notes.etp} />
            <div className="pm-item">
              <label className="check">
                <input type="checkbox" name="fullTimeIsOne" defaultChecked={values.fullTimeIsOne} data-testid="setting-kpi-etp-full-time" />
                <span>Un contrat à temps plein vaut 1 ETP, quelle que soit sa durée</span>
              </label>
              <Origin id="etp-full-time" name="fullTimeIsOne" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item">
              <label className="check">
                <input type="checkbox" name="capAtOne" defaultChecked={values.capAtOne} data-testid="setting-kpi-etp-cap" />
                <span>Un contrat ne vaut jamais plus de 1 ETP</span>
              </label>
              <Origin id="etp-cap" name="capAtOne" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item">
              <label className="check">
                <input type="checkbox" name="forfaitJoursIsOne" defaultChecked={values.forfaitJoursIsOne} data-testid="setting-kpi-etp-forfait-jours" />
                <span>PayFit : un contrat au forfait jours sans quotité ni indicateur « temps plein » vaut 1 ETP</span>
              </label>
              <Origin id="etp-forfait-jours" name="forfaitJoursIsOne" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item">
              <div className="field-row pm-field-narrow">
                <label htmlFor="etpDecimals">Décimales de la quotité de chaque contrat</label>
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
          <legend className="label">Turnover{helps.turnover}</legend>
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
                <span>Contrats continus neutralisés : ni sortie, ni entrée</span>
              </label>
              <Origin id="turnover-continuity" name="neutralizeContinuity" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item" role="group" aria-labelledby="kpi-excluded-title">
              <ItemHead id="kpi-excluded-title" title="Sorties non comptées au turnover, par nature" help={helps.sortiesNonComptees} />
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
              <ItemHead id="kpi-types-title" title="Motifs retenus pour l'absentéisme" help={helps.absenceTypes} />
              {readLabel === null ? (
                <p className="desc" data-testid="setting-kpi-types-empty">Aucune lecture PayFit appliquée : aucun motif à choisir. DSN : arrêts non extraits.</p>
              ) : (
                <p className="desc" data-testid="setting-kpi-types-help">Motifs de la {readLabel}. Cocher explicitement les motifs à compter ; les autres restent visibles dans le détail.</p>
              )}
              <div className="pm-checks">
                {types.map((t) => (
                  <label key={t.type} className="check">
                    <input type="checkbox" name="absenceTypes" value={t.type} defaultChecked={values.absenceTypes.includes(t.type)} data-testid="setting-kpi-absence-types" />
                    <span className="pm-type">
                      <span>{t.label ?? "Motif sans libellé connu"} <code>{t.type}</code></span>
                      {t.inRead ? <TypeCount count={t.count} nd={t.countNd} /> : <span className="desc" data-testid="setting-kpi-types-missing">absent de la lecture appliquée (sans effet)</span>}
                    </span>
                  </label>
                ))}
              </div>
              {countsNote && (
                <p className="desc" data-testid="setting-kpi-types-confidentialite">
                  Nombres d'absences : n.d. — <a href={countsNote.href}>{countsNote.reason}</a>
                </p>
              )}
              {values.absenceTypes.length === 0 && <p className="desc">Aucun motif retenu : absentéisme n.d.</p>}
              <Origin id="absence-types" name="absenceTypes" kinds={kinds} origins={origins} />
            </div>
            <div className="pm-item" role="group" aria-labelledby="kpi-statuses-title">
              <ItemHead id="kpi-statuses-title" title="Statuts PayFit comptés" help={helps.absenceStatuts} />
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
              <ItemHead id="kpi-basis-title" title="Base de comptage des jours : absentéisme et prorata de l'ETP proratisé" help={helps.absenceBase} />
              <label className="check">
                <input type="radio" name="dayBasis" value="calendar" defaultChecked={values.dayBasis === "calendar"} data-testid="setting-kpi-absence-basis" />
                <span>Jours calendaires</span>
              </label>
              <label className="check">
                <input type="radio" name="dayBasis" value="weekdays" defaultChecked={values.dayBasis === "weekdays"} />
                <span>Jours du lundi au vendredi</span>
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
