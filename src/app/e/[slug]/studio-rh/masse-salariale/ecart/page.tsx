import "@/styles/ecart.css";
import { GlossaryLink } from "@/components/GlossaryLink";
import { Pager } from "@/components/Pager";
import { formatEuros } from "@/lib/money";
import { aggregate, diff, type RowKey, type Version } from "@/lib/budget/versions";
import { zoomOf, ZOOM_RUBRICS, HORS_SALARIE, type ZoomRubric } from "@/lib/budget/zoom";
import { ECART_TERMS } from "@/lib/glossary/ecart";
import { costTone } from "@/lib/trend";
import { ecartChartData, gapTone, RUBRIC_KEYS, rubricGroups } from "@/lib/viz/ecart";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { loadVersions } from "../ecart-data";
import { ecartRows } from "../ecart-rows";
import { eurosSigned, Gap, gapSign, gapText, GapPct, MsHeader, MsTabs, neg, PanelTitle, periodText, pctSign, PickerForm, scopeText, TBL, toneClass, TrendLegend, Val, VerBadge, VerPair, VersionChain } from "../EcartParts";
import { peopleIndex } from "../people-index";
import { EcartChart } from "./EcartChart";
import { LiveLink, LiveViewSwitch, RubInput } from "./LiveRub";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;
const PAGE_SIZE = 100;
const ZOOM_KEYS = Object.keys(ZOOM_RUBRICS) as ZoomRubric[];
type Affichage = "tout" | "graphique" | "tableau";
const AFFICHAGES: Affichage[] = ["tout", "graphique", "tableau"];
const KIND_LABEL: Record<Version["kind"], string> = { reel: "Réel PayFit", scenario: "Scénario", budget: "Budget saisi" };
// Mise en forme des lignes : la masse chargée est le total, le brut et les charges ses sous-totaux, les rubriques de rémunération
// des lignes de détail du brut (voir ecart.css).
const ROW_CLASS: Partial<Record<RowKey, string>> = { masse: "total", brut: "subtotal child", charges: "subtotal child", nonventile: "child", remun: "child2", primes: "child2", indemnites: "child2", autres: "child2" };
// « ? » du glossaire sur la tête de chaque groupe de lignes : les effectifs (ETP, inscrits, entrées, sorties) et les rubriques de masse.
const ROW_TERM: Partial<Record<RowKey, { term: string; label: string }>> = {
  etp: { term: ECART_TERMS.effectifs, label: "Effectifs et ETP de l'écart" },
  masse: { term: ECART_TERMS.rubriques, label: "Rubriques de l'écart" },
};

