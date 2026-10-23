import { monthRange } from "@/lib/connectors/months";
import { getCategoryNatures, getContractCategories } from "@/lib/budget/categories";
import { project } from "@/lib/budget/engine";
import { AXES, MEASURES, monthlyGrid, UNAVAILABLE_AXES, type Axis, type Grid, type Measure, type RealSource } from "@/lib/budget/monthly";
import { getScenario, KIND_LABELS, listScenarios } from "@/lib/budget/store";
import { nd, val } from "@/lib/budget/versions";
import { formatEuros } from "@/lib/money";
import { loadPayrollContext } from "@/lib/payroll/context";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { selectableYears } from "@/lib/rh/kpi/period";
import type { KpiInput } from "@/lib/rh/kpi/types";
import { monthShort } from "../masse-salariale/components";

type Unit = "etp" | "nombre" | "eur";
const text = (v: number, unit: Unit) => (unit === "eur" ? formatEuros(v) : unit === "etp" ? fmtFixed({ num: v, den: 10000 }, 2) : String(v));
const FILLS = ["var(--ink)", "var(--blue)", "url(#em-h1)", "url(#em-h2)", "#9aa6bf", "#c7cedd", "#6b7280", "#dbe3ff"];
const FILL_NAMES = ["plein noir", "plein bleu", "hachuré noir", "hachuré bleu", "gris moyen", "gris clair", "gris foncé", "bleu pâle"];

