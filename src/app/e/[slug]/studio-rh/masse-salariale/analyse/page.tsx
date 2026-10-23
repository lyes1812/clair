import { formatEuros } from "@/lib/money";
import { bridge, type Series } from "@/lib/budget/series";
import { etpCascade, masseByRubric, STEP_LABELS, type StepId } from "@/lib/budget/cascade";
import { ECART_DEFINITIONS } from "@/lib/budget/ecart-definitions";
import { alignedSeries } from "@/lib/budget/versions";
import { fmtFixed, fmtPercent } from "@/lib/rh/kpi/format";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { loadVersions } from "../ecart-data";
import { MsTabs, PickerForm, Waterfall } from "../EcartParts";
import { peopleIndex } from "../people-index";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;
const etp = (n: number) => fmtFixed({ num: n, den: 10000 }, 2);
const sg = (n: number, f: (x: number) => string) => `${n > 0 ? "+" : ""}${f(n)}`;
const COMMENT: Record<StepId, string> = {
  "entrees-new": "Salariés présents dans la version B et jamais présents dans la version A.",
  "entrees-report": "Salariés présents dans les deux versions, plus de mois présents en B qu'en A : effet en année pleine d'une entrée survenue pendant A.",
  sorties: "Salariés présents dans la version A et jamais présents dans la version B.",
  "sorties-deport": "Salariés présents dans les deux versions, moins de mois présents en B qu'en A : sortie survenue pendant B.",
  "etp-change": "Salariés présents dans les deux versions dont la quotité moyenne diffère, pondérée par leur présence en B.",
};
const weight = (n: number, total: number) => (total === 0 ? "n.d." : `${(n < 0) !== (total < 0) ? "−" : "+"}${fmtPercent({ num: Math.abs(n), den: Math.abs(total) })}`);