export default async function EcartPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireWorkspace(slug);
  const canZoom = hasAtLeast(workspace.role, "editor");
  const loaded = await loadVersions(slug, workspace.id, sp, 3);
  const { versions } = loaded;
  const vue = one(sp.vue) === "detail" ? "detail" : "synthese";
  const rub = RUBRIC_KEYS.includes(one(sp.rub) as RowKey) ? (one(sp.rub) as RowKey) : "masse";
  const aff: Affichage = AFFICHAGES.includes(one(sp.affichage) as Affichage) ? (one(sp.affichage) as Affichage) : "tout";
  const showGraph = versions.length > 0 && aff !== "tableau";
  const showTable = versions.length > 0 && aff !== "graphique";
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
  // Paramètres d'affichage reportés dans chaque lien de la page (niveau de détail, rubrique du graphique, affichage).
  const view: Record<string, string> = { vue, rub, ...(aff !== "tout" ? { affichage: aff } : {}) };
  const monthsOf = (v: Version) => loaded.months(v.year);
  const header = (i: number) => loaded.shorts[i];
  const period = periodText(loaded.from, loaded.to);
  const scope = scopeText(loaded);
  const exportQuery = new URLSearchParams(keep);
  exportQuery.set("vue", vue);
  // Même comparaison dans l'analyse des écarts (deux versions consécutives, même période et même service).
  const analyseHref = (i: number) => {
    const p = new URLSearchParams({ v1: loaded.selected[i], v2: loaded.selected[i + 1], de: loaded.from, a: loaded.to });
    if (keep.get("service")) p.set("service", keep.get("service")!);
    return `/e/${slug}/studio-rh/masse-salariale/analyse?${p.toString()}`;
  };

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
      const fmt = (n: number | null) => (n === null ? "—" : neg(formatEuros(n)));
      const sg = eurosSigned;
      const zoomQ = (extra: Record<string, string>) => q({ ...view, zoom: `${zoomRubric}:${pair + 1}`, ...(search ? { zq: one(sp.zq) } : {}), ...(nz ? {} : { nz: "0" }), ...extra });
      const exportZoom = new URLSearchParams(keep);
      exportZoom.set("zoom", `${zoomRubric}:${pair + 1}`);
      zoomBlock = (
        <section className="panel" id="zoom" data-testid="zoom">
          <div className="panel-head">
            <PanelTitle title={`Détail par salarié — ${ZOOM_RUBRICS[zoomRubric]}`} slug={slug} term={ECART_TERMS.zoom} label="Détail par salarié">
              <VersionChain labels={[a.label, b.label]} first={pair + 1} /> · {period} · {scope}
            </PanelTitle>
            <div className="panel-tools">
              <a className="btn" href={`${base}/export?${exportZoom.toString()}`} data-testid="zoom-export">Exporter le détail (CSV)</a>
            </div>
          </div>
          <form method="get" action={base} className="filters" data-testid="zoom-filters">
            {[...keep].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {Object.entries(view).map(([k, v]) => (k === "rub" ? <RubInput key={k} initial={v} /> : <input key={k} type="hidden" name={k} value={v} />))}
            <input type="hidden" name="zoom" value={`${zoomRubric}:${pair + 1}`} />
            <div className="field-row"><label htmlFor="zq">Rechercher (nom, matricule, service)</label><input className="input" id="zq" name="zq" defaultValue={one(sp.zq)} /></div>
            <label className="check"><input type="checkbox" name="nz" value="1" defaultChecked={nz} /><span>Écart non nul seulement</span></label>
            {!nz && <input type="hidden" name="nz" value="0" />}
            <button className="btn" type="submit">Filtrer</button>
          </form>
          {!showTable && <TrendLegend slug={slug} />}
          <div className="table-wrap scroll">
            <table className="data-table sticky ecart-table stack-sm" data-testid="zoom-table" {...TBL.table}>
              <caption className="ecart-sr">Détail par salarié de l'écart de {ZOOM_RUBRICS[zoomRubric]}, de {a.label} à {b.label}</caption>
              <thead {...TBL.group}><tr {...TBL.row}><th scope="col" className="num" {...TBL.head}>Écart</th><th scope="col" className="num" {...TBL.head}>{loaded.shorts[pair]}</th><th scope="col" className="num" {...TBL.head}>{loaded.shorts[pair + 1]}</th><th scope="col" {...TBL.head}>Matricule</th><th scope="col" {...TBL.head}>Nom</th><th scope="col" {...TBL.head}>Service</th><th scope="col" {...TBL.head}>Contrat</th><th scope="col" {...TBL.head}>Date d'embauche</th><th scope="col" {...TBL.head}>Date de sortie</th></tr></thead>
              <tbody {...TBL.group}>
                {slice.map((r) => (
                  <tr key={r.k} data-person={r.info.label} {...TBL.row}>
                    <td className={toneClass("num gap", costTone(r.d))} data-col="ecart" data-sign={r.d === 0 ? "zero" : r.d > 0 ? "up" : "down"} data-label="Écart" {...TBL.cell}>{sg(r.d)}</td><td className="num" data-label={loaded.shorts[pair]} {...TBL.cell}>{fmt(r.av)}</td><td className="num" data-label={loaded.shorts[pair + 1]} {...TBL.cell}>{fmt(r.bv)}</td>
                    <td data-label="Matricule" {...TBL.cell}>{r.info.externalId ?? "—"}</td><td className="wrap" data-card="title" {...TBL.cell}>{r.info.label}</td><td data-label="Service" {...TBL.cell}>{r.info.service ?? "—"}</td><td data-label="Contrat" {...TBL.cell}>{r.info.contract ?? "—"}</td><td data-label="Date d'embauche" {...TBL.cell}>{r.info.start ?? "—"}</td><td data-label="Date de sortie" {...TBL.cell}>{r.info.end ?? "—"}</td>
                  </tr>
                ))}
                {slice.length === 0 && <tr {...TBL.row}><td colSpan={9} className="desc" {...TBL.cell}>Aucune ligne.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={shown.length} href={(pg) => `${zoomQ({ zp: String(pg) })}#zoom`} testid="zoom-pager" />
          <p className="tile-foot" data-testid="zoom-totals">
            Total non filtré : <strong data-col="total-all">{sg(total)}</strong> · total affiché (après filtre) : <strong data-col="total-shown">{sg(shownTotal)}</strong> ·{" "}
            {aggregated.kind === "value" ? (aggregated.num === total ? <span data-testid="zoom-ok">rapproché de l'écart de la rubrique ({sg(aggregated.num)})</span> : <span className="nd" data-testid="zoom-gap">écart de rubrique {sg(aggregated.num)} ≠ somme des salariés {sg(total)}</span>) : <span className="nd">écart de rubrique n.d.</span>}
            {" · "}{shown.length} ligne{shown.length > 1 ? "s" : ""}
          </p>
        </section>
      );
    }
  }
  const zoomHref = (key: RowKey, i: number) => (ZOOM_KEYS.includes(key as ZoomRubric) && canZoom ? `${q({ ...view, zoom: `${key}:${i + 1}` })}#zoom` : null);
  const reasons = [...new Set(rows.flatMap((r) => [...r.aggs, ...r.gaps].flatMap((x) => (x.kind === "nd" ? [`${r.label} : ${x.reason}`] : []))))];
  const affHref = (key: Affichage) => q({ vue, rub, ...(key !== "tout" ? { affichage: key } : {}) });
  const chart = showGraph ? ecartChartData(versions, loaded.shorts, monthsOf) : null;

  return (
    <>
      <MsHeader title={ITEM.label} />
      <MsTabs slug={slug} current="ecart" />
      <section className="panel" data-testid="ecart">
        <div className="panel-head">
          <PanelTitle title="Écart budgétaire" slug={slug} term={ECART_TERMS.versions} label="Versions comparées" />
          {versions.length > 0 && (
            <LiveViewSwitch
              initialRub={rub}
              testid="ecart-affichage"
              label="Affichage des résultats"
              current={aff}
              options={[{ key: "tout", label: "Afficher tout", href: affHref("tout") }, { key: "graphique", label: "Graphique", href: affHref("graphique") }, { key: "tableau", label: "Tableau", href: affHref("tableau") }]}
            />
          )}
        </div>
        {loaded.ctx.unavailable && <p className="notice">Journal de paie PayFit indisponible : {loaded.ctx.unavailable}. Les versions réelles sont n.d.</p>}
        {loaded.notices.map((n) => <p key={n} className="notice">{n}</p>)}
        <PickerForm path={base} loaded={loaded} columns={3} hidden={view} slug={slug} />
        {versions.length === 0 && (
          <p className="desc" data-testid="ecart-empty">Aucune version à comparer : lisez le journal de paie PayFit dans Données ou créez un scénario dans Hypothèses budgétaires.</p>
        )}
      </section>

      {chart && (
        <section className="panel" data-testid="ecart-graph" id="graphique">
          <div className="panel-head">
            <PanelTitle title="Évolution mensuelle par version" slug={slug} term={ECART_TERMS.courbes} label="Lecture des courbes par version" />
          </div>
          <EcartChart
            testid="ecart-chart"
            initial={rub}
            groups={rubricGroups()}
            categories={chart.categories}
            categoryTitles={chart.categoryTitles}
            data={chart.byRubric}
            period={period}
            scope={scope}
            axisHelp={<GlossaryLink slug={slug} term={ECART_TERMS.axeAjuste} label="Lecture d'un graphique à axe ajusté" />}
          />
        </section>
      )}

      {showTable && (
        <section className="panel" data-testid="ecart-tableau" id="tableau">
          <div className="panel-head">
            <PanelTitle title="Écart par rubrique" slug={slug} term={ECART_TERMS.ecart} label="Écart" />
            <div className="panel-tools">
              <LiveViewSwitch
                initialRub={rub}
                testid="ecart-vues"
                label="Niveau de détail"
                current={vue}
                options={[{ key: "synthese", label: "Synthèse", href: q({ ...view, vue: "synthese" }) }, { key: "detail", label: "Détail", href: q({ ...view, vue: "detail" }) }]}
              />
              <a className="btn" href={`${base}/export?${exportQuery.toString()}`} data-testid="ecart-export">Exporter en CSV</a>
            </div>
          </div>
          <TrendLegend slug={slug} />
          <div className="table-wrap scroll">
            <table className="data-table sticky sticky-first ecart-table ecart-main stack-sm" data-testid="ecart-table" {...TBL.table}>
              <caption className="ecart-sr">Écart par rubrique entre les versions comparées, {period}, {scope}</caption>
              <thead {...TBL.group}>
                <tr {...TBL.row}>
                  <th scope="col" {...TBL.head}>Rubrique</th>
                  <th scope="col" className="num ver-col" title={versions[0].label} {...TBL.head}><VerBadge n={1} /><span className="ver-name">{header(0)}</span><span className="ver-kind">{KIND_LABEL[versions[0].kind]}</span></th>
                  {versions.slice(1).flatMap((v, i) => [
                    <th key={`v${i}`} scope="col" className="num ver-col" title={v.label} {...TBL.head}><VerBadge n={i + 2} /><span className="ver-name">{header(i + 1)}</span><span className="ver-kind">{KIND_LABEL[v.kind]}</span></th>,
                    <th key={`g${i}`} scope="col" className="num" {...TBL.head}><VerPair to={i + 2} from={i + 1} />Écart</th>,
                    <th key={`p${i}`} scope="col" className="num" {...TBL.head}><VerPair to={i + 2} from={i + 1} />Écart (%){i === 0 && <GlossaryLink slug={slug} term={ECART_TERMS.ecartPourcentage} label="Écart en pourcentage" />}</th>,
                  ])}
                </tr>
              </thead>
              <tbody {...TBL.group}>
                {rows.map((r) => {
                  const help = ROW_TERM[r.key];
                  return (
                    <tr key={r.key} data-row={r.key} className={ROW_CLASS[r.key]} {...TBL.row}>
                      <th scope="row" {...TBL.rowhead}>{r.label}{help && <GlossaryLink slug={slug} term={help.term} label={help.label} />}</th>
                      <td className="num" data-col="v1" data-label={`Version 1 · ${header(0)}`} {...TBL.cell}><Val agg={r.aggs[0]} unit={r.unit} /></td>
                      {r.aggs.slice(1).flatMap((agg, i) => {
                        const href = zoomHref(r.key, i);
                        const g = r.gaps[i];
                        const text = gapText(g, r.unit);
                        return [
                          <td key={`v${i}`} className="num" data-col={`v${i + 2}`} data-label={`Version ${i + 2} · ${header(i + 1)}`} {...TBL.cell}><Val agg={agg} unit={r.unit} /></td>,
                          <td key={`g${i}`} className={toneClass("num gap", gapTone(r.key, g))} data-col={`g${i + 1}`} data-sign={gapSign(g)} data-label={`Écart · version ${i + 2} − version ${i + 1}`} {...TBL.cell}>{href && text !== null ? <LiveLink initialRub={rub} href={href} title="Voir le détail par salarié de cet écart" label={`${text}, voir le détail par salarié`}><Gap d={g} unit={r.unit} /></LiveLink> : <Gap d={g} unit={r.unit} />}</td>,
                          <td key={`p${i}`} className={toneClass("num gap", gapTone(r.key, g, "pct"))} data-col={`p${i + 1}`} data-sign={pctSign(g)} data-label={`Écart (%) · version ${i + 2} − version ${i + 1}`} {...TBL.cell}><GapPct d={g} /></td>,
                        ];
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {versions.length > 1 && (
            <p className="tile-foot" data-testid="ecart-vers-analyse">
              Analyse des écarts : {versions.slice(1).map((_, i) => <span key={i}>{i > 0 && " · "}<a href={analyseHref(i)}>version {i + 1} → version {i + 2}</a></span>)}
            </p>
          )}
          {reasons.length > 0 && (
            <details data-testid="ecart-nd">
              <summary>Données absentes ({reasons.length})</summary>
              <ul className="list">{reasons.map((x) => <li key={x} className="desc">{x}</li>)}</ul>
            </details>
          )}
        </section>
      )}
      {zoomBlock}
    </>
  );
}
