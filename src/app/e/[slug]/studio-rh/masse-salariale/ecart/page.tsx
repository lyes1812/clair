import { formatEuros } from "@/lib/money";
import { aggregate, diff, ROW_LABELS, ROW_UNIT, type Cell, type RowKey, type Version } from "@/lib/budget/versions";
import { ECART_DEFINITIONS } from "@/lib/budget/ecart-definitions";
import { zoomOf, ZOOM_RUBRICS, HORS_SALARIE, type ZoomRubric } from "@/lib/budget/zoom";
import { fmtFixed } from "@/lib/rh/kpi/format";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { loadVersions } from "../ecart-data";
import { ecartRows } from "../ecart-rows";
import { Gap, GapPct, MsTabs, PickerForm, rankLabel, Val } from "../EcartParts";
import { peopleIndex } from "../people-index";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;
const PAGE_SIZE = 100;
const ZOOM_KEYS = Object.keys(ZOOM_RUBRICS) as ZoomRubric[];
const CHART_KEYS: RowKey[] = ["masse", "brut", "charges", "remun", "primes", "indemnites", "etp", "headcount", "entrees", "sorties"];

const cellValue = (c: Cell) => (c.kind === "value" ? c.v : null);

function Chart({ versions, labels, monthsOf, rub }: { versions: Version[]; labels: string[]; monthsOf: (v: Version) => string[]; rub: RowKey }) {
  const ranks = monthsOf(versions[0]).map((m) => m.slice(5, 7));
  const series = versions.map((v) => monthsOf(v).map((m) => {
    const f = v.months.get(m);
    return f ? cellValue(rub === "etp" ? f.etp4 : f[rub as Exclude<RowKey, "etp">]) : null;
  }));
  const max = Math.max(1, ...series.flat().map((x) => x ?? 0));
  const bw = 14;
  const gw = versions.length * bw + 12;
  const H = 150;
  const W = ranks.length * gw + 20;
  const fills = ["var(--ink)", "var(--blue)", "url(#ecart-hatch)"];
  return (
    <svg viewBox={`0 0 ${W} ${H + 32}`} role="img" aria-label={`${ROW_LABELS[rub]} par mois et par version`} style={{ width: "100%", maxWidth: W, height: "auto" }} data-testid="ecart-chart">
      <defs><pattern id="ecart-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="var(--blue)" /></pattern></defs>
      <line x1="6" x2={W - 6} y1={H} y2={H} stroke="var(--line)" />
      {ranks.map((mm, i) => (
        <g key={mm}>
          {series.map((s, j) => {
            const v = s[i];
            const x = 12 + i * gw + j * bw;
            return v === null ? (
              <rect key={j} x={x} y={H - 14} width={bw - 2} height="14" fill="#e7eaf0"><title>{`${labels[j]}, ${rankLabel(mm)} : n.d.`}</title></rect>
            ) : (
              <rect key={j} x={x} y={H - Math.max(0, (Math.max(0, v) / max) * (H - 14))} width={bw - 2} height={Math.max(0, (Math.max(0, v) / max) * (H - 14))} fill={fills[j]} stroke={j === 2 ? "var(--blue)" : "none"}>
                <title>{`${labels[j]}, ${rankLabel(mm)} : ${ROW_UNIT[rub] === "eur" ? formatEuros(v) : ROW_UNIT[rub] === "etp" ? fmtFixed({ num: v, den: 10000 }, 2) : v}`}</title>
              </rect>
            );
          })}
          <text x={12 + i * gw + (versions.length * bw) / 2} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{rankLabel(mm)}</text>
        </g>
      ))}
    </svg>
  );
}

