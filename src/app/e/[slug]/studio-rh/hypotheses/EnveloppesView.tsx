import { monthRange } from "@/lib/connectors/months";
import { formatMonth } from "@/lib/dates";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { countByYear, gridYears } from "@/lib/viz/hyp-saisie";
import { gridCaption } from "@/lib/viz/hyp-saisie-fmt";
import { ActionForm } from "./ActionForm";
import { addHypothesisAction, saveEnvelopesAction } from "./actions";
import { DirtyIndicator, GridTools, RowFill } from "./GridTools";
import { AmountFields, CardTitle, decText, Field, FieldGroup, Rules, Text } from "./shared";

type Env = Extract<Hypothesis, { kind: "enveloppe" }>;
const BLANK_ROWS = 3;

// Enveloppes budgétaires saisies par mois : par centre de coûts (axe « service ») ou par rubrique libre (« rubrique »).
// Chaque ligne est une hypothèse visible dans la projection (une ligne par mois renseigné) ; un mois vide n'a pas d'enveloppe.
export function EnveloppesView({ slug, scenario, base, hypotheses, axis, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; axis: Env["axis"]; canEdit: boolean }) {
  const months = monthRange(scenario.firstMonth, scenario.lastMonth);
  const rows: (Env | null)[] = [...hypotheses.filter((h): h is Env => h.kind === "enveloppe" && h.axis === axis), ...(canEdit ? Array.from({ length: BLANK_ROWS }, () => null) : [])];
  const what = axis === "service" ? "Centre de coûts" : "Rubrique";
  const targets = [...new Set(axis === "service"
    ? [...base.contracts.map((c) => c.service), ...hypotheses.map((h) => (h.kind === "embauche" ? h.service : h.kind === "enveloppe" && h.axis === "service" ? h.target : null))].filter((s): s is string => s !== null)
    : hypotheses.flatMap((h) => (h.kind === "enveloppe" && h.axis === "rubrique" ? [h.target] : [])))].sort();
  const add = (kind: Hypothesis["kind"]) => addHypothesisAction.bind(null, slug, scenario.id, kind);
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hypotheses.map((h) => (h.kind === "embauche" ? h.service : null))].filter((s): s is string => s !== null))].sort();
  const gy = gridYears(months, countByYear(rows.flatMap((e) => (e ? Object.keys(e.monthly) : []))));
  const filename = `enveloppes-${axis}-${scenario.firstMonth}.csv`;
  const grid = (
    <div className="table-wrap scroll" {...(canEdit ? {} : { role: "region", "aria-label": `Enveloppes par ${axis === "service" ? "service" : "rubrique"}`, tabIndex: 0 })}>
      <table className={`data-table month-grid sticky sticky-first hs-env${canEdit ? " hs-edit" : ""}`} data-testid={`env-${axis}-table`}>
        <thead>
          <tr>
            <th>{what}</th><th>Saisie</th><th>Taux de charges (%)</th><th>Non récurrent</th>
            {months.map((m) => <th key={m} className="num" data-yi={gy.index(m)} data-csv={m}>{gy.label(m)}</th>)}
            {canEdit && <><th data-no-csv><span className="sr-only">Report de la ligne</span></th><th>Supprimer</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e?.id ?? `new-${i}`} data-env={e?.target ?? ""}>
              {canEdit ? (
                <>
                  <td><input type="hidden" name={`id_${i}`} value={e?.id ?? ""} /><input className="input wide" name={`target_${i}`} list={`env-${axis}-targets`} defaultValue={e?.target ?? ""} maxLength={200} placeholder={e ? undefined : axis === "service" ? "Nouveau centre de coûts" : "Nouvelle rubrique"} aria-label={`${what}, ligne ${i + 1}`} /></td>
                  <td>
                    <select className="select" name={`mode_${i}`} defaultValue={e ? (e.chargesBps === null ? "charge" : "brut") : "charge"} aria-label={`Mode de saisie, ligne ${i + 1}`}>
                      <option value="charge">Coût chargé</option>
                      <option value="brut">Brut + charges</option>
                    </select>
                  </td>
                  <td><input className="input" name={`taux_${i}`} inputMode="decimal" defaultValue={e?.chargesBps != null ? decText(e.chargesBps) : ""} aria-label={`Taux de charges, ligne ${i + 1}`} /></td>
                  <td><input type="checkbox" name={`nr_${i}`} value="oui" defaultChecked={e?.nonRecurring === true} aria-label={`Non récurrent, ligne ${i + 1}`} /></td>
                  {months.map((m) => (
                    <td key={m} data-yi={gy.index(m)}><input className="input" name={`m_${i}_${m}`} data-row={`r${i}`} data-col={m} data-yi={gy.index(m)} data-cell inputMode="decimal" defaultValue={decText(e?.monthly[m])} aria-label={`${e?.target || what} ${i + 1}, ${gy.label(m)}`} /></td>
                  ))}
                  <td data-no-csv><RowFill row={`r${i}`} label={e?.target || `ligne ${i + 1}`} /></td>
                  <td>{e ? <input type="checkbox" name={`del_${i}`} value="oui" aria-label={`Supprimer ${e.target}`} /> : null}</td>
                </>
              ) : (
                <>
                  <td>{e!.target}</td>
                  <td>{e!.chargesBps === null ? "Coût chargé" : "Brut + charges"}</td>
                  <td className="num">{e!.chargesBps === null ? "—" : `${decText(e!.chargesBps)} %`}</td>
                  <td>{e!.nonRecurring ? "oui" : "non"}</td>
                  {months.map((m) => <td key={m} className="num" data-yi={gy.index(m)}>{e!.monthly[m] === undefined ? "—" : decText(e!.monthly[m])}</td>)}
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4 + months.length} className="desc">Aucune enveloppe.</td></tr>}
        </tbody>
      </table>
    </div>
  );
  const frame = (
    <div className="hs-grid" data-grid-root data-ys={gy.multi ? "0" : undefined}>
      <GridTools filename={filename} years={gy.tabs} readOnly={!canEdit} />
      <p className="hs-unit">{gridCaption("Montants en € par mois (coût chargé, ou brut selon la saisie de la ligne)", months)}</p>
      {grid}
    </div>
  );
  const none = rows.every((r) => r === null);
  return (
    <>
      <section className="panel" data-testid={`env-${axis}`}>
        <CardTitle title={`Enveloppes par ${axis === "service" ? "service" : "rubrique"}`}>
          {axis === "service"
            ? "Une ligne par centre de coûts (existant ou nouveau) : le montant de chaque mois est ajouté à la projection et rattaché à ce centre de coûts."
            : "Une ligne par rubrique de votre choix (primes, heures supplémentaires, indemnités…) : le montant de chaque mois est ajouté à la projection sous le nom de la rubrique."}
          {" "}<a href="#def-enveloppe">Règle</a>
        </CardTitle>
        <Rules>
          <p>Un mois vide n'a pas d'enveloppe (jamais compté pour 0).</p>
          <p>En « Brut + charges », les charges sont le brut × le taux saisi ; en « Coût chargé », brut et charges de ce mois restent non ventilés.</p>
        </Rules>
        {canEdit && none && <p className="hs-empty" data-testid={`env-${axis}-empty`}>{axis === "service" ? "Aucune enveloppe saisie : renseignez une ligne ci-dessous (un centre de coûts et ses montants par mois)." : "Aucune enveloppe saisie : renseignez une ligne ci-dessous (une rubrique et ses montants par mois)."}</p>}
        {canEdit ? (
          <ActionForm action={saveEnvelopesAction.bind(null, slug, scenario.id, axis)} submit="Enregistrer les enveloppes" testid={`env-${axis}-form`} className="form hs-grid-form" footer={<DirtyIndicator />}>
            <input type="hidden" name="n" value={rows.length} />
            {frame}
            <datalist id={`env-${axis}-targets`}>{targets.map((t) => <option key={t} value={t} />)}</datalist>
          </ActionForm>
        ) : frame}
      </section>
      {canEdit && axis === "rubrique" && (
        <section className="panel" data-testid="env-ponctuels">
          <CardTitle title="Autres éléments">Un montant à un mois précis, hors grille.</CardTitle>
          <datalist id="hyp-services">{services.map((x) => <option key={x} value={x} />)}</datalist>
          <details>
            <summary>Élément ponctuel (prime, régularisation…)</summary>
            <ActionForm action={add("ponctuel")} submit="Ajouter l'élément" testid="hyp-form-ponctuel">
              <FieldGroup title="Élément" hint="Ajouté à la projection au mois choisi.">
                <Text id="pon-label" name="label" label="Libellé" maxLength={200} required />
                <Text id="pon-month" name="month" label="Mois" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required hint={`Entre ${formatMonth(scenario.firstMonth).toLowerCase()} et ${formatMonth(scenario.lastMonth).toLowerCase()}.`} />
                <Field id="pon-service" label="Centre de coûts (vide : toute l'entreprise)" hint="Existant ou nouveau.">
                  <input className="input" id="pon-service" name="service" list="hyp-services" maxLength={200} />
                </Field>
              </FieldGroup>
              <FieldGroup title="Montant"><AmountFields prefix="amount" idp="pon-amount" /></FieldGroup>
              <label className="check"><input type="checkbox" name="nonRecurring" value="oui" /><span>Non récurrent (retiré de l'atterrissage retraité)</span></label>
            </ActionForm>
          </details>
          <details>
            <summary>Non récurrent réalisé, déjà passé en comptabilité (rupture, solde de congés…)</summary>
            <p className="desc">Le journal PayFit ne distingue pas ces éléments (ils sont dans le brut). Saisissez-les ici avec leur montant chargé : ils servent uniquement à l'atterrissage retraité et ne changent pas la projection.</p>
            <ActionForm action={add("realise")} submit="Ajouter l'élément réalisé" testid="hyp-form-realise">
              <FieldGroup title="Élément réalisé">
                <Text id="rea-label" name="label" label="Libellé" maxLength={200} required />
                <Text id="rea-cat" name="category" label="Catégorie (libre)" maxLength={100} required hint="Ex. rupture, solde de congés." />
                <Text id="rea-month" name="month" label="Mois réalisé" type="month" max={base.refMonth} required hint={`Au plus ${formatMonth(base.refMonth).toLowerCase()} (mois de la base).`} />
                <Text id="rea-cost" name="cost" label="Montant chargé (€)" inputMode="decimal" required hint="Montant chargé, positif ou nul." />
              </FieldGroup>
            </ActionForm>
          </details>
        </section>
      )}
    </>
  );
}
