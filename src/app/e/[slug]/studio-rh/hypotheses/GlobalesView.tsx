import { monthRange } from "@/lib/connectors/months";
import type { ScenarioRow } from "@/lib/budget/store";
import { scopeKeyOf } from "@/lib/budget/grids";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { monthShort } from "../masse-salariale/components";
import { ActionForm } from "./ActionForm";
import { saveConstantsAction, saveRatesAction } from "./actions";
import { GridTools, RowFill } from "./GridTools";
import { decText, detailOf, UNIT_LABEL } from "./shared";

type Cst = Extract<Hypothesis, { kind: "constante" }>;
const BLANK_ROWS = 3;

// Hypothèses globales : grille mensuelle des taux d'augmentation par périmètre (toute l'entreprise, chaque service) et
// constantes de référence. Aucune valeur n'est préchargée : une cellule vide n'a pas d'hypothèse.
export function GlobalesView({ slug, scenario, base, hypotheses, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; canEdit: boolean }) {
  const months = monthRange(scenario.firstMonth, scenario.lastMonth);
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hypotheses.map((h) => (h.kind === "embauche" ? h.service : h.kind === "augmentation" && h.scope.kind === "service" ? h.scope.service : null))].filter((s): s is string => s !== null))].sort();
  const scopes = [{ key: "global", label: "Toute l'entreprise (hors embauches et entrées après la base)" }, ...services.map((s) => ({ key: `service:${s}`, label: `Service ${s}` }))];
  const rate = new Map<string, number>();
  for (const h of hypotheses) {
    if (h.kind !== "augmentation") continue;
    const k = scopeKeyOf(h.scope);
    if (k) rate.set(`${k}|${h.from}`, h.rateBps);
  }
  const targeted = hypotheses.filter((h) => h.kind === "augmentation" && scopeKeyOf(h.scope) === null);
  const consts: (Cst | null)[] = [...hypotheses.filter((h): h is Cst => h.kind === "constante"), ...(canEdit ? Array.from({ length: BLANK_ROWS }, () => null) : [])];
  const ratesGrid = (
    <div className="table-wrap">
      <table className="data-table month-grid" data-testid="glob-rates-table">
        <thead><tr><th>Périmètre</th>{months.map((m) => <th key={m} className="num">{monthShort(m)}</th>)}{canEdit && <th />}</tr></thead>
        <tbody>
          {scopes.map((s, i) => (
            <tr key={s.key} data-scope={s.key}>
              <td>{s.label}</td>
              {months.map((m) => {
                const v = rate.get(`${s.key}|${m}`);
                return canEdit ? (
                  <td key={m}><input className="input" name={`rate|${s.key}|${m}`} data-row={`s${i}`} data-cell inputMode="decimal" defaultValue={v === undefined ? "" : decText(v)} aria-label={`${s.label}, ${monthShort(m)} (%)`} /></td>
                ) : <td key={m} className="num">{v === undefined ? "—" : `${decText(v)} %`}</td>;
              })}
              {canEdit && <td><RowFill row={`s${i}`} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const constGrid = (
    <div className="table-wrap">
      <table className="data-table month-grid" data-testid="glob-consts-table">
        <thead><tr><th>Constante</th><th>Unité</th><th>Source</th>{months.map((m) => <th key={m} className="num">{monthShort(m)}</th>)}{canEdit && <><th /><th>Supprimer</th></>}</tr></thead>
        <tbody>
          {consts.map((c, i) => (
            <tr key={c?.id ?? `new-${i}`} data-const={c?.label ?? ""}>
              {canEdit ? (
                <>
                  <td><input type="hidden" name={`id_${i}`} value={c?.id ?? ""} /><input className="input wide" name={`label_${i}`} defaultValue={c?.label ?? ""} maxLength={200} aria-label={`Constante, ligne ${i + 1}`} /></td>
                  <td>
                    <select className="select" name={`unit_${i}`} defaultValue={c?.unit ?? "eur"} aria-label={`Unité, ligne ${i + 1}`}>
                      <option value="eur">Euros</option><option value="pct">Pourcentage</option><option value="nombre">Nombre</option>
                    </select>
                  </td>
                  <td><input className="input wide" name={`source_${i}`} defaultValue={c?.source ?? ""} maxLength={300} aria-label={`Source, ligne ${i + 1}`} /></td>
                  {months.map((m) => <td key={m}><input className="input" name={`m_${i}_${m}`} data-row={`c${i}`} data-cell inputMode="decimal" defaultValue={decText(c?.values[m])} aria-label={`${c?.label || "Constante"} ${i + 1}, ${monthShort(m)}`} /></td>)}
                  <td><RowFill row={`c${i}`} /></td>
                  <td>{c ? <input type="checkbox" name={`del_${i}`} value="oui" aria-label={`Supprimer ${c.label}`} /> : null}</td>
                </>
              ) : (
                <>
                  <td>{c!.label}</td><td>{UNIT_LABEL[c!.unit]}</td><td>{c!.source}</td>
                  {months.map((m) => <td key={m} className="num">{c!.values[m] === undefined ? "—" : decText(c!.values[m])}</td>)}
                </>
              )}
            </tr>
          ))}
          {consts.length === 0 && <tr><td colSpan={3 + months.length} className="desc">Aucune constante.</td></tr>}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <section className="panel" data-testid="glob-rates">
        <h2>Taux d'augmentation par mois <span className="desc">— une ligne par périmètre · <a href="#def-globales">règle</a></span></h2>
        <p className="desc">
          Chaque cellule renseignée est une augmentation distincte, appliquée au 1er du mois en pourcentage du salaire déjà augmenté (les taux successifs se composent). Cellule vide ou 0 : aucune augmentation ce mois-là. Sur un même mois, la plus ciblée s'applique seule : l'augmentation d'un contrat prime sur celle d'un service, qui prime sur celle de toute l'entreprise (celle d'un contrat se saisit dans Modifications de postes).
        </p>
        {canEdit ? (
          <ActionForm action={saveRatesAction.bind(null, slug, scenario.id)} submit="Enregistrer les taux" testid="glob-rates-form">
            <GridTools filename={`taux-augmentation-${scenario.firstMonth}.csv`} />
            {ratesGrid}
          </ActionForm>
        ) : ratesGrid}
        {targeted.length > 0 && (
          <details>
            <summary>Augmentations ciblées sur un contrat ou une embauche ({targeted.length}) — hors grille</summary>
            <ul className="list">{targeted.map((h) => <li key={h.id} className="desc">{h.label} — {detailOf(h, base, hypotheses)}</li>)}</ul>
          </details>
        )}
      </section>
      <section className="panel" data-testid="glob-consts">
        <h2>Constantes de référence <span className="desc">— documentaires, sans effet sur le calcul</span></h2>
        <p className="desc">
          Valeurs saisies par mois avec leur source (taux légaux, plafonds, horaire théorique, taux de change…). Aucune valeur n'est fournie par Clair : chaque constante doit porter sa source. Elles sont conservées avec le scénario et rappelées dans les contrôles, mais aucune règle de calcul ne les lit : la masse salariale ne change pas.
        </p>
        {canEdit ? (
          <ActionForm action={saveConstantsAction.bind(null, slug, scenario.id)} submit="Enregistrer les constantes" testid="glob-consts-form">
            <input type="hidden" name="n" value={consts.length} />
            <GridTools filename={`constantes-${scenario.firstMonth}.csv`} />
            {constGrid}
          </ActionForm>
        ) : constGrid}
        <p className="tile-foot">Multidevise : différé (euros seulement). Taux par statut cadre / non-cadre et par société : à préciser (le statut n'est pas dans la base figée, une seule société par espace).</p>
      </section>
    </>
  );
}
