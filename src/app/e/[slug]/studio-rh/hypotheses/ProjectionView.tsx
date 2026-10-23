import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import type { Landing } from "@/lib/budget/engine";
import type { ScenarioRow } from "@/lib/budget/store";
import { CATEGORY_IDS, CATEGORY_LABELS, type BaseSnapshot, type CategoryId, type Contribution, type ProjectedMonth, type Projection } from "@/lib/budget/types";
import { fmtEtp4, fmtFixed } from "@/lib/rh/kpi/format";
import { monthShort } from "../masse-salariale/components";

const KIND: Record<Contribution["kind"], string> = {
  base: "Base", augmentation: "Augmentation", quotite: "Changement de quotité", enveloppe: "Enveloppe", absence: "Congé non payé", depart: "Départ", "fin-contrat": "Fin de contrat connue", entree: "Entrée après la base", embauche: "Embauche", ponctuel: "Élément ponctuel", sortie: "Coûts de sortie",
};
const eur = (v: number | null) => (v === null ? "n.d." : formatEuros(v));
type Row = { month: string; layer: "reel" | "parent" | "projete"; source?: string; brut: number | null; charges: number | null; cost: number | null; headcount: number | null; etp4: number | null; nd: string | null; etpNd: string | null };

// Mois de l'année du premier mois projeté (réel figé) puis mois projetés jusqu'à la fin de l'horizon.
function rowsOf(base: BaseSnapshot, proj: Projection, scenario: ScenarioRow): Row[] {
  const year = scenario.firstMonth.slice(0, 4);
  const actual: Row[] = base.actuals
    .filter((a) => a.month.startsWith(year) && a.month < scenario.firstMonth)
    .map((a) => (a.kind === "nd" ? { month: a.month, layer: "reel", brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: a.reason, etpNd: null } : { month: a.month, layer: "reel", brut: a.brut, charges: a.cotisations, cost: a.masse, headcount: a.headcount, etp4: a.etp4, nd: null, etpNd: a.etpNd }));
  // Base dérivée : mois projetés par le scénario parent dans l'année (coût et effectif seulement).
  const prior: Row[] = (base.prior ?? [])
    .filter((p) => p.month.startsWith(year) && p.month < scenario.firstMonth && !base.actuals.some((a) => a.month === p.month))
    .map((p) => (p.kind === "nd" ? { month: p.month, layer: "parent", source: p.source, brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: p.reason, etpNd: null } : { month: p.month, layer: "parent", source: p.source, brut: p.brut ?? null, charges: p.charges ?? null, cost: p.cost, headcount: p.headcount, etp4: p.etp4, nd: p.brut === undefined ? "brut et charges non conservés par la base dérivée (créée avant leur reprise)" : null, etpNd: p.etpNd }));
  const projected: Row[] = proj.kind === "error" ? [] : proj.months.map((p: ProjectedMonth) => (p.kind === "nd" ? { month: p.month, layer: "projete", brut: null, charges: null, cost: null, headcount: null, etp4: null, nd: p.reasons.join(" ; "), etpNd: null } : { month: p.month, layer: "projete", brut: p.brut, charges: p.charges, cost: p.cost, headcount: p.headcount, etp4: p.etp4, nd: null, etpNd: p.etpNd }));
  return [...actual, ...prior, ...projected];
}

// Mois projetés par les scénarios parents, groupés par scénario d'origine (une base dérivée de base dérivée a deux sources).
function priorBySource(base: BaseSnapshot, months: string[]) {
  const out: { source: string; months: string[]; cost: number }[] = [];
  for (const m of months) {
    const p = base.prior?.find((x) => x.month === m);
    if (!p || p.kind !== "value") continue;
    const g = out.find((x) => x.source === p.source) ?? (out.push({ source: p.source, months: [], cost: 0 }), out.at(-1)!);
    g.months.push(m);
    g.cost += p.cost;
  }
  return out;
}