export default async function AnalysePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const canZoom = hasAtLeast(workspace.role, "editor");
  const loaded = await loadVersions(slug, workspace.id, sp, 2);
  const [a, b] = loaded.versions;
  const base = `/e/${slug}/studio-rh/masse-salariale/analyse`;
  const monthsA = a ? loaded.months(a.year) : [];
  const monthsB = b ? loaded.months(b.year) : [];
  const cascade = a && b ? etpCascade(a, b, monthsA, monthsB) : null;
  const masse = a && b ? masseByRubric(a, b, monthsA, monthsB) : null;
  const pont = a && b ? bridge(alignedSeries(b, monthsB, monthsA) as Series, alignedSeries(a, monthsA, monthsA) as Series, monthsA) : null;
  const people = canZoom ? peopleIndex(loaded) : null;
  const nameOf = (k: string) => people?.get(k)?.label ?? k;

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
      </div>
      <MsTabs slug={slug} current="analyse" />
      <section className="panel" data-testid="analyse">
        <h2>Analyse des écarts <span className="desc">— d'où vient l'écart entre deux versions · <a href="#def-cascade">règles</a></span></h2>
        {loaded.ctx.unavailable && <p className="notice">Journal de paie PayFit indisponible : {loaded.ctx.unavailable}. Les versions réelles sont n.d.</p>}
        {loaded.notices.map((n) => <p key={n} className="notice">{n}</p>)}
        <PickerForm path={base} loaded={loaded} columns={2} />
        {!a || !b ? <p className="desc" data-testid="analyse-empty">Choisissez deux versions à comparer (version 1 = départ, version 2 = arrivée).</p> : (
          <p className="desc" data-testid="analyse-context">{loaded.shorts[0]} → {loaded.shorts[1]} · rangs de mois {loaded.from}–{loaded.to} · {loaded.filter ? `service ${loaded.filter.value ?? "non ventilé"}` : "tous les services"}</p>
        )}
      </section>

      {a && b && cascade && (
        <section className="panel" data-testid="analyse-etp">
          <h2>ETP — de la version 1 à la version 2 <span className="desc">— moyenne des ETP de fin de mois</span></h2>
          {cascade.kind === "nd" ? (
            <p className="nd" data-testid="analyse-etp-nd">n.d. — {cascade.reason}</p>
          ) : (
            <>
              <Waterfall testid="wf-etp" startLabel="Version 1" endLabel="Version 2" start={cascade.start} end={cascade.end} steps={cascade.steps.map((s) => ({ label: s.label, value: s.etp4 }))} fmt={etp} />
              <div className="table-wrap">
                <table className="data-table" data-testid="analyse-etp-table">
                  <thead><tr><th>Rubrique</th><th className="num">ETP</th><th className="num">Poids des écarts</th><th>Commentaire</th></tr></thead>
                  <tbody>
                    <tr data-step="start"><td>ETP {loaded.shorts[0]}</td><td className="num" data-col="valeur">{etp(cascade.start)}</td><td /><td className="wrap">Moyenne des ETP de fin de mois sur {cascade.months} mois.</td></tr>
                    {cascade.steps.map((s) => (
                      <tr key={s.id} data-step={s.id}>
                        <td>{STEP_LABELS[s.id]}</td>
                        <td className="num" data-col="valeur">{sg(s.etp4, etp)}</td>
                        <td className="num">{s.etp4 === 0 ? "—" : weight(s.etp4, cascade.end - cascade.start)}</td>
                        <td className="wrap">{COMMENT[s.id]}</td>
                      </tr>
                    ))}
                    <tr data-step="residual"><td>Résiduel d'arrondi</td><td className="num" data-col="valeur">{sg(cascade.residual, etp)}</td><td /><td className="wrap">Nul par construction : chaque palier cumulé est arrondi une seule fois.</td></tr>
                    <tr data-step="end"><th>ETP {loaded.shorts[1]}</th><td className="num" data-col="valeur">{etp(cascade.end)}</td><td className="num" data-col="ecart">écart {sg(cascade.end - cascade.start, etp)}</td><td className="wrap">Départ + contributions + résiduel = arrivée.</td></tr>
                  </tbody>
                </table>
              </div>
              {canZoom ? (
                <details data-testid="analyse-etp-who">
                  <summary>Salariés derrière chaque contribution</summary>
                  <ul className="list">
                    {cascade.steps.filter((s) => s.people.length).map((s) => <li key={s.id} className="desc"><strong>{STEP_LABELS[s.id]}</strong> : {s.people.slice(0, 30).map((p) => `${nameOf(p.key)} ${sg(p.etp4, etp)}`).join(" · ")}{s.people.length > 30 ? ` · … (${s.people.length - 30} autres)` : ""}</li>)}
                  </ul>
                </details>
              ) : <p className="tile-foot">Le détail nominatif est réservé aux administrateurs et aux éditeurs.</p>}
            </>
          )}
        </section>
      )}

      {a && b && masse && (
        <section className="panel" data-testid="analyse-masse">
          <h2>Masse salariale chargée — contributions par rubrique</h2>
          {masse.kind === "nd" ? (
            <p className="nd" data-testid="analyse-masse-nd">n.d. — {masse.reason}</p>
          ) : (
            <>
              <Waterfall testid="wf-masse" startLabel="Version 1" endLabel="Version 2" start={masse.start} end={masse.end} steps={[...masse.steps.filter((s) => s.delta !== null).map((s) => ({ label: s.label, value: s.delta! })), ...(masse.steps.some((s) => s.delta === null) ? [{ label: "Rubriques n.d.", value: masse.residual! }] : [])]} fmt={(n) => formatEuros(n)} />
              <div className="table-wrap">
                <table className="data-table" data-testid="analyse-masse-table">
                  <thead><tr><th>Rubrique</th><th className="num">Écart</th><th className="num">Poids des écarts</th></tr></thead>
                  <tbody>
                    <tr data-step="start"><td>{loaded.shorts[0]}</td><td className="num" data-col="valeur">{formatEuros(masse.start)}</td><td /></tr>
                    {masse.steps.map((s) => (
                      <tr key={s.key} data-step={s.key}>
                        <td>{s.label}</td>
                        <td className="num" data-col="valeur">{s.delta === null ? <abbr className="nd" title={s.reason ?? undefined}>n.d.</abbr> : sg(s.delta, formatEuros)}</td>
                        <td className="num">{s.delta === null || s.delta === 0 ? "—" : weight(s.delta, masse.end - masse.start)}</td>
                      </tr>
                    ))}
                    <tr data-step="residual"><td>{masse.steps.some((s) => s.delta === null) ? "Résiduel (part de l'écart portée par les rubriques n.d.)" : "Résiduel"}</td><td className="num" data-col="valeur">{sg(masse.residual ?? 0, formatEuros)}</td><td /></tr>
                    <tr data-step="end"><th>{loaded.shorts[1]}</th><td className="num" data-col="valeur">{formatEuros(masse.end)}</td><td className="num" data-col="ecart">écart {sg(masse.end - masse.start, formatEuros)}</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="tile-foot">Écart = version 2 − version 1. Départ + contributions + résiduel = arrivée. Les rubriques n.d. sont expliquées au survol ; le résiduel est nul quand toutes les rubriques sont connues.</p>
            </>
          )}
        </section>
      )}

      {a && b && pont && (
        <section className="panel" data-testid="analyse-pont">
          <h2>Pont volume / coût moyen</h2>
          {pont.kind === "nd" ? (
            <p className="nd" data-testid="analyse-pont-nd">n.d. — {pont.reason}</p>
          ) : (
            <dl className="facts">
              <div data-testid="pont-delta"><dt>Écart de masse salariale</dt><dd>{sg(pont.delta, formatEuros)}</dd><span className="tile-foot">{loaded.shorts[1]} − {loaded.shorts[0]}</span></div>
              <div data-testid="pont-volume"><dt>Effet volume</dt><dd>{sg(pont.volume, formatEuros)}</dd><span className="tile-foot">écart d'ETP-mois × coût par ETP-mois de {loaded.shorts[0]}</span></div>
              <div data-testid="pont-cout"><dt>Effet coût moyen</dt><dd>{sg(pont.averageCost, formatEuros)}</dd><span className="tile-foot">le reste : la somme égale l'écart · <a href="#def-contributions">définition</a></span></div>
            </dl>
          )}
        </section>
      )}

      <details className="panel" data-testid="analyse-definitions" id="definitions">
        <summary>Définitions et règles de calcul</summary>
        <dl className="defs">{ECART_DEFINITIONS.map((d) => <div key={d.id} id={`def-${d.id}`}><dt>{d.title}</dt><dd>{d.text}</dd></div>)}</dl>
      </details>
    </>
  );
}
