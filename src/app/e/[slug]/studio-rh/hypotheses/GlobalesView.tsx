import { MoneyText, MoneyUnitLabel } from "@/components/Money";
import { GlossaryLink } from "@/components/GlossaryLink";
import { formatEuros } from "@/lib/money";
import { monthRange } from "@/lib/connectors/months";
import type { ScenarioRow } from "@/lib/budget/store";
import { scopeKeyOf } from "@/lib/budget/grids";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { BUDGET_TERMS } from "@/lib/glossary/budget";
import { countByYear, gridYears } from "@/lib/viz/hyp-saisie";
import { frDates, gridCaption } from "@/lib/viz/hyp-saisie-fmt";
import { ActionForm } from "./ActionForm";
import { saveConstantsAction, saveRatesAction } from "./actions";
import { constantsOf, rateMap, rateScopes } from "./grids-data";
import { DirtyIndicator, GridTools, RowFill } from "./GridTools";
import { CardTitle, decText, detailOf, UNIT_LABEL } from "./shared";

type Cst = Extract<Hypothesis, { kind: "constante" }>;
const BLANK_ROWS = 3;

// Hypothèses globales : grille mensuelle des taux d'augmentation par périmètre (toute l'entreprise, chaque service) et
// constantes de référence. Aucune valeur n'est préchargée : une cellule vide n'a pas d'hypothèse.
export function GlobalesView({ slug, scenario, base, hypotheses, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; canEdit: boolean }) {
  const months = monthRange(scenario.firstMonth, scenario.lastMonth);
  // Périmètres (entreprise, services, statuts) et taux enregistrés : communs à l'écran et à l'export Excel.
  const { scopes, statutNote } = rateScopes(base, hypotheses);
  const rate = rateMap(hypotheses);
  const targeted = hypotheses.filter((h) => h.kind === "augmentation" && scopeKeyOf(h.scope) === null);
  const consts: (Cst | null)[] = [...constantsOf(hypotheses), ...(canEdit ? Array.from({ length: BLANK_ROWS }, () => null) : [])];
  // Année affichée : le scénario peut couvrir deux années ; les cellules de l'autre année restent dans le formulaire.
  const ratesYears = gridYears(months, countByYear([...rate.keys()].map((k) => k.slice(k.lastIndexOf("|") + 1))));
  const constYears = gridYears(months, countByYear(consts.flatMap((c) => (c ? Object.keys(c.values) : []))));
  const head = (gy: ReturnType<typeof gridYears>) => months.map((m) => <th key={m} className="num" data-yi={gy.index(m)} data-csv={m}>{gy.label(m)}</th>);

  const ratesTable = (
    <div className="table-wrap scroll" {...(canEdit ? {} : { role: "region", "aria-label": "Taux d'augmentation par mois", tabIndex: 0 })}>
      <table className={`data-table month-grid sticky sticky-first hs-rates${canEdit ? " hs-edit" : ""}`} data-testid="glob-rates-table">
        <thead><tr><th>Périmètre</th>{head(ratesYears)}{canEdit && <th data-no-csv><span className="sr-only">Report de la ligne</span></th>}</tr></thead>
        <tbody>
          {scopes.map((s, i) => (
            <tr key={s.key} data-scope={s.key}>
              <td title={s.label}>{s.short}{s.note ? <span className="hs-scope-note">{s.note}</span> : null}</td>
              {months.map((m) => {
                const v = rate.get(`${s.key}|${m}`);
                return canEdit ? (
                  <td key={m} data-yi={ratesYears.index(m)}><input className="input" name={`rate|${s.key}|${m}`} data-row={`s${i}`} data-col={m} data-yi={ratesYears.index(m)} data-cell inputMode="decimal" defaultValue={v === undefined ? "" : decText(v)} aria-label={`${s.label}, ${ratesYears.label(m)} (%)`} /></td>
                ) : <td key={m} className="num" data-yi={ratesYears.index(m)}>{v === undefined ? "—" : `${decText(v)} %`}</td>;
              })}
              {canEdit && <td data-no-csv><RowFill row={`s${i}`} label={s.label} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const constTable = (
    <div className="table-wrap scroll" {...(canEdit ? {} : { role: "region", "aria-label": "Constantes de référence", tabIndex: 0 })}>
      <table className={`data-table month-grid sticky sticky-first hs-consts${canEdit ? " hs-edit" : ""}`} data-testid="glob-consts-table">
        <thead><tr><th>Constante</th><th>Unité</th><th>Source</th>{head(constYears)}{canEdit && <><th data-no-csv><span className="sr-only">Report de la ligne</span></th><th>Supprimer</th></>}</tr></thead>
        <tbody>
          {consts.map((c, i) => (
            <tr key={c?.id ?? `new-${i}`} data-const={c?.label ?? ""}>
              {canEdit ? (
                <>
                  <td><input type="hidden" name={`id_${i}`} value={c?.id ?? ""} /><input className="input wide" name={`label_${i}`} defaultValue={c?.label ?? ""} maxLength={200} placeholder={c ? undefined : "Nouvelle constante"} aria-label={`Constante, ligne ${i + 1}`} /></td>
                  <td>
                    <select className="select" name={`unit_${i}`} defaultValue={c?.unit ?? "eur"} aria-label={`Unité, ligne ${i + 1}`}>
                      <option value="eur">Euros</option><option value="pct">Pourcentage</option><option value="nombre">Nombre</option>
                    </select>
                  </td>
                  <td><input className="input wide" name={`source_${i}`} defaultValue={c?.source ?? ""} maxLength={300} placeholder={c ? undefined : "Source obligatoire"} aria-label={`Source, ligne ${i + 1}`} /></td>
                  {months.map((m) => <td key={m} data-yi={constYears.index(m)}><input className="input" name={`m_${i}_${m}`} data-row={`c${i}`} data-col={m} data-yi={constYears.index(m)} data-cell inputMode="decimal" defaultValue={decText(c?.values[m])} aria-label={`${c?.label || "Constante"} ${i + 1}, ${constYears.label(m)}`} /></td>)}
                  <td data-no-csv><RowFill row={`c${i}`} label={c?.label || `ligne ${i + 1}`} /></td>
                  <td>{c ? <input type="checkbox" name={`del_${i}`} value="oui" aria-label={`Supprimer ${c.label}`} /> : null}</td>
                </>
              ) : (
                <>
                  <td>{c!.label}</td><td data-csv={UNIT_LABEL[c!.unit]}>{c!.unit === "eur" ? <>montant en <MoneyUnitLabel /></> : UNIT_LABEL[c!.unit]}</td><td>{c!.source}</td>
                  {months.map((m) => <td key={m} className="num" data-yi={constYears.index(m)} data-csv={c!.values[m] === undefined ? "—" : decText(c!.values[m])}>{c!.values[m] === undefined ? "—" : c!.unit === "eur" ? formatEuros(c!.values[m]) : decText(c!.values[m])}</td>)}
                </>
              )}
            </tr>
          ))}
          {consts.length === 0 && <tr><td colSpan={3 + months.length} className="desc">Aucune constante.</td></tr>}
        </tbody>
      </table>
    </div>
  );
  const xlsxHref = (grille: "taux" | "constantes") => `/e/${slug}/studio-rh/hypotheses/export?scenario=${encodeURIComponent(scenario.id)}&vue=globales&grille=${grille}&format=xlsx`;
  const frame = (gy: ReturnType<typeof gridYears>, filename: string, caption: string, table: React.ReactNode, grille: "taux" | "constantes") => (
    <div className="hs-grid" data-grid-root data-ys={gy.multi ? "0" : undefined}>
      <GridTools filename={filename} years={gy.tabs} readOnly={!canEdit} help={<GlossaryLink slug={slug} term={BUDGET_TERMS.grilles} />} xlsxHref={xlsxHref(grille)} />
      <p className="hs-unit">{caption}</p>
      {table}
    </div>
  );
  const ratesCaption = gridCaption("Taux en % du salaire", months);
  const constCaption = gridCaption("Valeurs mensuelles, sans effet sur le calcul", months);
  return (
    <MoneyText><>
      <section className="panel" data-testid="glob-rates">
        <CardTitle title="Taux d'augmentation par mois" help={<GlossaryLink slug={slug} term={BUDGET_TERMS.globales} />} />
        {canEdit ? (
          <ActionForm action={saveRatesAction.bind(null, slug, scenario.id)} submit="Enregistrer les taux" testid="glob-rates-form" className="form hs-grid-form" footer={<DirtyIndicator />}>
            {frame(ratesYears, `taux-augmentation-${scenario.firstMonth}.csv`, ratesCaption, ratesTable, "taux")}
          </ActionForm>
        ) : frame(ratesYears, `taux-augmentation-${scenario.firstMonth}.csv`, ratesCaption, ratesTable, "taux")}
        {statutNote && <p className="tile-foot" data-testid="glob-statut-note">{statutNote}</p>}
        {targeted.length > 0 && (
          <details>
            <summary>Augmentations ciblées sur un contrat ou une embauche ({targeted.length}) — hors grille</summary>
            <ul className="list">{targeted.map((h) => <li key={h.id} className="desc">{frDates(h.label)} — {detailOf(h, base, hypotheses)}</li>)}</ul>
          </details>
        )}
      </section>
      <section className="panel" data-testid="glob-consts">
        <CardTitle title="Constantes de référence" help={<GlossaryLink slug={slug} term={BUDGET_TERMS.constantes} />} />
        {canEdit && consts.every((c) => c === null) && <p className="hs-empty" data-testid="glob-consts-empty">Aucune constante saisie.</p>}
        {canEdit ? (
          <ActionForm action={saveConstantsAction.bind(null, slug, scenario.id)} submit="Enregistrer les constantes" testid="glob-consts-form" className="form hs-grid-form" footer={<DirtyIndicator />}>
            <input type="hidden" name="n" value={consts.length} />
            {frame(constYears, `constantes-${scenario.firstMonth}.csv`, constCaption, constTable, "constantes")}
          </ActionForm>
        ) : frame(constYears, `constantes-${scenario.firstMonth}.csv`, constCaption, constTable, "constantes")}
      </section>
    </></MoneyText>
  );
}
