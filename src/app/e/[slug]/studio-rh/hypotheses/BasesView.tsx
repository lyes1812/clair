import { MoneyText } from "@/components/Money";
import { GlossaryLink } from "@/components/GlossaryLink";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { enteredAfter, roundDiv } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { BUDGET_TERMS } from "@/lib/glossary/budget";
import { fmtEtp4, fmtFixed } from "@/lib/rh/kpi/format";
import { dateFr } from "@/lib/viz/hyp-saisie";
import { deMois, frDates } from "@/lib/viz/hyp-saisie-fmt";
import { ActionForm } from "./ActionForm";
import { saveBasesAction } from "./actions";
import { DirtyIndicator, GridTools } from "./GridTools";
import { CardTitle, detailOf, decText } from "./shared";

// Bases individuelles : base figée du scénario (réel jusqu'au mois de référence) et correction de la base de chaque
// contrat — salaire mensuel de base et taux de charges saisis par l'utilisateur, jamais déduits.
export function BasesView({ slug, scenario, base, hypotheses, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; canEdit: boolean }) {
  const fixes = new Map(hypotheses.flatMap((h) => (h.kind === "base" ? [[h.contractKey, h] as const] : [])));
  const toFix = base.contracts.filter((c) => !c.base && !fixes.has(c.contractKey));
  const cost = (c: BaseSnapshot["contracts"][number]) => (c.base ? c.base.salaryCents + roundDiv(BigInt(c.base.salaryCents) * BigInt(c.base.refCotisationsCents), BigInt(c.base.refBrutCents)) : null);
  const rows = base.contracts;
  const table = (
    <div className="table-wrap scroll" {...(canEdit ? {} : { role: "region", "aria-label": "Contrats de la base", tabIndex: 0 })}>
      <table className={`data-table month-grid sticky sticky-first hs-bases${canEdit ? " hs-edit" : ""}`} data-testid="hyp-base-contracts">
        <thead>
          <tr>
            <th>Contrat</th><th>Service</th><th>Statut</th><th>Entrée</th><th>Fin connue</th><th className="num">ETP</th><th className="num">Salaire</th><th className="num">Taux de charges</th><th className="num">Coût mensuel</th>
            {canEdit && <><th>Salaire corrigé (€)</th><th>Charges corrigées (%)</th></>}
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const fix = fixes.get(c.contractKey);
            return (
              <tr key={c.contractKey} data-contract={c.externalId}>
                <td>{c.label}{canEdit && <input type="hidden" name={`key_${i}`} value={c.contractKey} />}</td>
                <td>{c.service ?? <span title={c.serviceNd ? frDates(c.serviceNd) : undefined}>Non ventilé{c.serviceNd ? " (voir note)" : ""}</span>}</td>
                <td>{c.executive === true ? "Cadre dirigeant" : c.executive === false ? "Hors cadre dirigeant" : "n.d."}</td>
                <td>{dateFr(c.startDate) ?? "n.d."}</td>
                <td>{dateFr(c.endDate) ?? "—"}</td>
                <td className="num">{c.etp4 === null ? <span title={c.etpNd ? frDates(c.etpNd) : undefined}>n.d.</span> : fmtEtp4(c.etp4)}</td>
                <td className="num">{c.base ? formatEuros(c.base.salaryCents) : "n.d."}</td>
                <td className="num">{c.base ? `${fmtFixed({ num: c.base.refCotisationsCents * 100, den: c.base.refBrutCents }, 2)} %` : "n.d."}</td>
                <td className="num">{cost(c) === null ? "n.d." : formatEuros(cost(c)!)}</td>
                {canEdit && (
                  <>
                    <td><input className="input" name={`salary_${i}`} data-cell data-row={`b${i}`} data-col="salary" inputMode="decimal" defaultValue={fix ? decText(fix.salaryCents) : ""} aria-label={`Salaire corrigé de ${c.label}`} /></td>
                    <td><input className="input" name={`charges_${i}`} data-cell data-row={`b${i}`} data-col="charges" inputMode="decimal" defaultValue={fix ? decText(fix.chargesBps) : ""} aria-label={`Taux de charges corrigé de ${c.label}`} /></td>
                  </>
                )}
                <td className="wrap">{fix ? `corrigée : ${detailOf(fix, base, hypotheses)}` : c.baseNd ? <span className="nd">n.d. — {frDates(c.baseNd)}</span> : c.baseNote ? `figée — ${frDates(c.baseNote)}` : "figée"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  // « Copier vers le bas » seulement : un salaire n'a pas de sens dans la colonne des charges, ni l'inverse.
  const frame = (
    <div className="hs-grid" data-grid-root>
      <GridTools filename={`bases-${scenario.firstMonth}.csv`} tools={["down"]} readOnly={!canEdit} help={<GlossaryLink slug={slug} term={BUDGET_TERMS.grilles} />} />
      {table}
    </div>
  );
  return (
    <MoneyText><section className="panel" data-testid="hyp-base">
      <CardTitle title={`Base figée sur ${formatMonth(base.refMonth).toLowerCase()}`} help={<GlossaryLink slug={slug} term={BUDGET_TERMS.base} />} />
      {base.origin && base.origin.notCarried.length > 0 && (
        <p className="notice" data-testid="hyp-base-origin">
          Non repris car postérieurs à {formatMonth(base.origin.month).toLowerCase()} : {frDates(base.origin.notCarried.join(" ; "))}.
          <GlossaryLink slug={slug} term={BUDGET_TERMS.derivee} />
        </p>
      )}
      <dl className="facts hs-tiles">
        <div data-testid="hyp-base-total">
          <dt>Coût mensuel de la base ({base.contracts.filter((c) => !enteredAfter(base, c)).length} contrats présents fin {formatMonth(base.refMonth).toLowerCase()})</dt>
          <dd className={base.refBaseCost === null ? "nd" : undefined}>{base.refBaseCost === null ? `n.d. — ${base.contracts.filter((c) => !c.base && !enteredAfter(base, c)).length} base(s) de contrat n.d.` : formatEuros(base.refBaseCost)}</dd>
          <span className="tile-foot"><GlossaryLink slug={slug} term={BUDGET_TERMS.baseContrat} /></span>
        </div>
        <div data-testid="hyp-base-masse">
          {base.origin ? (
            <>
              <dt>Coût projeté {deMois(base.refMonth)} par « {base.origin.scenarioName} »</dt>
              <dd>{formatEuros(base.refMasse)}</dd>
              <span className="tile-foot" data-testid="hyp-base-gap">
                {base.refBaseCost === null
                  ? "écart avec la base : n.d."
                  : base.origin.gap === undefined
                    ? `écart avec la base : ${formatEuros(base.refMasse - base.refBaseCost)} (non ventilé : base dérivée créée avant la ventilation par nature)`
                    : base.origin.gap.length === 0
                      ? "égal à la base dérivée"
                      : `non repris dans la base : ${frDates(base.origin.gap.map((g) => `${g.label} ${formatEuros(g.cost)}`).join(" ; "))}`}
              </span>
            </>
          ) : (
            <>
              <dt>Masse salariale réelle {deMois(base.refMonth)}</dt>
              <dd>{formatEuros(base.refMasse)}</dd>
              <span className="tile-foot">{base.refBaseCost === null ? "écart avec la base : n.d." : `hors base : ${formatEuros(base.refMasse - base.refBaseCost)}`}</span>
            </>
          )}
        </div>
      </dl>
      {toFix.length > 0 && (
        <p className="notice" data-testid="hyp-base-nd">{toFix.length} contrat(s) sans base : la projection est n.d. tant qu'une correction de base n'est pas saisie.</p>
      )}
      <h3>Contrats de la base<GlossaryLink slug={slug} term={BUDGET_TERMS.bases} /></h3>
      {canEdit ? (
        <ActionForm action={saveBasesAction.bind(null, slug, scenario.id)} submit="Enregistrer les bases corrigées" testid="bases-grid" className="form hs-grid-form" footer={<DirtyIndicator />}>
          <input type="hidden" name="n" value={rows.length} />
          {frame}
          <p className="tile-foot">Correction de la base d'un contrat : salaire et taux vont ensemble ; les deux champs vides retirent la correction.</p>
        </ActionForm>
      ) : frame}
      {(base.etpNote || base.contracts.some((c) => c.serviceNd)) && (
        <p className="tile-foot" data-testid="hyp-base-notes">
          {base.etpNote ? `ETP : ${frDates(base.etpNote)}. ` : ""}
          {base.contracts.filter((c) => c.serviceNd).map((c) => `${c.label} : ${frDates(c.serviceNd ?? "")}`).join(" ; ")}
        </p>
      )}
    </section></MoneyText>
  );
}
