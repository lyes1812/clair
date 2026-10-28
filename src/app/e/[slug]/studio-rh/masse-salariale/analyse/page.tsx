import { MoneyText } from "@/components/Money";
import "@/styles/ecart.css";
import { GlossaryLink } from "@/components/GlossaryLink";
import { formatEuros } from "@/lib/money";
import { bridge, type Series } from "@/lib/budget/series";
import { etpCascade, masseByRubric, STEP_LABELS } from "@/lib/budget/cascade";
import { aggregate, alignedSeries, diff, type RowKey } from "@/lib/budget/versions";
import { confidentialiteHref, getConfidentialite } from "@/lib/confidentialite";
import { confidentialiteOf, croiseeLink } from "@/lib/croisee/confidentialite";
import { ECART_TERMS, STEP_TERMS } from "@/lib/glossary/ecart";
import { costTone, trendClass } from "@/lib/trend";
import { cascadeView, etpWaterfallOf, gapTone, guardNd, masseWaterfall, pontWaterfall, type SeuilNd, type WaterfallData } from "@/lib/viz/ecart";
import { fmtFixed } from "@/lib/rh/kpi/format";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { serviceLabel } from "@/lib/payroll/service-rows";
import { hasAtLeast } from "@/lib/roles";
import { requireWorkspace } from "@/lib/workspace";
import { ConfidentialiteLine } from "../components";
import { ecartServiceGuard, loadVersions } from "../ecart-data";
import { GapPct, MsHeader, MsTabs, neg, PanelTitle, periodText, pctSign, PickerForm, scopeText, signOf, TBL, toneClass, TrendLegend } from "../EcartParts";
import { peopleIndex } from "../people-index";
import { LiveViewSwitch } from "../ecart/LiveRub";
import { AnalyseChart, type AnalyseItem } from "./AnalyseChart";
import { Weight } from "./Weight";
import { TitledWaterfall } from "./TitledWaterfall";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;
type Affichage = "tout" | "graphique" | "tableau";
const AFFICHAGES: Affichage[] = ["tout", "graphique", "tableau"];
const etp = (n: number) => fmtFixed({ num: n, den: 10000 }, 2);
const eur = (n: number) => neg(formatEuros(n));
const sg = (n: number, f: (x: number) => string) => `${n > 0 ? "+" : ""}${f(n)}`;
const RUBRIC_OPTIONS = [{ key: "etp", label: "ETP (moyenne des ETP de fin de mois)" }, { key: "masse", label: "Masse salariale chargée" }];
// Les raisons du paramètre absent ou illisible finissent par « (Paramètres) » : ce mot devient le lien vers la section Confidentialité.
const PARAM = " (Paramètres)";

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
  const aff: Affichage = AFFICHAGES.includes(one(sp.affichage) as Affichage) ? (one(sp.affichage) as Affichage) : "tout";
  const rub = RUBRIC_OPTIONS.some((o) => o.key === one(sp.rub)) ? one(sp.rub) : "etp";
  const [s0, s1] = loaded.shorts;
  const period = periodText(loaded.from, loaded.to);
  const scope = scopeText(loaded);
  // Adresse d'un affichage : versions, période et service conservés.
  const keep = new URLSearchParams();
  for (const k of ["v1", "v2", "de", "a", "service"]) if (one(sp[k])) keep.set(k, one(sp[k]));
  if (!keep.has("v1") && loaded.selected.length) loaded.selected.forEach((v, i) => keep.set(`v${i + 1}`, v));
  const affHref = (key: Affichage) => {
    const p = new URLSearchParams(keep);
    p.set("rub", rub);
    if (key !== "tout") p.set("affichage", key);
    return `${base}?${p.toString()}`;
  };
  const ecartHref = `/e/${slug}/studio-rh/masse-salariale/ecart?${keep.toString()}`;
  const hidden: Record<string, string> = { rub, ...(aff !== "tout" ? { affichage: aff } : {}) };
  const showGraph = !!(a && b) && aff !== "tableau";
  const showTables = !!(a && b) && aff !== "graphique";

  // Seuil de confidentialité de l'espace (règle de toute l'application, sans valeur par défaut) et lien contrat → personne du
  // référentiel Collaborateurs. Sous un filtre de service, les chiffres du service (cascade, contributions de masse, pont) décrivent
  // le service retenu sur chaque version : la garde est la garde unique de l'application (ecartServiceGuard : lignes par service du
  // journal masquées par le moteur, masquage secondaire compris, comme la Synthèse de la Masse salariale et l'Écart budgétaire ; mois
  // projetés d'un scénario par les colonnes du mois, maskProjectedServices : une embauche prévue y est affichée sans jamais protéger
  // personne et masquée avec toute la colonne quand celle-ci ne peut pas être protégée) ; gardé, tout le bloc est n.d. Sans filtre,
  // seuls les paliers de la cascade sont masqués (cascadeView → maskCascade : la période et chacun de ses mois, règle « union ») ;
  // les totaux et le pont de toute l'entreprise ne le sont jamais.
  const setting = await getConfidentialite(workspace.id);
  const conf = confidentialiteOf(setting);
  const kpiData = loaded.ctx.kpi.input?.data ?? null;
  const link = kpiData ? croiseeLink(kpiData) : new Map<string, string>();
  const guard = a && b ? guardNd(ecartServiceGuard(loaded, setting)) : null;
  const cv = cascade ? cascadeView(cascade, conf, link, guard) : null;
  const masseNd: SeuilNd | null = !masse ? null : (guard ?? (masse.kind === "nd" ? { reason: masse.reason, param: false } : null));
  const masseOk = masse && masse.kind === "value" && !masseNd ? masse : null;
  const pontNd: SeuilNd | null = !pont ? null : (guard ?? (pont.kind === "nd" ? { reason: pont.reason, param: false } : null));
  const pontOk = pont && pont.kind === "value" && !pontNd ? pont : null;
  const paramHref = confidentialiteHref(slug);
  // Raison d'un n.d. : celle du moteur, nue, la même que celle de toute cellule masquée ; le mot « Paramètres » devient le lien quand
  // le paramètre manque. Sous la garde du filtre Service, le titre du bloc nomme le service retenu (« service X retenu par le filtre »),
  // comme l'Écart budgétaire et la Masse salariale : la mention n'entre jamais dans la raison.
  const ndText = (nd: SeuilNd) =>
    !nd.param ? nd.reason : nd.reason.endsWith(PARAM) ? <>{nd.reason.slice(0, -PARAM.length)} (<a href={paramHref}>Paramètres</a>)</> : <>{nd.reason} (<a href={paramHref}>Paramètres</a>)</>;
  const guardTitle = guard && loaded.filter ? `service ${serviceLabel(loaded.filter.value)} retenu par le filtre : ` : "";
  const blockNd = (nd: SeuilNd) => <>{guardTitle}{ndText(nd)}</>;
  // Graphique n.d. sous la garde : le même titre devant la raison (le graphique écrit « n.d. — » puis la raison reçue).
  const chartNd = (w: WaterfallData): WaterfallData => (guardTitle && w.kind === "nd" ? { kind: "nd", reason: `${guardTitle}${w.reason}` } : w);

  // Pourcentages d'écart repris des agrégats de l'écart budgétaire (mêmes valeurs que sur cette page) : par rubrique de masse,
  // total de la masse et ETP moyen. Une contribution d'ETP n'a pas de valeur de départ propre : pas de pourcentage.
  const pctOf = (k: RowKey) => (a && b ? diff(aggregate(a, monthsA, k), aggregate(b, monthsB, k)) : null);
  const etpPct = pctOf("etp");
  const massePct = pctOf("masse");

  const wfEtp = cv ? chartNd(etpWaterfallOf(cv)) : null;
  const wfMasse: WaterfallData | null = !masse ? null : masseNd ? chartNd({ kind: "nd", reason: masseNd.reason }) : masseWaterfall(masse);
  const wfPont = pontOk ? pontWaterfall(pontOk) : null;
  const items: Record<string, AnalyseItem> | null = wfEtp && wfMasse
    ? {
        etp: { label: RUBRIC_OPTIONS[0].label, title: `ETP — de ${s0} à ${s1}`, ariaLabel: `Cascade des ETP de ${s0} à ${s1}, ${period}, ${scope} : ETP de départ, contributions des entrées et des sorties, ETP d'arrivée`, startLabel: s0, endLabel: s1, trend: "neutral", data: wfEtp },
        masse: { label: RUBRIC_OPTIONS[1].label, title: `Masse salariale chargée — de ${s0} à ${s1}`, ariaLabel: `Cascade de la masse salariale chargée de ${s0} à ${s1}, ${period}, ${scope} : montant de départ, contribution de chaque rubrique, montant d'arrivée`, startLabel: s0, endLabel: s1, trend: "cost", data: wfMasse },
      }
    : null;
  const help = (term: string, label: string) => <GlossaryLink slug={slug} term={term} label={label} />;
  const axisHelp = <GlossaryLink slug={slug} term={ECART_TERMS.axeAjuste} label="Lecture d'un graphique à axe ajusté" />;
  // La légende des couleurs est écrite une fois, au-dessus du tableau de masse ; le pont ne la répète que si ce tableau est absent.
  const legendInMasse = showTables && !!masseOk;
  // Cascade n.d. faute de seuil (service retenu ou paliers) : le graphique écrit la raison, la page ajoute le lien vers les Paramètres.
  const paramNd = guard?.param ? guard : cv && cv.kind === "value" && cv.param ? { reason: cv.chart ?? "", param: true } : null;
  // Paliers n.d. de la cascade, groupés par raison (la raison est écrite sous le tableau, jamais seulement au survol).
  const ndSteps = cv && cv.kind === "value" ? cv.steps.filter((s) => s.nd !== null) : [];
  const ndByReason = [...new Set(ndSteps.map((s) => s.nd as string))].map((reason) => ({ reason, labels: ndSteps.filter((s) => s.nd === reason).map((s) => STEP_LABELS[s.id]) }));

  return (
    <MoneyText><>
      <MsHeader title={ITEM.label} />
      <MsTabs slug={slug} current="analyse" />
      <section className="panel" data-testid="analyse">
        <div className="panel-head">
          <PanelTitle title="Analyse des écarts" slug={slug} term={ECART_TERMS.analyse} label="Analyse des écarts" />
          {a && b && (
            <LiveViewSwitch
              initialRub={rub}
              testid="analyse-affichage"
              label="Affichage des résultats"
              current={aff}
              options={[{ key: "tout", label: "Afficher tout", href: affHref("tout") }, { key: "graphique", label: "Graphique", href: affHref("graphique") }, { key: "tableau", label: "Tableau", href: affHref("tableau") }]}
            />
          )}
        </div>
        {loaded.ctx.unavailable && <p className="notice">Journal de paie PayFit indisponible : {loaded.ctx.unavailable}. Les versions réelles sont n.d.</p>}
        {loaded.notices.map((n) => <p key={n} className="notice">{n}</p>)}
        <PickerForm path={base} loaded={loaded} columns={2} hidden={hidden} slug={slug} />
        {!a || !b ? <p className="desc" data-testid="analyse-empty">Choisissez deux versions à comparer.</p> : (
          <>
            <p className="desc" data-testid="analyse-vers-ecart"><a href={ecartHref}>Écart par rubrique</a></p>
            <ConfidentialiteLine slug={slug} setting={setting} testid="analyse-confidentialite" />
          </>
        )}
      </section>

      {showGraph && items && (
        <section className="panel" data-testid="analyse-graph" id="graphique">
          <div className="panel-head">
            <PanelTitle title="Cascade de l'écart" slug={slug} term={ECART_TERMS.cascades} label="Lecture d'une cascade" />
          </div>
          <AnalyseChart initial={rub} options={RUBRIC_OPTIONS} items={items} axisHelp={axisHelp} />
          {paramNd && <p className="nd" data-testid="analyse-graph-param"><a href={paramHref}>Définir le seuil de confidentialité (Paramètres)</a></p>}
        </section>
      )}

      {showTables && a && b && cascade && cv && (
        <section className="panel" data-testid="analyse-etp" id="tableau">
          <div className="panel-head">
            <PanelTitle title="Cascade d'ETP" slug={slug} term={ECART_TERMS.cascade} label="Cascade d'ETP" />
          </div>
          {cv.kind === "nd" ? (
            <p className="nd" data-testid="analyse-etp-nd">n.d. — {blockNd(cv)}</p>
          ) : (
            <>
              <div className="table-wrap scroll">
                <table className="data-table sticky sticky-first ecart-table analyse-table stack-sm" data-testid="analyse-etp-table" {...TBL.table}>
                  <caption className="ecart-sr">Cascade des ETP de {s0} à {s1}, {period}, {scope} : départ, contributions, écart total, arrivée</caption>
                  <thead {...TBL.group}><tr {...TBL.row}><th scope="col" {...TBL.head}>Rubrique</th><th scope="col" className="num" {...TBL.head}>ETP (valeur ou écart)</th><th scope="col" className="num" {...TBL.head}>Poids des écarts{help(ECART_TERMS.poids, "Poids des écarts")}</th><th scope="col" className="num" {...TBL.head}>Écart (%){help(ECART_TERMS.ecartPourcentage, "Écart en pourcentage")}</th></tr></thead>
                  <tbody {...TBL.group}>
                    <tr data-step="start" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>ETP {s0}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{etp(cv.start)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    {cv.steps.map((s) => (
                      <tr key={s.id} data-step={s.id} className="child" {...TBL.row}>
                        <th scope="row" {...TBL.rowhead}>{STEP_LABELS[s.id]}{help(STEP_TERMS[s.id], STEP_LABELS[s.id])}</th>
                        <td className="num" data-col="valeur" data-sign={s.nd === null ? signOf(s.etp4) : undefined} data-label="Écart" {...TBL.cell}>{s.nd === null ? sg(s.etp4, etp) : <abbr className="nd" title={s.nd}>n.d.</abbr>}</td>
                        <td className="num" data-label="Poids des écarts" {...TBL.cell}><Weight n={s.nd === null ? s.etp4 : null} total={cv.end - cv.start} reason={s.nd} /></td>
                        <td className="num" data-label="Écart (%)" {...TBL.cell}>—</td>
                      </tr>
                    ))}
                    <tr data-step="residual" className="child" {...TBL.row}><th scope="row" {...TBL.rowhead}>Résiduel d'arrondi{help(ECART_TERMS.residuel, "Résiduel d'une cascade")}</th><td className="num" data-col="valeur" data-label="Écart" {...TBL.cell}>{sg(cv.residual, etp)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    <tr data-step="total" className="subtotal" {...TBL.row}><th scope="row" {...TBL.rowhead}>Écart total{help(ECART_TERMS.ecart, "Écart")}</th><td className="num" data-col="valeur" data-sign={signOf(cv.end - cv.start)} data-label="Écart" {...TBL.cell}>{sg(cv.end - cv.start, etp)}</td><td {...TBL.cell} /><td className="num" data-col="pct" data-sign={etpPct ? pctSign(etpPct) : undefined} data-label="Écart (%)" {...TBL.cell}>{etpPct ? <GapPct d={etpPct} /> : "—"}</td></tr>
                    <tr data-step="end" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>ETP {s1}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{etp(cv.end)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                  </tbody>
                </table>
              </div>
              {ndByReason.length > 0 && (
                <p className="nd" data-testid="analyse-etp-nd-list">
                  Paliers n.d. ({ndSteps.length}) : {ndByReason.map((r, i) => <span key={r.reason}>{i > 0 ? " ; " : ""}{r.labels.join(", ")} — {ndText({ reason: r.reason, param: cv.param })}</span>)}
                </p>
              )}
              {canZoom ? (
                <details data-testid="analyse-etp-who">
                  <summary>Salariés derrière chaque contribution</summary>
                  <ul className="list">
                    {cv.steps.filter((s) => s.people.length).map((s) => <li key={s.id} className="desc"><strong>{STEP_LABELS[s.id]}</strong> : {s.people.slice(0, 30).map((p) => `${nameOf(p.key)} ${sg(p.etp4, etp)}`).join(" · ")}{s.people.length > 30 ? ` · … (${s.people.length - 30} autres)` : ""}</li>)}
                  </ul>
                </details>
              ) : <p className="tile-foot">Le détail nominatif est réservé aux administrateurs et aux éditeurs.</p>}
            </>
          )}
        </section>
      )}

      {showTables && a && b && masse && (
        <section className="panel" data-testid="analyse-masse">
          <div className="panel-head">
            <PanelTitle title="Masse salariale chargée" slug={slug} term={ECART_TERMS.contributions} label="Contributions de la masse salariale" />
          </div>
          {!masseOk ? (
            <p className="nd" data-testid="analyse-masse-nd">n.d. — {masseNd ? blockNd(masseNd) : ""}</p>
          ) : (
            <>
              <TrendLegend slug={slug} />
              <div className="table-wrap scroll">
                <table className="data-table sticky sticky-first ecart-table analyse-table stack-sm" data-testid="analyse-masse-table" {...TBL.table}>
                  <caption className="ecart-sr">Contribution de chaque rubrique à l'écart de masse salariale chargée de {s0} à {s1}, {period}, {scope}</caption>
                  <thead {...TBL.group}><tr {...TBL.row}><th scope="col" {...TBL.head}>Rubrique</th><th scope="col" className="num" {...TBL.head}>Montant (valeur ou écart)</th><th scope="col" className="num" {...TBL.head}>Poids des écarts{help(ECART_TERMS.poids, "Poids des écarts")}</th><th scope="col" className="num" {...TBL.head}>Écart (%){help(ECART_TERMS.ecartPourcentage, "Écart en pourcentage")}</th></tr></thead>
                  <tbody {...TBL.group}>
                    <tr data-step="start" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>{s0}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{eur(masseOk.start)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    {masseOk.steps.map((s) => {
                      const pct = pctOf(s.key as RowKey);
                      return (
                        <tr key={s.key} data-step={s.key} className="child" {...TBL.row}>
                          <th scope="row" {...TBL.rowhead}>{s.label}</th>
                          <td className={toneClass("num", s.delta === null ? "flat" : costTone(s.delta))} data-col="valeur" data-sign={s.delta === null ? undefined : signOf(s.delta)} data-label="Écart" {...TBL.cell}>{s.delta === null ? <abbr className="nd" title={s.reason ?? undefined}>n.d.</abbr> : sg(s.delta, eur)}</td>
                          <td className="num" data-label="Poids des écarts" {...TBL.cell}><Weight n={s.delta} total={masseOk.end - masseOk.start} reason={s.reason} /></td>
                          <td className={toneClass("num", pct ? gapTone(s.key as RowKey, pct, "pct") : "flat")} data-sign={pct ? pctSign(pct) : undefined} data-label="Écart (%)" {...TBL.cell}>{pct ? <GapPct d={pct} /> : "—"}</td>
                        </tr>
                      );
                    })}
                    <tr data-step="residual" className="child" {...TBL.row}><th scope="row" {...TBL.rowhead}>{masseOk.steps.some((s) => s.delta === null) ? "Résiduel (rubriques n.d.)" : "Résiduel"}{help(ECART_TERMS.residuel, "Résiduel d'une cascade")}</th><td className={toneClass("num", costTone(masseOk.residual ?? 0))} data-col="valeur" data-label="Écart" {...TBL.cell}>{sg(masseOk.residual ?? 0, eur)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                    <tr data-step="total" className="subtotal" {...TBL.row}><th scope="row" {...TBL.rowhead}>Écart total{help(ECART_TERMS.ecart, "Écart")}</th><td className={toneClass("num", costTone(masseOk.end - masseOk.start))} data-col="valeur" data-sign={signOf(masseOk.end - masseOk.start)} data-label="Écart" {...TBL.cell}>{sg(masseOk.end - masseOk.start, eur)}</td><td {...TBL.cell} /><td className={toneClass("num", massePct ? gapTone("masse", massePct, "pct") : "flat")} data-col="pct" data-sign={massePct ? pctSign(massePct) : undefined} data-label="Écart (%)" {...TBL.cell}>{massePct ? <GapPct d={massePct} /> : "—"}</td></tr>
                    <tr data-step="end" className="total" {...TBL.row}><th scope="row" {...TBL.rowhead}>{s1}</th><td className="num" data-col="valeur" data-label="Valeur" {...TBL.cell}>{eur(masseOk.end)}</td><td {...TBL.cell} /><td {...TBL.cell} /></tr>
                  </tbody>
                </table>
              </div>
              {masseOk.steps.some((s) => s.delta === null) && (
                <details data-testid="analyse-masse-nd-list">
                  <summary>Rubriques n.d. ({masseOk.steps.filter((s) => s.delta === null).length})</summary>
                  <ul className="list">{masseOk.steps.filter((s) => s.delta === null).map((s) => <li key={s.key} className="desc">{s.label} : {s.reason ?? "valeur absente"}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </section>
      )}

      {a && b && pont && (
        <section className="panel" data-testid="analyse-pont">
          <div className="panel-head">
            <PanelTitle title="Pont volume / coût moyen" slug={slug} term={ECART_TERMS.pont} label="Pont volume / coût moyen" />
          </div>
          {!pontOk ? (
            <p className="nd" data-testid="analyse-pont-nd">n.d. — {pontNd ? blockNd(pontNd) : ""}</p>
          ) : (
            <>
              {aff !== "graphique" && !legendInMasse && <TrendLegend slug={slug} />}
              <div className="pont">
                {aff !== "graphique" && (
                  <dl className="pont-tiles">
                    <div data-testid="pont-delta"><dt>Écart de masse salariale</dt><dd className={trendClass(costTone(pontOk.delta))} data-sign={signOf(pontOk.delta)}>{sg(pontOk.delta, eur)}</dd></div>
                    <div data-testid="pont-volume"><dt>Effet volume</dt><dd className={trendClass(costTone(pontOk.volume))} data-sign={signOf(pontOk.volume)}>{sg(pontOk.volume, eur)}</dd></div>
                    <div data-testid="pont-cout"><dt>Effet coût moyen</dt><dd className={trendClass(costTone(pontOk.averageCost))} data-sign={signOf(pontOk.averageCost)}>{sg(pontOk.averageCost, eur)}</dd></div>
                  </dl>
                )}
                {aff !== "tableau" && wfPont && wfPont.kind === "value" && (
                  <div className="pont-chart">
                    <TitledWaterfall
                      testid="wf-pont"
                      label={`Pont de la masse salariale chargée de ${s0} à ${s1}, ${period}, ${scope} : effet volume et effet coût moyen`}
                      title={`Masse salariale chargée — de ${s0} à ${s1}`}
                      startLabel={s0}
                      endLabel={s1}
                      start={wfPont.start}
                      end={wfPont.end}
                      steps={wfPont.steps}
                      unit={wfPont.unit}
                      trend="cost"
                      axisHelp={axisHelp}
                    />
                  </div>
                )}
              </div>
              <p className="tile-foot">Effet de structure (mix) non isolé : compris dans l'effet coût moyen.</p>
            </>
          )}
        </section>
      )}
    </></MoneyText>
  );
}