function Chart({ grid, unit }: { grid: Extract<Grid, { kind: "value" }>; unit: Unit }) {
  const totals = grid.months.map((m) => {
    const t = grid.total(m);
    return t.kind === "value" ? t.v : null;
  });
  const max = Math.max(1, ...totals.map((t) => t ?? 0));
  const W = 52;
  const H = 150;
  return (
    <svg viewBox={`0 0 ${grid.months.length * W + 24} ${H + 30}`} role="img" aria-label="Mesure par mois, par groupe" style={{ width: "100%", maxWidth: grid.months.length * W + 24, height: "auto" }} data-testid="em-chart">
      <defs>
        <pattern id="em-h1" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--ink)" /></pattern>
        <pattern id="em-h2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--blue)" /></pattern>
      </defs>
      <line x1="8" x2={grid.months.length * W + 16} y1={H} y2={H} stroke="var(--line)" />
      {grid.months.map((m, i) => {
        const x = 14 + i * W;
        const t = totals[i];
        if (t === null) return <g key={m}><rect x={x} y={H - 18} width="30" height="18" fill="#e7eaf0"><title>{`${m} : n.d.`}</title></rect><text x={x + 15} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{monthShort(m)}</text></g>;
        let y = H;
        return (
          <g key={m}>
            {grid.groups.map((g, j) => {
              const c = grid.cell(g, m);
              const v = c.kind === "value" ? c.v : 0;
              const h = (Math.max(0, v) / max) * (H - 16);
              y -= h;
              return h > 0 ? <rect key={g} x={x} y={y} width="30" height={h} fill={FILLS[j % FILLS.length]} stroke="var(--line)" strokeWidth="0.5"><title>{`${g}, ${m} : ${text(v, unit)}`}</title></rect> : null;
            })}
            <text x={x + 15} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{monthShort(m)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Effectifs mensuels : une mesure, un axe, une version (réel PayFit ou scénario) et une année ; tout passe par l'adresse.
export async function EffectifsMensuels({ slug, workspaceId, kpi, search }: { slug: string; workspaceId: string; kpi: KpiInput | null; search: { mesure: string; axe: string; version: string; annee: string } }) {
  const pay = await loadPayrollContext(slug);
  const [{ natures }, overrides, rows] = await Promise.all([getCategoryNatures(workspaceId), getContractCategories(workspaceId), listScenarios(workspaceId)]);
  const measure: Measure = (MEASURES.some((m) => m.key === search.mesure) ? search.mesure : "etp") as Measure;
  const axis: Axis = (AXES.some((a) => a.key === search.axe) ? search.axe : "categorie") as Axis;
  const mdef = MEASURES.find((m) => m.key === measure)!;
  const versions = [{ value: "reel", label: "Réel PayFit" }, ...rows.map((r) => ({ value: `scenario:${r.scenario.id}`, label: `Scénario « ${r.scenario.name} » (${KIND_LABELS[r.scenario.kind]}, ${r.scenario.status === "fige" ? "figé" : "brouillon"})` }))];
  const version = versions.some((v) => v.value === search.version) ? search.version : "reel";
  const full = version.startsWith("scenario:") ? await getScenario(workspaceId, version.slice(9)) : null;
  const years = full
    ? [...new Set([full.base.refMonth.slice(0, 4), ...monthRange(full.scenario.firstMonth, full.scenario.lastMonth).map((m) => m.slice(0, 4))])].sort()
    : kpi ? selectableYears(kpi.data, kpi.openMonths ?? []).map((y) => String(y.year)) : [];
  const year = years.includes(search.annee) ? search.annee : (full ? full.scenario.firstMonth.slice(0, 4) : years.at(-1) ?? String(new Date().getFullYear()));
  const etpService = (m: string, f: { value: string | null }) => {
    const [e] = pay.etp([m], f);
    return e.etp4 === null ? nd(e.reason ?? "ETP par service n.d.") : val(e.etp4);
  };
  const real: RealSource = { kpi, journal: pay.input, natures, overrides, etpService };
  const grid = monthlyGrid({ measure, axis, year, real, scenario: full ? { base: full.base, hyps: full.hypotheses, proj: project(full.base, full.scenario.firstMonth, full.scenario.lastMonth, full.hypotheses, full.scenario.conventions) } : null });
  const unit = mdef.unit;
  const stock = measure === "etp" || measure === "inscrit";
  // Répartition : stocks au dernier mois connu, flux sur le cumul des mois connus.
  let repart: { basis: string; items: { group: string; v: number }[]; total: number } | null = null;
  if (grid.kind === "value") {
    const known = grid.months.filter((m) => grid.total(m).kind === "value");
    const used = stock ? known.slice(-1) : known;
    const items = grid.groups.map((g) => ({ group: g, v: used.reduce((s, m) => s + ((c) => (c.kind === "value" ? c.v : 0))(grid.cell(g, m)), 0) }));
    repart = { basis: stock ? `fin ${monthShort(used[0])} ${year}` : `cumul des ${used.length} mois connus (${known.length < 12 ? `${12 - known.length} mois n.d. non comptés` : "année complète"})`, items, total: items.reduce((s, x) => s + x.v, 0) };
  }
  const ndReasons = grid.kind === "value" ? [...new Set(grid.months.flatMap((m) => { const t = grid.total(m); return t.kind === "nd" ? [`${m} : ${t.reason}`] : []; }))] : [];
  const base = `/e/${slug}/studio-rh/kpi`;
  return (
    <>
      <section className="panel" data-testid="em">
        <h2>Effectifs mensuels <span className="desc">— une mesure, un axe, une version · <a href="#def-effectifs-mensuels">règles</a></span></h2>
        <form method="get" action={base} className="filters" data-testid="em-form">
          <input type="hidden" name="vue" value="effectifs" />
          <div className="field-row">
            <label htmlFor="mesure">Rubrique</label>
            <select className="select" id="mesure" name="mesure" defaultValue={measure}>{MEASURES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          </div>
          <div className="field-row">
            <label htmlFor="axe">Ventilation</label>
            <select className="select" id="axe" name="axe" defaultValue={axis}>
              {AXES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              {UNAVAILABLE_AXES.map((a) => <option key={a.label} value={`nd-${a.label}`} disabled>{a.label} — indisponible</option>)}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="version">Version</label>
            <select className="select" id="version" name="version" defaultValue={version}>{versions.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select>
          </div>
          <div className="field-row">
            <label htmlFor="annee">Année</label>
            <select className="select" id="annee" name="annee" defaultValue={year}>{(years.length ? years : [year]).map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </div>
          <button className="btn" type="submit">Afficher</button>
        </form>
        <p className="desc" data-testid="em-context">{mdef.label} ({mdef.kind}) · par {AXES.find((a) => a.key === axis)!.label.split(" (")[0].toLowerCase()} · {versions.find((v) => v.value === version)!.label} · {year}{full ? " — mois réalisés lus dans le réel PayFit courant, mois projetés dans le scénario" : ""}</p>
        {grid.kind === "nd" ? (
          <p className="nd" data-testid="em-nd">n.d. — {grid.reason}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table" data-testid="em-table">
                <thead>
                  <tr>
                    <th>Groupe</th>
                    {grid.months.map((m) => <th key={m} className="num">{monthShort(m)}{grid.layers.get(m) === "projete" ? <span className="tile-foot"> proj.</span> : null}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {grid.groups.map((g) => (
                    <tr key={g} data-group={g}>
                      <td>{g}</td>
                      {grid.months.map((m) => {
                        const c = grid.cell(g, m);
                        return <td key={m} className="num" data-month={m}>{c.kind === "value" ? text(c.v, unit) : <abbr className="nd" title={c.kind === "nd" ? c.reason : undefined}>n.d.</abbr>}</td>;
                      })}
                    </tr>
                  ))}
                  <tr data-group="total">
                    <th>Total</th>
                    {grid.months.map((m) => {
                      const c = grid.total(m);
                      return <td key={m} className="num" data-month={m} data-col="total">{c.kind === "value" ? text(c.v, unit) : <abbr className="nd" title={c.kind === "nd" ? c.reason : undefined}>n.d.</abbr>}</td>;
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            {ndReasons.length > 0 && <details data-testid="em-nd-list"><summary>Mois n.d. ({ndReasons.length})</summary><ul className="list">{ndReasons.map((r) => <li key={r} className="desc">{r}</li>)}</ul></details>}
          </>
        )}
      </section>
      {grid.kind === "value" && repart && (
        <section className="panel" data-testid="em-graph">
          <h2>{mdef.label} par mois et par groupe</h2>
          <Chart grid={grid} unit={unit} />
          <p className="tile-foot" data-testid="em-legend">{grid.groups.map((g, j) => `${FILL_NAMES[j % FILL_NAMES.length]} : ${g}`).join(" · ")} · barre grise : mois n.d.</p>
          <h3>Répartition — {repart.basis}</h3>
          <div className="table-wrap">
            <table className="data-table" data-testid="em-repart">
              <thead><tr><th>Groupe</th><th className="num">Valeur</th><th className="num">Part</th><th /></tr></thead>
              <tbody>
                {repart.items.map((it) => (
                  <tr key={it.group} data-group={it.group}>
                    <td>{it.group}</td>
                    <td className="num" data-col="valeur">{text(it.v, unit)}</td>
                    <td className="num" data-col="part">{repart!.total > 0 ? fmtPercent({ num: it.v, den: repart!.total }) : "n.d."}</td>
                    <td style={{ width: "30%" }}><div style={{ height: 8, background: "var(--ink)", width: `${repart!.total > 0 ? Math.round((it.v / repart!.total) * 100) : 0}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <details className="panel" data-testid="em-definitions" id="def-effectifs-mensuels">
        <summary>Définitions et règles de calcul</summary>
        <dl className="defs">
          <div><dt>Mesures</dt><dd>ETP : somme des quotités des contrats comptés présents le dernier jour du mois (ETP contractuel, voir les définitions des KPI). Inscrit fin de mois : effectif compté ce jour-là. Entrées et sorties : mouvements comptés du mois (règles du turnover : natures, contrats continus, sorties exclues). Masse salariale chargée : brut + cotisations du mois. Les stocks (ETP, inscrit) ne s'additionnent pas dans le temps ; les flux (entrées, sorties, masse) oui.</dd></div>
          <div><dt>Ventilation</dt><dd>Catégorie : CDI, CDD, apprenti, stagiaire (nature du contrat corrigée contrat par contrat dans Paramètres). Contrat : nature DSN. Établissement : SIRET du contrat. Statut : cadre ou non cadre déclaré. Service : code analytique des lignes de paie (masse et ETP seulement ; effectif et mouvements par service ne sont pas historisés). Direction, métier, motif d'embauche, sexe : absents des données lues, listés comme indisponibles. Un groupe sans salarié un mois connu vaut 0 ; un mois n.d. reste n.d. avec sa raison. La somme des groupes est le total du mois.</dd></div>
          <div><dt>Version et mois projetés</dt><dd>Réel PayFit : mois clos lus. Scénario : les mois jusqu'au mois de référence du scénario sont lus dans le réel PayFit courant (et non dans le réel figé du scénario) ; les mois suivants sont ceux de sa projection. Pour les mois projetés, seuls les axes catégorie, contrat (nature de la base ou « embauche prévisionnelle ») et service sont disponibles ; établissement et statut ne sont pas conservés dans la base du scénario. Les quotités PayFit sont celles de la date de lecture (non historisées).</dd></div>
          <div><dt>Répartition</dt><dd>Stocks : part de chaque groupe au dernier mois connu de l'année. Flux : part de chaque groupe dans le cumul des mois connus ; les mois n.d. ne sont pas comptés et le sont dit. Un camembert n'est pas utilisé au-delà de trois parts : barres horizontales.</dd></div>
        </dl>
      </details>
    </>
  );
}
