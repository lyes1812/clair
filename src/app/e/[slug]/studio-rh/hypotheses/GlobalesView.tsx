import { monthRange } from "@/lib/connectors/months";
import type { ScenarioRow } from "@/lib/budget/store";
import { scopeKeyOf } from "@/lib/budget/grids";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { countByYear, gridYears } from "@/lib/viz/hyp-saisie";
import { ActionForm } from "./ActionForm";
import { saveConstantsAction, saveRatesAction } from "./actions";
import { DirtyIndicator, GridTools, RowFill } from "./GridTools";
import { decText, detailOf, UNIT_LABEL } from "./shared";

type Cst = Extract<Hypothesis, { kind: "constante" }>;
const BLANK_ROWS = 3;

// Hypothèses globales : grille mensuelle des taux d'augmentation par périmètre (toute l'entreprise, chaque service) et
// constantes de référence. Aucune valeur n'est préchargée : une cellule vide n'a pas d'hypothèse.
export function GlobalesView({ slug, scenario, base, hypotheses, canEdit }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; hypotheses: Hypothesis[]; canEdit: boolean }) {
  const months = monthRange(scenario.firstMonth, scenario.lastMonth);
  const services = [...new Set([...base.contracts.map((c) => c.service), ...hypotheses.map((h) => (h.kind === "embauche" ? h.service : h.kind === "augmentation" && h.scope.kind === "service" ? h.scope.service : null))].filter((s): s is string => s !== null))].sort();
  // Statut « cadre dirigeant » de PayFit : lu dans le référentiel Collaborateurs et conservé dans la base figée du scénario.
  const dirigeants = base.contracts.filter((c) => c.executive === true).length;
  const autres = base.contracts.filter((c) => c.executive === false).length;
  const unknown = base.contracts.length - dirigeants - autres;
  const oldBase = base.contracts.every((c) => c.executive === undefined);
  const hasStatutHyp = hypotheses.some((h) => h.kind === "augmentation" && h.scope.kind === "statut");
  const showStatut = dirigeants + autres > 0 || hasStatutHyp;
  const statutNote = oldBase
    ? "Statut cadre dirigeant absent de la base figée de ce scénario (créé avant sa conservation) : créez un nouveau scénario pour l'utiliser."
    : dirigeants + autres === 0
      ? "Statut cadre dirigeant non renseigné dans les données lues (PayFit : champ estCadreDirigeant vide pour tous les contrats) : aucune ligne par statut."
      : unknown > 0
        ? `${unknown} contrat(s) sans statut renseigné ne reçoivent aucune augmentation par statut (seulement celles de leur service, de toute l'entreprise ou saisies sur eux).`
        : null;
  const scopes = [
    { key: "global", label: "Toute l'entreprise (hors embauches et entrées après la base)" },
    ...services.map((s) => ({ key: `service:${s}`, label: `Service ${s}` })),
    ...(showStatut ? [{ key: "statut:dirigeant", label: `Cadres dirigeants (${dirigeants} contrat${dirigeants > 1 ? "s" : ""})` }, { key: "statut:autres", label: `Hors cadres dirigeants (${autres} contrat${autres > 1 ? "s" : ""})` }] : []),
  ];
  const rate = new Map<string, number>();
  for (const h of hypotheses) {
    if (h.kind !== "augmentation") continue;
    const k = scopeKeyOf(h.scope);
    if (k) rate.set(`${k}|${h.from}`, h.rateBps);
  }
  const targeted = hypotheses.filter((h) => h.kind === "augmentation" && scopeKeyOf(h.scope) === null);
  const consts: (Cst | null)[] = [...hypotheses.filter((h): h is Cst => h.kind === "constante"), ...(canEdit ? Array.from({ length: BLANK_ROWS }, () => null) : [])];
  // Année affichée : le scénario peut couvrir deux années ; les cellules de l'autre année restent dans le formulaire.
  const ratesYears = gridYears(months, countByYear([...rate.keys()].map((k) => k.slice(k.lastIndexOf("|") + 1))));
  const constYears = gridYears(months, countByYear(consts.flatMap((c) => (c ? Object.keys(c.values) : []))));
  const head = (gy: ReturnType<typeof gridYears>) => months.map((m) => <th key={m} className="num" data-yi={gy.index(m)} data-csv={m}>{gy.label(m)}</th>);

  const ratesTable = (
    <div className="table-wrap scroll" {...(canEdit ? {} : { role: "region", "aria-label": "Taux d'augmentation par mois", tabIndex: 0 })}>
      <table className="data-table month-grid sticky sticky-first hs-rates" data-testid="glob-rates-table">
        <thead><tr><th>Périmètre</th>{head(ratesYears)}{canEdit && <th data-no-csv><span className="sr-only">Report de la ligne</span></th>}</tr></thead>
        <tbody>
          {scopes.map((s, i) => (
            <tr key={s.key} data-scope={s.key}>
              <td>{s.label}</td>
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
      <table className="data-table month-grid sticky sticky-first hs-consts" data-testid="glob-consts-table">
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
                  <td>{c!.label}</td><td>{UNIT_LABEL[c!.unit]}</td><td>{c!.source}</td>
                  {months.map((m) => <td key={m} className="num" data-yi={constYears.index(m)}>{c!.values[m] === undefined ? "—" : decText(c!.values[m])}</td>)}
                </>
              )}
            </tr>
          ))}
          {consts.length === 0 && <tr><td colSpan={3 + months.length} className="desc">Aucune constante.</td></tr>}
        </tbody>
      </table>
    </div>
  );
  const frame = (gy: ReturnType<typeof gridYears>, filename: string, table: React.ReactNode) => (
    <div className="hs-grid" data-grid-root data-ys={gy.multi ? "0" : undefined}>
      <GridTools filename={filename} years={gy.tabs} readOnly={!canEdit} />
      {table}
    </div>
  );
  return (
    <>
      <section className="panel" data-testid="glob-rates">
        <div className="hs-title">
          <h2>Taux d'augmentation par mois</h2>
          <p className="desc">Une ligne par périmètre, une colonne par mois du scénario · <a href="#def-globales">règle</a></p>
        </div>
        <p className="desc">
          Chaque cellule renseignée est une augmentation distincte, appliquée au 1er du mois en pourcentage du salaire déjà augmenté (les taux successifs se composent). Cellule vide ou 0 : aucune augmentation ce mois-là. Sur un même mois, la plus ciblée s'applique seule : l'augmentation d'un contrat prime sur celle d'un service ou d'un statut, qui prime sur celle de toute l'entreprise (celle d'un contrat se saisit dans Modifications de postes). Un service et un statut sont au même niveau : deux augmentations de ces niveaux le même mois pour un même salarié sont refusées avec leur raison.
        </p>
        {canEdit ? (
          <ActionForm action={saveRatesAction.bind(null, slug, scenario.id)} submit="Enregistrer les taux" testid="glob-rates-form" className="form hs-grid-form" footer={<DirtyIndicator />}>
            {frame(ratesYears, `taux-augmentation-${scenario.firstMonth}.csv`, ratesTable)}
          </ActionForm>
        ) : frame(ratesYears, `taux-augmentation-${scenario.firstMonth}.csv`, ratesTable)}
        {statutNote && <p className="tile-foot" data-testid="glob-statut-note">{statutNote}</p>}
        {targeted.length > 0 && (
          <details>
            <summary>Augmentations ciblées sur un contrat ou une embauche ({targeted.length}) — hors grille</summary>
            <ul className="list">{targeted.map((h) => <li key={h.id} className="desc">{h.label} — {detailOf(h, base, hypotheses)}</li>)}</ul>
          </details>
        )}
      </section>
      <section className="panel" data-testid="glob-consts">
        <div className="hs-title">
          <h2>Constantes de référence</h2>
          <p className="desc">Documentaires, sans effet sur le calcul.</p>
        </div>
        <p className="desc">
          Valeurs saisies par mois avec leur source (taux légaux, plafonds, horaire théorique, taux de change…). Aucune valeur n'est fournie par Clair : chaque constante doit porter sa source. Elles sont conservées avec le scénario et rappelées dans les contrôles, mais aucune règle de calcul ne les lit : la masse salariale ne change pas.
        </p>
        {canEdit ? (
          <ActionForm action={saveConstantsAction.bind(null, slug, scenario.id)} submit="Enregistrer les constantes" testid="glob-consts-form" className="form hs-grid-form" footer={<DirtyIndicator />}>
            <input type="hidden" name="n" value={consts.length} />
            {frame(constYears, `constantes-${scenario.firstMonth}.csv`, constTable)}
          </ActionForm>
        ) : frame(constYears, `constantes-${scenario.firstMonth}.csv`, constTable)}
        <p className="tile-foot">Multidevise : différé (euros seulement). Taux par statut cadre / non-cadre de la classification : PayFit ne fournit à Clair que l'indicateur « cadre dirigeant » (disponible ci-dessus) ; le statut cadre / non-cadre demande une autre source. Taux par société : une seule société par espace.</p>
      </section>
    </>
  );
}
