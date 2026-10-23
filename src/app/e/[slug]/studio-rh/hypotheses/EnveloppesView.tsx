import { monthRange } from "@/lib/connectors/months";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { monthShort } from "../masse-salariale/components";
import { ActionForm } from "./ActionForm";
import { addHypothesisAction, saveEnvelopesAction } from "./actions";
import { GridTools, RowFill } from "./GridTools";
import { AmountFields, decText, Text } from "./shared";

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
  const grid = (
    <div className="table-wrap">
      <table className="data-table month-grid" data-testid={`env-${axis}-table`}>
        <thead>
          <tr>
            <th>{what}</th><th>Saisie</th><th>Taux de charges (%)</th><th>Non récurrent</th>
            {months.map((m) => <th key={m} className="num">{monthShort(m)}</th>)}
            {canEdit && <><th /><th>Supprimer</th></>}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e?.id ?? `new-${i}`} data-env={e?.target ?? ""}>
              {canEdit ? (
                <>
                  <td><input type="hidden" name={`id_${i}`} value={e?.id ?? ""} /><input className="input wide" name={`target_${i}`} list={`env-${axis}-targets`} defaultValue={e?.target ?? ""} maxLength={200} aria-label={`${what}, ligne ${i + 1}`} /></td>
                  <td>
                    <select className="select" name={`mode_${i}`} defaultValue={e ? (e.chargesBps === null ? "charge" : "brut") : "charge"} aria-label={`Mode de saisie, ligne ${i + 1}`}>
                      <option value="charge">Coût chargé</option>
                      <option value="brut">Brut + charges</option>
                    </select>
                  </td>
                  <td><input className="input" name={`taux_${i}`} inputMode="decimal" defaultValue={e?.chargesBps != null ? decText(e.chargesBps) : ""} aria-label={`Taux de charges, ligne ${i + 1}`} /></td>
                  <td><input type="checkbox" name={`nr_${i}`} value="oui" defaultChecked={e?.nonRecurring === true} aria-label={`Non récurrent, ligne ${i + 1}`} /></td>
                  {months.map((m) => (
                    <td key={m}><input className="input" name={`m_${i}_${m}`} data-row={`r${i}`} data-cell inputMode="decimal" defaultValue={decText(e?.monthly[m])} aria-label={`${e?.target || what} ${i + 1}, ${monthShort(m)}`} /></td>
                  ))}
                  <td><RowFill row={`r${i}`} /></td>
                  <td>{e ? <input type="checkbox" name={`del_${i}`} value="oui" aria-label={`Supprimer ${e.target}`} /> : null}</td>
                </>
              ) : (
                <>
                  <td>{e!.target}</td>
                  <td>{e!.chargesBps === null ? "Coût chargé" : "Brut + charges"}</td>
                  <td className="num">{e!.chargesBps === null ? "—" : `${decText(e!.chargesBps)} %`}</td>
                  <td>{e!.nonRecurring ? "oui" : "non"}</td>
                  {months.map((m) => <td key={m} className="num">{e!.monthly[m] === undefined ? "—" : decText(e!.monthly[m])}</td>)}
                </>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4 + months.length} className="desc">Aucune enveloppe.</td></tr>}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <section className="panel" data-testid={`env-${axis}`}>
        <h2>Enveloppes par {axis === "service" ? "service" : "rubrique"} <span className="desc">— montants saisis par mois sur l'horizon du scénario · <a href="#def-enveloppe">règle</a></span></h2>
        <p className="desc">
          {axis === "service"
            ? "Une ligne par centre de coûts (existant ou nouveau) : le montant de chaque mois est ajouté à la projection et rattaché à ce service."
            : "Une ligne par rubrique de votre choix (primes, heures supplémentaires, indemnités…) : le montant de chaque mois est ajouté à la projection sous le nom de la rubrique."}
          {" "}Un mois vide n'a pas d'enveloppe (jamais compté pour 0). En « Brut + charges », les charges sont le brut × le taux saisi ; en « Coût chargé », brut et charges de ce mois restent non ventilés.
        </p>
        {canEdit ? (
          <ActionForm action={saveEnvelopesAction.bind(null, slug, scenario.id, axis)} submit="Enregistrer les enveloppes" testid={`env-${axis}-form`}>
            <input type="hidden" name="n" value={rows.length} />
            <GridTools filename={`enveloppes-${axis}-${scenario.firstMonth}.csv`} />
            {grid}
            <datalist id={`env-${axis}-targets`}>{targets.map((t) => <option key={t} value={t} />)}</datalist>
          </ActionForm>
        ) : grid}
      </section>
      {canEdit && axis === "rubrique" && (
        <section className="panel" data-testid="env-ponctuels">
          <h2>Autres éléments <span className="desc">— un montant à un mois précis, hors grille</span></h2>
          <datalist id="hyp-services">{services.map((x) => <option key={x} value={x} />)}</datalist>
          <details>
            <summary>Élément ponctuel (prime, régularisation…)</summary>
            <ActionForm action={add("ponctuel")} submit="Ajouter l'élément" testid="hyp-form-ponctuel">
              <div className="filters">
                <Text id="pon-label" name="label" label="Libellé" maxLength={200} required />
                <Text id="pon-month" name="month" label="Mois" type="month" min={scenario.firstMonth} max={scenario.lastMonth} required />
                <div className="field-row">
                  <label htmlFor="pon-service">Service (vide : toute l'entreprise)</label>
                  <input className="input" id="pon-service" name="service" list="hyp-services" maxLength={200} />
                </div>
              </div>
              <div className="filters"><AmountFields prefix="amount" idp="pon-amount" /></div>
              <label className="check"><input type="checkbox" name="nonRecurring" value="oui" /><span>Non récurrent (retiré de l'atterrissage retraité)</span></label>
            </ActionForm>
          </details>
          <details>
            <summary>Élément non récurrent déjà passé en comptabilité (rupture, solde de congés…)</summary>
            <p className="desc">Le journal PayFit ne distingue pas ces éléments (ils sont dans le brut). Saisis-les ici avec leur montant chargé : ils servent uniquement à l'atterrissage retraité et ne changent pas la projection.</p>
            <ActionForm action={add("realise")} submit="Ajouter l'élément réalisé" testid="hyp-form-realise">
              <div className="filters">
                <Text id="rea-label" name="label" label="Libellé" maxLength={200} required />
                <Text id="rea-cat" name="category" label="Catégorie (libre)" maxLength={100} required />
                <Text id="rea-month" name="month" label="Mois réalisé" type="month" max={base.refMonth} required />
                <Text id="rea-cost" name="cost" label="Montant chargé (€)" inputMode="decimal" required />
              </div>
            </ActionForm>
          </details>
        </section>
      )}
    </>
  );
}
