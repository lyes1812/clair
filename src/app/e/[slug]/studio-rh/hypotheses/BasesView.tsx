import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { enteredAfter, roundDiv } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { fmtEtp4, fmtFixed } from "@/lib/rh/kpi/format";
import { ActionForm } from "./ActionForm";
import { saveBasesAction } from "./actions";
import { detailOf, decText } from "./shared";

// Bases individuelles : base figée du scénario (réel jusqu'au mois de référence) et correction de la base de chaque
// contrat — salaire mensuel de base et taux de charges saisis par l'utilisateur, jamais déduits.
export function BasesView({ slug, scenario, base, hypotheses, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; canEdit: boolean }) {
  const fixes = new Map(hypotheses.flatMap((h) => (h.kind === "base" ? [[h.contractKey, h] as const] : [])));
  const toFix = base.contracts.filter((c) => !c.base && !fixes.has(c.contractKey));
  const cost = (c: BaseSnapshot["contracts"][number]) => (c.base ? c.base.salaryCents + roundDiv(BigInt(c.base.salaryCents) * BigInt(c.base.refCotisationsCents), BigInt(c.base.refBrutCents)) : null);
  const rows = base.contracts;
  return (
    <section className="panel" data-testid="hyp-base">
      <h2>Base figée — {formatMonth(base.refMonth).toLowerCase()} <span className="desc">— <a href="#def-base-contrat">coût de référence d'un contrat</a></span></h2>
      {base.origin && (
        <p className="notice" data-testid="hyp-base-origin">
          Base dérivée du scénario « {base.origin.scenarioName} » : état projeté fin {formatMonth(base.origin.month).toLowerCase()} (salaires du mois complet, augmentations comprises ; embauches reprises ; départs et éléments ponctuels non repris).
          {base.origin.notCarried.length ? ` Non repris car postérieurs à ${formatMonth(base.origin.month).toLowerCase()} : ${base.origin.notCarried.join(" ; ")} — à ressaisir si besoin.` : ""}
        </p>
      )}
      <dl className="facts">
        <div data-testid="hyp-base-total">
          <dt>Coût mensuel de la base ({base.contracts.filter((c) => !enteredAfter(base, c)).length} contrats présents fin {formatMonth(base.refMonth).toLowerCase()})</dt>
          <dd className={base.refBaseCost === null ? "nd" : undefined}>{base.refBaseCost === null ? `n.d. — ${base.contracts.filter((c) => !c.base && !enteredAfter(base, c)).length} base(s) de contrat n.d.` : formatEuros(base.refBaseCost)}</dd>
          <span className="tile-foot">salaires et gratifications de stage + charges au taux observé de chaque contrat</span>
        </div>
        <div data-testid="hyp-base-masse">
          {base.origin ? (
            <>
              <dt>Coût projeté de {formatMonth(base.refMonth).toLowerCase()} par « {base.origin.scenarioName} »</dt>
              <dd>{formatEuros(base.refMasse)}</dd>
              <span className="tile-foot" data-testid="hyp-base-gap">
                {base.refBaseCost === null
                  ? "écart avec la base : n.d."
                  : base.origin.gap === undefined
                    ? `écart avec la base : ${formatEuros(base.refMasse - base.refBaseCost)} (non ventilé : base dérivée créée avant la ventilation par nature)`
                    : base.origin.gap.length === 0
                      ? "égal à la base dérivée"
                      : `non repris dans la base : ${base.origin.gap.map((g) => `${g.label} ${formatEuros(g.cost)}`).join(" ; ")}`}
              </span>
            </>
          ) : (
            <>
              <dt>Masse salariale réelle de {formatMonth(base.refMonth).toLowerCase()}</dt>
              <dd>{formatEuros(base.refMasse)}</dd>
              <span className="tile-foot">{base.refBaseCost === null ? "écart avec la base : n.d." : `hors base : ${formatEuros(base.refMasse - base.refBaseCost)} (primes, indemnités, contrats sortis dans le mois, lignes sans contrat)`}</span>
            </>
          )}
        </div>
      </dl>
      {toFix.length > 0 && (
        <p className="notice" data-testid="hyp-base-nd">{toFix.length} contrat(s) sans base : la projection est n.d. tant qu'une correction de base n'est pas saisie (salaire mensuel et taux de charges).</p>
      )}
      {(() => {
        const table = (
          <div className="table-wrap">
            <table className="data-table month-grid" data-testid="hyp-base-contracts">
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
                      <td>{c.service ?? <span title={c.serviceNd ?? undefined}>Non ventilé{c.serviceNd ? " ⚠" : ""}</span>}</td>
                      <td>{c.executive === true ? "Cadre dirigeant" : c.executive === false ? "Hors cadre dirigeant" : "n.d."}</td>
                      <td>{c.startDate ?? "n.d."}</td>
                      <td>{c.endDate ?? "—"}</td>
                      <td className="num">{c.etp4 === null ? <span title={c.etpNd ?? undefined}>n.d.</span> : fmtEtp4(c.etp4)}</td>
                      <td className="num">{c.base ? formatEuros(c.base.salaryCents) : "n.d."}</td>
                      <td className="num">{c.base ? `${fmtFixed({ num: c.base.refCotisationsCents * 100, den: c.base.refBrutCents }, 2)} %` : "n.d."}</td>
                      <td className="num">{cost(c) === null ? "n.d." : formatEuros(cost(c)!)}</td>
                      {canEdit && (
                        <>
                          <td><input className="input" name={`salary_${i}`} inputMode="decimal" defaultValue={fix ? decText(fix.salaryCents) : ""} aria-label={`Salaire corrigé de ${c.label}`} /></td>
                          <td><input className="input" name={`charges_${i}`} inputMode="decimal" defaultValue={fix ? decText(fix.chargesBps) : ""} aria-label={`Taux de charges corrigé de ${c.label}`} /></td>
                        </>
                      )}
                      <td className="wrap">{fix ? `corrigée : ${detailOf(fix, base, hypotheses)}` : c.baseNd ? <span className="nd">n.d. — {c.baseNd}</span> : c.baseNote ? `figée — ${c.baseNote}` : "figée"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        return canEdit ? (
          <ActionForm action={saveBasesAction.bind(null, slug, scenario.id)} submit="Enregistrer les bases corrigées" testid="bases-grid">
            <input type="hidden" name="n" value={rows.length} />
            {table}
            <p className="tile-foot">Corrige la base d'un contrat : salaire mensuel de base et taux de charges vont ensemble (0 € possible pour un contrat non payé). Les deux champs vides : pas de correction (une correction existante est retirée).</p>
          </ActionForm>
        ) : table;
      })()}
      {(base.etpNote || base.contracts.some((c) => c.serviceNd)) && (
        <p className="tile-foot" data-testid="hyp-base-notes">
          {base.etpNote ? `ETP : ${base.etpNote}. ` : ""}
          {base.contracts.filter((c) => c.serviceNd).map((c) => `${c.label} : ${c.serviceNd}`).join(" ; ")}
        </p>
      )}
    </section>
  );
}