function Chart({ rows }: { rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cost ?? 0));
  const W = 52;
  const H = 170;
  const width = rows.length * W + 30;
  const y = (v: number) => H - Math.max(0, (v / max) * (H - 20));
  return (
    <svg viewBox={`0 0 ${width} ${H + 34}`} role="img" aria-label="Coût employeur par mois, réel puis projeté" style={{ width: "100%", maxWidth: width, height: "auto" }} data-testid="proj-chart">
      <defs>
        <pattern id="proj-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--blue)" /></pattern>
        <pattern id="proj-hatch-parent" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#9aa6bf" /></pattern>
        <pattern id="proj-nd" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#e7eaf0" /></pattern>
      </defs>
      <line x1="10" x2={width - 10} y1={H} y2={H} stroke="var(--line)" />
      {rows.map((r, i) => {
        const x = 20 + i * W;
        return (
          <g key={r.month}>
            {r.cost === null ? (
              <rect x={x} y={H - 24} width="28" height="24" fill="url(#proj-nd)"><title>{`${r.month} : n.d. — ${r.nd}`}</title></rect>
            ) : (
              <>
                <rect x={x} y={y(r.cost)} width="28" height={H - y(r.cost)} fill={r.layer === "reel" ? "var(--ink)" : r.layer === "parent" ? "url(#proj-hatch-parent)" : "url(#proj-hatch)"} stroke={r.layer === "reel" ? "none" : r.layer === "parent" ? "#9aa6bf" : "var(--blue)"}>
                  <title>{`${r.month} (${r.layer === "reel" ? "réel" : r.layer === "parent" ? "projeté par le scénario parent" : "projeté"}) : ${formatEuros(r.cost)}`}</title>
                </rect>
                <text x={x + 14} y={y(r.cost) - 5} textAnchor="middle" fontSize="10" fill="var(--ink)">{fmtFixed({ num: r.cost, den: 100000 }, 1)}</text>
              </>
            )}
            <text x={x + 14} y={H + 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{monthShort(r.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function ProjectionView({ slug, scenario, base, proj, landing, month }: { slug: string; scenario: ScenarioRow; base: BaseSnapshot; proj: Projection; landing: Landing; month: string }) {
  const href = `/e/${slug}/studio-rh/hypotheses?scenario=${scenario.id}`;
  if (proj.kind === "error") {
    return (
      <section className="panel" data-testid="proj-error">
        <h2>Projection refusée</h2>
        <ul className="list">{proj.errors.map((e) => <li key={e} className="nd">{e}</li>)}</ul>
      </section>
    );
  }
  const rows = rowsOf(base, proj, scenario);
  const pm = proj.months;
  const ndMonths = pm.filter((p) => p.kind === "nd");
  const horizon = ndMonths.length ? null : pm.reduce((s, p) => s + (p.kind === "value" ? p.cost : 0), 0);
  const last = pm.at(-1)!;
  const detail = pm.find((p) => p.month === month) ?? null;
  return (
    <>
      {ndMonths.length > 0 && (
        <p className="notice" data-testid="proj-nd">
          Projection n.d. pour {ndMonths.length} mois : {[...new Set(ndMonths.flatMap((p) => (p.kind === "nd" ? p.reasons : [])))].join(" ; ")}. <a href={`${href}&vue=bases`}>Compléter dans Bases individuelles</a>.
        </p>
      )}
      <section className="panel">
        <h2>Vue d'ensemble</h2>
        <dl className="facts">
          <div data-testid="proj-tile-landing">
            <dt>Atterrissage {landing.year} (coût employeur)</dt>
            <dd className={landing.kind === "nd" ? "nd" : undefined}>{landing.kind === "nd" ? `n.d. — ${landing.reason}` : formatEuros(landing.total)}</dd>
            {landing.kind === "value" && (
              <span className="tile-foot" data-testid="proj-tile-landing-split">
                {[
                  landing.actualMonths.length ? `réel ${monthShort(landing.actualMonths[0])}–${monthShort(landing.actualMonths.at(-1)!)} ${formatEuros(landing.actual)}` : null,
                  ...priorBySource(base, landing.priorMonths).map((g) => `${g.source} ${monthShort(g.months[0])}–${monthShort(g.months.at(-1)!)} ${formatEuros(g.cost)}`),
                  landing.projectedMonths.length ? `projeté ${monthShort(landing.projectedMonths[0])}–${monthShort(landing.projectedMonths.at(-1)!)} ${formatEuros(landing.projected)}` : null,
                ].filter(Boolean).join(" + ")}
              </span>
            )}
            <span className="tile-foot"><a href="#def-atterrissage">Définition</a></span>
          </div>
          <div data-testid="proj-tile-horizon">
            <dt>Coût projeté {formatMonth(scenario.firstMonth).toLowerCase()} → {formatMonth(scenario.lastMonth).toLowerCase()}</dt>
            <dd className={horizon === null ? "nd" : undefined}>{horizon === null ? "n.d. — un mois projeté au moins est n.d." : formatEuros(horizon)}</dd>
            <span className="tile-foot">{pm.length} mois · <a href="#def-contribution">Définition</a></span>
          </div>
          <div data-testid="proj-tile-headcount">
            <dt>Effectif et ETP fin {formatMonth(last.month).toLowerCase()}</dt>
            <dd className={last.kind === "nd" ? "nd" : undefined}>{last.kind === "nd" ? "n.d." : `${last.headcount} · ${last.etp4 === null ? "ETP n.d." : `${fmtEtp4(last.etp4)} ETP`}`}</dd>
            <span className="tile-foot">{last.kind === "value" && last.etpNd ? `ETP n.d. — ${last.etpNd} · ` : ""}{base.etpNote ? `${base.etpNote} · ` : ""}<a href="#def-effectif">Définition</a></span>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2>Mois par mois <span className="desc">— réel figé puis projection (hachurée) ; cliquez un mois projeté pour voir ses hypothèses</span></h2>
        <Chart rows={rows} />
        <div className="table-wrap">
          <table className="data-table" data-testid="proj-table">
            <thead><tr><th>Mois</th><th>Nature</th><th className="num">Brut</th><th className="num">Charges</th><th className="num">Coût employeur</th><th className="num">Effectif fin de mois</th><th className="num">ETP</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} data-month={r.month} data-layer={r.layer}>
                  <td>{r.layer === "projete" && r.cost !== null ? <a href={`${href}&mois=${r.month}#proj-detail`}>{formatMonth(r.month)}</a> : formatMonth(r.month)}</td>
                  <td>{r.layer === "reel" ? "Réel" : r.layer === "parent" ? (r.source ?? "Projeté (scénario parent)") : "Projeté"}</td>
                  <td className="num">{eur(r.brut)}</td>
                  <td className="num">{eur(r.charges)}</td>
                  <td className="num" data-col="cost" title={r.nd ?? undefined}>{r.cost === null ? "n.d." : formatEuros(r.cost)}</td>
                  <td className="num">{r.headcount ?? "n.d."}</td>
                  <td className="num">{r.etp4 === null ? "n.d." : fmtEtp4(r.etp4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.some((r) => r.nd || r.etpNd) && (
          <p className="tile-foot nd" data-testid="proj-nd-reasons">n.d. : {[...new Set(rows.flatMap((r) => [r.nd && `${r.month} : ${r.nd}`, r.etpNd && `${r.month} : ${r.etpNd}`]).filter(Boolean))].join(" ; ")}</p>
        )}
        {rows.some((r) => r.layer !== "reel" && r.cost !== null && (r.brut === null || r.charges === null)) && (
          <p className="tile-foot">Brut ou charges n.d. sur un mois projeté : un élément saisi en coût chargé n'est pas ventilé entre brut et charges ; le coût employeur reste exact.</p>
        )}
      </section>
      <CategoriesTable proj={proj} base={base} />
      {detail && detail.kind === "value" && <Detail month={detail} />}
    </>
  );
}

// Effectif et ETP de fin de mois par catégorie (CDI, CDD, apprenti, stagiaire) ; « non classé » : nature sans catégorie.
function CategoriesTable({ proj, base }: { proj: Projection; base: BaseSnapshot }) {
  if (proj.kind === "error") return null;
  const months = proj.months.filter((m): m is Extract<ProjectedMonth, { kind: "value" }> => m.kind === "value" && m.byCategory !== undefined);
  if (!months.length) return null;
  const keys = [...CATEGORY_IDS, "nc"].filter((k) => months.some((m) => m.byCategory![k]));
  const ref = base.contracts.filter((c) => c.counted);
  return (
    <section className="panel" data-testid="proj-categories">
      <h2>Effectif et ETP par catégorie <span className="desc">— fin de mois, contrats comptés dans l'effectif</span></h2>
      <div className="table-wrap">
        <table className="data-table" data-testid="proj-categories-table">
          <thead>
            <tr><th>Mois</th>{keys.map((k) => <th key={k} className="num">{k === "nc" ? "Non classé" : CATEGORY_LABELS[k as CategoryId]}</th>)}<th className="num">Total</th></tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} data-month={m.month}>
                <td>{formatMonth(m.month)}</td>
                {keys.map((k) => {
                  const c = m.byCategory![k];
                  return <td key={k} className="num" data-col={k}>{c ? `${c.headcount} · ${c.etp4 === null ? "ETP n.d." : `${fmtEtp4(c.etp4)} ETP`}` : "—"}</td>;
                })}
                <td className="num" data-col="total">{m.headcount} · {m.etp4 === null ? "ETP n.d." : `${fmtEtp4(m.etp4)} ETP`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tile-foot">Catégorie proposée depuis la nature du contrat (Paramètres › Projection), corrigée par salarié dans l'onglet Salariés. {ref.some((c) => !c.category) ? `${ref.filter((c) => !c.category).length} contrat(s) sans catégorie (nature non reconnue).` : ""}</p>
    </section>
  );
}

// Détail d'un mois projeté : chaque contribution et l'hypothèse qui la porte ; la somme égale le total du mois.
function Detail({ month }: { month: Extract<ProjectedMonth, { kind: "value" }> }) {
  const byHyp = new Map<string, { label: string; kind: Contribution["kind"]; cost: number; n: number }>();
  for (const c of month.contributions) {
    // Une ligne par hypothèse et par nature d'effet (un départ : économie de paie d'un côté, coûts de sortie de l'autre).
    const k = `${c.hypothesisId ?? "-"}:${c.kind}:${c.hypothesisId || c.kind === "base" ? "" : c.label}`;
    const g = byHyp.get(k) ?? { label: c.label, kind: c.kind, cost: 0, n: 0 };
    g.cost += c.cost;
    g.n += 1;
    byHyp.set(k, g);
  }
  return (
    <section className="panel" id="proj-detail" data-testid="proj-detail">
      <h2>{formatMonth(month.month)} — de quoi est fait le coût projeté</h2>
      <div className="table-wrap">
        <table className="data-table" data-testid="proj-detail-hyps">
          <thead><tr><th>Hypothèse ou base</th><th>Type</th><th className="num">Lignes</th><th className="num">Coût employeur</th></tr></thead>
          <tbody>
            {[...byHyp].map(([k, g]) => (
              <tr key={k} data-hyp={g.label}><td>{g.label}</td><td>{KIND[g.kind]}</td><td className="num">{g.n}</td><td className="num" data-col="cost">{formatEuros(g.cost)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr data-testid="proj-detail-total"><td colSpan={3}>Total du mois</td><td className="num" data-col="cost">{formatEuros(month.cost)}</td></tr></tfoot>
        </table>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary>Détail par contrat ({month.contributions.length} lignes)</summary>
        <div className="table-wrap">
          <table className="data-table" data-testid="proj-detail-lines">
            <thead><tr><th>Contrat ou poste</th><th>Service</th><th>Hypothèse ou base</th><th>Type</th><th className="num">Brut</th><th className="num">Charges</th><th className="num">Coût</th></tr></thead>
            <tbody>
              {month.contributions.map((c, i) => (
                <tr key={i}><td>{c.who}</td><td>{c.service ?? "Non ventilé"}</td><td>{c.label}</td><td>{KIND[c.kind]}</td><td className="num">{eur(c.brut)}</td><td className="num">{eur(c.charges)}</td><td className="num">{formatEuros(c.cost)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="num">{eur(month.brut)}</td><td className="num">{eur(month.charges)}</td><td className="num">{formatEuros(month.cost)}</td></tr></tfoot>
          </table>
        </div>
      </details>
    </section>
  );
}