export default async function EcartPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const canZoom = hasAtLeast(workspace.role, "editor");
  const loaded = await loadVersions(slug, workspace.id, sp, 3);
  const { versions } = loaded;
  const vue = one(sp.vue) === "detail" ? "detail" : "synthese";
  const rub = CHART_KEYS.includes(one(sp.rub) as RowKey) ? (one(sp.rub) as RowKey) : "masse";
  const rows = ecartRows(loaded, vue);
  const base = `/e/${slug}/studio-rh/masse-salariale/ecart`;
  const keep = new URLSearchParams();
  for (const k of ["v1", "v2", "v3", "de", "a", "service"]) if (one(sp[k])) keep.set(k, one(sp[k]));
  if (!keep.has("v1") && loaded.selected.length) loaded.selected.forEach((v, i) => keep.set(`v${i + 1}`, v));
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${base}?${p.toString()}`;
  };
  const monthsOf = (v: Version) => loaded.months(v.year);
  const header = (i: number) => loaded.shorts[i];

  // Détail par salarié d'un écart (rubrique : paire de versions).
  const [zr, zp] = one(sp.zoom).split(":");
  const zoomRubric = ZOOM_KEYS.includes(zr as ZoomRubric) ? (zr as ZoomRubric) : null;
  const pair = zp === "2" ? 1 : 0;
  const zoomOk = canZoom && zoomRubric !== null && versions[pair + 1] !== undefined;
  let zoomBlock: React.ReactNode = null;
  if (zoomRubric && !canZoom) {
    zoomBlock = <section className="panel" data-testid="zoom-denied"><h2>Détail par salarié</h2><p className="nd">Le détail nominatif d'un écart est réservé aux administrateurs et aux éditeurs de l'espace.</p></section>;
  } else if (zoomOk && zoomRubric) {
    const a = versions[pair];
    const b = versions[pair + 1];
    const za = zoomOf(loaded.sources[pair], monthsOf(a), zoomRubric);
    const zb = zoomOf(loaded.sources[pair + 1], monthsOf(b), zoomRubric);
    const people = peopleIndex(loaded);
    if (za.kind === "nd" || zb.kind === "nd") {
      zoomBlock = <section className="panel" data-testid="zoom"><h2>Détail par salarié — {ZOOM_RUBRICS[zoomRubric]}</h2><p className="nd">n.d. — {za.kind === "nd" ? `${a.label} : ${za.reason}` : `${b.label} : ${(zb as { reason: string }).reason}`}</p></section>;
    } else {
      const keys = [...new Set([...za.byKey.keys(), ...zb.byKey.keys()])];
      const all = keys.map((k) => {
        const av = za.byKey.get(k) ?? null;
        const bv = zb.byKey.get(k) ?? null;
        const info = k === HORS_SALARIE ? { label: "Hors salarié (enveloppes, éléments sans salarié, lignes de journal sans contrat)", externalId: null, service: null, contract: null, start: null, end: null } : (people.get(k) ?? { label: k, externalId: k, service: null, contract: null, start: null, end: null });
        return { k, av, bv, d: (bv ?? 0) - (av ?? 0), info };
      });
      const total = all.reduce((s, r) => s + r.d, 0);
      const aggregated = diff(aggregate(a, monthsOf(a), zoomRubric), aggregate(b, monthsOf(b), zoomRubric));
      const search = one(sp.zq).trim().toLowerCase();
      const nz = one(sp.nz) !== "0";
      const shown = all.filter((r) => (!nz || r.d !== 0) && (!search || `${r.info.label} ${r.info.externalId ?? ""} ${r.info.service ?? ""}`.toLowerCase().includes(search))).sort((x, y) => x.info.label.localeCompare(y.info.label));
      const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
      const page = Math.min(pages, Math.max(1, Number(one(sp.zp)) || 1));
      const slice = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const shownTotal = shown.reduce((s, r) => s + r.d, 0);
      const fmt = (n: number | null) => (n === null ? "—" : formatEuros(n));
      const sg = (n: number) => `${n > 0 ? "+" : ""}${formatEuros(n)}`;
      const zoomQ = (extra: Record<string, string>) => q({ vue, rub, zoom: `${zoomRubric}:${pair + 1}`, ...(search ? { zq: one(sp.zq) } : {}), ...(nz ? {} : { nz: "0" }), ...extra });
      zoomBlock = (
        <section className="panel" id="zoom" data-testid="zoom">
          <h2>Détail par salarié — {ZOOM_RUBRICS[zoomRubric]} <span className="desc">— <a href="#def-zoom">règle</a></span></h2>
          <p className="desc">{a.label} → {b.label} · {loaded.from}–{loaded.to} (rangs de mois){loaded.filter ? ` · service ${loaded.filter.value ?? "non ventilé"}` : " · tous les services"}</p>
          <form method="get" action={base} className="filters" data-testid="zoom-filters">
            {[...keep].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="vue" value={vue} /><input type="hidden" name="rub" value={rub} /><input type="hidden" name="zoom" value={`${zoomRubric}:${pair + 1}`} />
            <div className="field-row"><label htmlFor="zq">Rechercher (nom, matricule, service)</label><input className="input" id="zq" name="zq" defaultValue={one(sp.zq)} /></div>
            <label className="check"><input type="checkbox" name="nz" value="1" defaultChecked={nz} /><span>Écart non nul seulement</span></label>
            {!nz && <input type="hidden" name="nz" value="0" />}
            <button className="btn" type="submit">Filtrer</button>
          </form>
          <div className="table-wrap">
            <table className="data-table" data-testid="zoom-table">
              <thead><tr><th className="num">Écart</th><th className="num">{loaded.shorts[pair]}</th><th className="num">{loaded.shorts[pair + 1]}</th><th>Matricule</th><th>Nom</th><th>Service</th><th>Contrat</th><th>Date d'embauche</th><th>Date de sortie</th></tr></thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={r.k} data-person={r.info.label}>
                    <td className="num" data-col="ecart">{sg(r.d)}</td><td className="num">{fmt(r.av)}</td><td className="num">{fmt(r.bv)}</td>
                    <td>{r.info.externalId ?? "—"}</td><td className="wrap">{r.info.label}</td><td>{r.info.service ?? "—"}</td><td>{r.info.contract ?? "—"}</td><td>{r.info.start ?? "—"}</td><td>{r.info.end ?? "—"}</td>
                  </tr>
                ))}
                {slice.length === 0 && <tr><td colSpan={9} className="desc">Aucune ligne.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="tile-foot" data-testid="zoom-totals">
            Total non filtré : <strong data-col="total-all">{sg(total)}</strong> · total affiché (après filtre) : <strong data-col="total-shown">{sg(shownTotal)}</strong> ·{" "}
            {aggregated.kind === "value" ? (aggregated.num === total ? <span data-testid="zoom-ok">rapproché de l'écart de la rubrique ({sg(aggregated.num)})</span> : <span className="nd" data-testid="zoom-gap">écart de rubrique {sg(aggregated.num)} ≠ somme des salariés {sg(total)}</span>) : <span className="nd">écart de rubrique n.d.</span>}
            {" · "}{shown.length} ligne{shown.length > 1 ? "s" : ""}, page {page}/{pages}
          </p>
          <p className="actions">
            {page > 1 && <a className="btn" href={`${zoomQ({ zp: String(page - 1) })}#zoom`}>Page précédente</a>}
            {page < pages && <a className="btn" href={`${zoomQ({ zp: String(page + 1) })}#zoom`}>Page suivante</a>}
            <a className="btn" href={`${base}/export?${new URLSearchParams({ ...Object.fromEntries(keep), zoom: `${zoomRubric}:${pair + 1}` }).toString()}`}>Télécharger le détail (CSV)</a>
          </p>
        </section>
      );
    }
  }
  const zoomHref = (key: RowKey, i: number) => (ZOOM_KEYS.includes(key as ZoomRubric) && canZoom ? `${q({ vue, rub, zoom: `${key}:${i + 1}` })}#zoom` : null);
  const reasons = [...new Set(rows.flatMap((r) => [...r.aggs, ...r.gaps].flatMap((x) => (x.kind === "nd" ? [`${r.label} : ${x.reason}`] : []))))];

  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
      </div>
      <MsTabs slug={slug} current="ecart" />
      <section className="panel" data-testid="ecart">
        <h2>Écart budgétaire <span className="desc">— comparaison de versions de même période · <a href="#def-versions">règles</a></span></h2>
        {loaded.ctx.unavailable && <p className="notice">Journal de paie PayFit indisponible : {loaded.ctx.unavailable}. Les versions réelles sont n.d.</p>}
        {loaded.notices.map((n) => <p key={n} className="notice">{n}</p>)}
        <PickerForm path={base} loaded={loaded} columns={3} hidden={{ vue, rub }} />
        {versions.length === 0 ? (
          <p className="desc" data-testid="ecart-empty">Aucune version à comparer : lisez le journal de paie PayFit dans Données ou créez un scénario dans Hypothèses budgétaires.</p>
        ) : (
          <>
            <nav className="tabs" aria-label="Niveau de détail" data-testid="ecart-vues">
              <a href={q({ vue: "synthese", rub })} aria-current={vue === "synthese" ? "page" : undefined}>Synthèse</a>
              <a href={q({ vue: "detail", rub })} aria-current={vue === "detail" ? "page" : undefined}>Détail</a>
            </nav>
            <div className="table-wrap">
              <table className="data-table" data-testid="ecart-table">
                <thead>
                  <tr>
                    <th>Rubrique</th>
                    <th className="num">{header(0)}</th>
                    {versions.slice(1).flatMap((_, i) => [
                      <th key={`v${i}`} className="num">{header(i + 1)}</th>,
                      <th key={`g${i}`} className="num">Écart {i + 2}−{i + 1}</th>,
                      <th key={`p${i}`} className="num">Écart {i + 2}−{i + 1} %</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} data-row={r.key} style={r.indent === 0 && (r.key === "masse") ? { fontWeight: 600 } : undefined}>
                      <td style={{ paddingLeft: 12 + r.indent * 16 }}>{r.label}</td>
                      <td className="num" data-col="v1"><Val agg={r.aggs[0]} unit={r.unit} /></td>
                      {r.aggs.slice(1).flatMap((agg, i) => {
                        const href = zoomHref(r.key, i);
                        return [
                          <td key={`v${i}`} className="num" data-col={`v${i + 2}`}><Val agg={agg} unit={r.unit} /></td>,
                          <td key={`g${i}`} className="num" data-col={`g${i + 1}`}>{href && r.gaps[i].kind === "value" ? <a href={href} title="Détail par salarié"><Gap d={r.gaps[i]} unit={r.unit} /></a> : <Gap d={r.gaps[i]} unit={r.unit} />}</td>,
                          <td key={`p${i}`} className="num" data-col={`p${i + 1}`}><GapPct d={r.gaps[i]} /></td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tile-foot">
              Période : rangs de mois {loaded.from}–{loaded.to} appliqués à l'année de chaque version · {loaded.filter ? `service ${loaded.filter.value ?? "non ventilé"}` : "tous les services"}. Écart = version suivante − version précédente. Une valeur n.d. affiche sa raison au survol et ci-dessous.
              {" "}<a href={`${base}/export?${keep.toString()}&vue=${vue}`}>Télécharger le tableau (CSV)</a>
            </p>
            {reasons.length > 0 && (
              <details data-testid="ecart-nd">
                <summary>Données absentes ({reasons.length})</summary>
                <ul className="list">{reasons.map((x) => <li key={x} className="desc">{x}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </section>
      {versions.length > 0 && (
        <section className="panel" data-testid="ecart-graph">
          <h2>{ROW_LABELS[rub]} par mois <span className="desc">— une barre par version</span></h2>
          <form method="get" action={base} className="filters">
            {[...keep].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="vue" value={vue} />
            <div className="field-row">
              <label htmlFor="rub">Rubrique</label>
              <select className="select" id="rub" name="rub" defaultValue={rub}>{CHART_KEYS.map((k) => <option key={k} value={k}>{ROW_LABELS[k]}</option>)}</select>
            </div>
            <button className="btn" type="submit">Afficher</button>
          </form>
          <Chart versions={versions} labels={loaded.shorts} monthsOf={monthsOf} rub={rub} />
          <p className="tile-foot">{versions.map((v, i) => `${["Plein noir", "Plein bleu", "Hachuré bleu"][i]} : ${loaded.shorts[i]}`).join(" · ")} · barre grise : mois n.d.</p>
        </section>
      )}
      {zoomBlock}
      <details className="panel" data-testid="ecart-definitions" id="definitions">
        <summary>Définitions et règles de calcul</summary>
        <dl className="defs">{ECART_DEFINITIONS.map((d) => <div key={d.id} id={`def-${d.id}`}><dt>{d.title}</dt><dd>{d.text}</dd></div>)}</dl>
      </details>
    </>
  );
}
