import { MoneyText } from "@/components/Money";
import "@/styles/synthese.css";
import type { ReactNode } from "react";
import { BarChart, LineChart } from "@/components/charts";
import { GlossaryLink } from "@/components/GlossaryLink";
import { MegaMenu } from "@/components/MegaMenu";
import { SourceBadge } from "@/components/SourceBadge";
import { BudgetError, getScenario, listBudgets, listScenarios } from "@/lib/budget/store";
import { landing, project } from "@/lib/budget/engine";
import { compareLanding, coveringScenario } from "@/lib/budget/landing-compare";
import { budgetSeries, scenarioSeries } from "@/lib/budget/series";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, monthEnd } from "@/lib/dates";
import { menuFamilies } from "@/lib/menu";
import { costPerEtp, evolution, monthPayroll, windowPayroll } from "@/lib/payroll/engine";
import { loadPayrollContext } from "@/lib/payroll/context";
import { headcountAt } from "@/lib/rh/headcount";
import { absenteeism } from "@/lib/rh/kpi/absence";
import { etpAverage } from "@/lib/rh/kpi/average";
import { compareWindows, delta, etpValue, type Valued } from "@/lib/rh/kpi/compare";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import { fmtEtp4 } from "@/lib/rh/kpi/format";
import { closedMonths, countedOpts, lastClosedMonth, monthWindow, rollingWindow } from "@/lib/rh/kpi/period";
import { turnover } from "@/lib/rh/kpi/turnover";
import type { DeltaUnit, EtpMonthEnd, Kind, KpiInput, Ratio, Window } from "@/lib/rh/kpi/types";
import { KPI_KEYS } from "@/lib/rh-kpi-settings";
import { hasAtLeast } from "@/lib/roles";
import { trendClass, type TrendTone } from "@/lib/trend";
import { publicScenario } from "@/lib/viz/croisee-budget";
import { capital, euros, hasData, hasNd, masseSeries, monthLongLabel, monthShortYear, monthsAxis, seriesReasons, sourceReason } from "@/lib/viz/masse";
import {
  averageTile,
  capLines,
  deltaView,
  etpCells,
  etpMonthlySeries,
  etpTile,
  eurosOfFraction,
  evolutionView,
  headcountTile,
  kpiRefusal,
  landingTileView,
  masseCells,
  MM,
  MONTH_NAMES,
  nd,
  ndReasonLines,
  periodLabel,
  presets,
  previousMonths,
  rateTile,
  resolvePeriod,
  reasonView,
  SYNTHESE_TERMS as T,
  windowOf,
  type Cell,
  type TileValue,
} from "@/lib/viz/synthese";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Valeur et comparaison d'un indicateur sur la période et sur les mêmes mois un an plus tôt (N-1), par le moteur des KPI.
// La fenêtre N-1 est construite par le décalage des mêmes mois : un trimestre est comparé au même trimestre.
function compareOver<T extends Valued>(input: KpiInput, cur: Window, prv: Window, fn: (i: KpiInput, w: Window) => T, valueOf: (t: Extract<T, { kind: Kind }>) => Ratio, unit: DeltaUnit) {
  const current = fn(input, cur);
  const previous = fn(input, prv);
  return { current, previous, delta: delta(current, previous, valueOf, unit, prv.label) };
}

type TileData = {
  id: string;
  label: string;
  term: string;
  sub?: string;
  value: TileValue;
  size: "kpi" | "money";
  previous?: TileValue;
  budget?: { label: string; value: TileValue };
  compared?: { label: string; text: string }; // atterrissage des seuls mois comparés au budget
  delta?: { label: string; text: string | null; reason: string | null; tone: TrendTone };
  note?: string; // une ligne : mois exclus de la comparaison, nommés
  href: string;
};

// Tuile : libellé et « ? » du glossaire, valeur en grand, N-1 et écart, lien vers l'écran détaillé. Une valeur n.d. s'écrit « n.d. »
// avec sa raison courte (la raison complète au survol) et un lien vers Données.
function Tile({ t, slug }: { t: TileData; slug: string }) {
  const absent = t.value.kind === "nd";
  // Raisons des n.d. de la tuile, une fois chacune : celle du N-1 ou du budget identique à celle de la valeur n'est pas répétée, et la
  // raison d'un écart n.d. (qui répète celle de ses deux termes) n'est écrite que quand aucun des deux n'est n.d.
  const entries = [
    absent ? { key: "valeur", raw: t.value.reason, text: t.value.reason } : null,
    t.previous?.kind === "nd" ? { key: "n-1", raw: t.previous.reason, text: t.previous.reason ? `N-1 : ${t.previous.reason}` : null } : null,
    t.budget?.value.kind === "nd" ? { key: "budget", raw: t.budget.value.reason, text: t.budget.value.reason ? `${t.budget.label} : ${t.budget.value.reason}` : null } : null,
    t.delta && t.delta.text === null && t.delta.reason && !absent && t.previous?.kind !== "nd" && t.budget?.value.kind !== "nd" ? { key: "ecart", raw: t.delta.reason, text: t.delta.reason } : null,
  ];
  const seen = new Set<string>();
  const reasons: { key: string; text: string }[] = [];
  for (const e of entries) {
    if (!e || !e.text || !e.raw || seen.has(e.raw)) continue;
    seen.add(e.raw);
    reasons.push({ key: e.key, text: e.text });
  }
  return (
    <MoneyText><li className={`sy-tile ${t.size}`} data-testid={`sy-tile-${t.id}`}>
      <h3 className="sy-tile-label">
        {t.label}
        <GlossaryLink slug={slug} term={t.term} label={t.label} />
      </h3>
      {t.sub && <p className="sy-tile-sub">{t.sub}</p>}
      <p className={`sy-tile-value${absent ? " nd" : t.value.kind === "lower" ? " lower" : ""}`} data-testid={`sy-tile-${t.id}-value`}>{t.value.text}</p>
      {(t.previous || t.budget || t.delta) && (
        <div className="sy-tile-compare">
          {t.previous && <span className="tile-foot" data-testid={`sy-tile-${t.id}-n1`}>N-1 : {t.previous.text}</span>}
          {t.budget && <span className="tile-foot" data-testid={`sy-tile-${t.id}-budget`}>{t.budget.label} : {t.budget.value.text}<GlossaryLink slug={slug} term={T.budget} label="Budget saisi" /></span>}
          {t.compared && <span className="tile-foot" data-testid={`sy-tile-${t.id}-compared`}>{t.compared.label} : {t.compared.text}</span>}
          {t.delta && (
            <span className="tile-foot" data-testid={`sy-tile-${t.id}-delta`}>
              {t.delta.label} : {t.delta.text === null ? "n.d." : <span className={`sy-delta ${trendClass(t.delta.tone)}`.trim()}>{t.delta.text}</span>}
            </span>
          )}
        </div>
      )}
      {reasons.map((r) => {
        const { short, full } = reasonView(r.text);
        return full === null ? (
          <p key={r.key} className="tile-foot sy-reason" data-testid={`sy-tile-${t.id}-nd-${r.key}`}>{short}</p>
        ) : (
          <details key={r.key} className="tile-foot sy-reason" data-testid={`sy-tile-${t.id}-nd-${r.key}`}>
            <summary>{short}</summary>
            <p>{full}</p>
          </details>
        );
      })}
      {t.note && <p className="tile-foot" data-testid={`sy-tile-${t.id}-note`}>{t.note}</p>}
      <p className="tile-foot sy-tile-links">
        {absent && <a href={`/e/${slug}/donnees`} aria-label={`Données : ${t.label}`}>Données</a>}
        <a href={t.href} aria-label={`Détail : ${t.label}`}>Détail</a>
      </p>
    </li></MoneyText>
  );
}

// Bloc « n.d. » : titre, raison une fois, lien pour y remédier.
function NdState({ testid, heading, reason, action }: { testid: string; heading?: string; reason: string; action?: { href: string; label: string } }) {
  return (
    <div className="sy-nd-state" data-testid={testid}>
      {heading && <h3 className="sy-sub">{heading}</h3>}
      <p className="sy-nd-title">n.d.</p>
      <p className="sy-nd-reason">{reason}</p>
      {action && <a className="sy-nd-action" href={action.href}>{action.label}<span aria-hidden="true"> →</span></a>}
    </div>
  );
}

// Raisons des n.d. d'un graphique : les trois premières, puis les autres repliées sous « … et N autres » (aucune raison n'est retirée :
// elles se lisent au clavier comme à la souris, et dans le tableau exact).
function NdLines({ lines, testid }: { lines: string[]; testid: string }) {
  const { shown, more } = capLines(lines, 3);
  if (shown.length === 0) return null;
  return (
    <div className="tile-foot sy-nd-lines" data-testid={testid}>
      <strong className="nd">n.d.</strong>
      <ul>
        {shown.map((l) => <li key={l}>{l}</li>)}
        {more > 0 && (
          <li>
            <details className="sy-more">
              <summary>… et {more} autre{more > 1 ? "s" : ""}</summary>
              <ul>{lines.slice(shown.length).map((l) => <li key={l}>{l}</li>)}</ul>
            </details>
          </li>
        )}
      </ul>
    </div>
  );
}

// Tableau exact d'un graphique, replié : mêmes valeurs que le graphique, n.d. avec sa raison au survol.
function ExactTable({ testid, caption, months, columns, foot }: { testid: string; caption: string; months: string[]; columns: { name: string; cells: Cell[] }[]; foot?: { label: string; cells: Cell[] } }) {
  const cell = (c: Cell | undefined, key: string) =>
    c === undefined || c.kind === "nd" ? <td key={key} className="num"><span className="nd" title={c?.reason ?? undefined}>n.d.</span></td> : <td key={key} className={c.kind === "lower" ? "num lower" : "num"}>{c.text}</td>;
  return (
    <MoneyText><details className="sy-exact" data-testid={testid}>
      <summary>Tableau exact<span className="sy-sr"> : {caption}</span></summary>
      <div className="table-wrap scroll sy-scroll" role="region" aria-label={caption} tabIndex={0}>
        <table className="data-table sticky sticky-first sy-table">
          <caption className="sy-sr">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              {columns.map((c) => <th key={c.name} scope="col" className="num">{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m} data-month={m}>
                <th scope="row">{monthLongLabel(m)}</th>
                {columns.map((c) => cell(c.cells[i], c.name))}
              </tr>
            ))}
          </tbody>
          {foot && (
            <tfoot>
              <tr className="total">
                <th scope="row">{foot.label}</th>
                {foot.cells.map((c, i) => cell(c, `${foot.label}-${i}`))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </details></MoneyText>
  );
}

function Panel({ testid, title, link, children }: { testid: string; title: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <MoneyText><section className="panel" data-testid={testid} aria-labelledby={`${testid}-titre`}>
      <div className="panel-head">
        <h2 id={`${testid}-titre`}>{title}</h2>
        {link && <div className="panel-tools"><a className="sy-panel-link" href={link.href}>{link.label}<span aria-hidden="true"> ›</span></a></div>}
      </div>
      {children}
    </section></MoneyText>
  );
}

export default async function SynthesePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadPayrollContext(slug);
  const kpi = ctx.kpi;
  const ws = kpi.collab.workspace;
  // Lecture seule : cette page ne porte aucune action de modification ; le rôle ne change que le libellé du lien vers Données.
  const canEdit = hasAtLeast(ws.role, "editor");
  const studio = `/e/${slug}/studio-rh`;
  const donnees = `/e/${slug}/donnees`;
  const dataAction = { href: donnees, label: canEdit ? "Choisir ou lire une source dans Données" : "Données" };

  // --- Pourquoi les indicateurs RH et la masse chargée seraient n.d.
  const rhRefusal = kpiRefusal({
    chosen: Boolean(kpi.collab.source.chosen),
    sourceReason: kpi.collab.source.reason,
    unavailable: kpi.collab.state?.kind === "unavailable" ? kpi.collab.state.reason : null,
    hasInput: Boolean(kpi.input),
    invalid: kpi.settings.invalid.map((k) => KPI_KEYS[k]),
  });
  const rhAction = kpi.settings.invalid.length > 0 ? { href: `/e/${slug}/parametres#kpi`, label: "Paramètres › Définitions des KPI" } : dataAction;
  const payrollWhy = ctx.input
    ? null
    : ctx.unavailable
      ? sourceReason(ctx.unavailable)
      : ctx.source === "dsn"
        ? "source RH retenue : DSN — journal de paie PayFit non lu (brut déclaré dans Masse salariale)"
        : "journal de paie indisponible";

  const input = rhRefusal === null ? kpi.input : null;
  const journal = ctx.input;
  const lastClosed = kpi.input ? lastClosedMonth(kpi.input.data, kpi.input.openMonths ?? []) : null;

  const head = (
    <div className="sy-head" data-testid="sy-head">
      <div className="sy-head-main">
        <span className="label">Studio RH</span>
        <h1>Synthèse du Studio RH</h1>
        <div className="sy-read">
          <SourceBadge resolution={kpi.collab.source} slug={slug} />
          {kpi.collab.data && (
            <p className="desc" data-testid="sy-closed-month">
              Dernier mois clos : {lastClosed ? <strong>{lastClosed}</strong> : <span className="nd">n.d. — aucun mois clos à la date de référence</span>}
              <GlossaryLink slug={slug} term={T.periode} />
            </p>
          )}
        </div>
      </div>
      <MegaMenu
        variant="page"
        label="Fonctionnalités"
        families={menuFamilies(slug)}
        extras={[
          { label: "Données", href: donnees },
          { label: "Paramètres", href: `/e/${slug}/parametres` },
          { label: "Membres et accès", href: `/e/${slug}/membres` },
          { label: "Glossaire", href: `/e/${slug}/glossaire` },
        ]}
      />
    </div>
  );
  const switchNotice = kpi.collab.switchedAt ? (
    <p className="notice" data-testid="source-switch-notice">
      Source RH changée le {dateTimeFmt.format(kpi.collab.switchedAt)} par un administrateur ({kpi.collab.source.reason}) : aucune comparaison entre PayFit et DSN.
    </p>
  ) : null;

  // --- Période : mois clos du référentiel RH ou du journal de paie
  const rhClosed = kpi.input ? closedMonths(kpi.input.data, kpi.input.openMonths ?? []) : [];
  const payrollClosed = journal ? journal.months.filter((m) => !journal.openMonths.includes(m) && monthPayroll(journal, m).kind === "value") : [];
  const period = resolvePeriod([...rhClosed, ...payrollClosed], { annee: one(sp.annee), de: one(sp.de), a: one(sp.a) });
  if (!period) {
    return (
      <MoneyText><>
        {head}
        {switchNotice}
        <NdState
          testid="sy-nd"
          heading="Synthèse du Studio RH"
          reason={capital(rhRefusal ?? payrollWhy ?? "aucun mois clos à la date de référence")}
          action={rhRefusal !== null && kpi.settings.invalid.length > 0 ? rhAction : dataAction}
        />
      </></MoneyText>
    );
  }

  const { year, from, to, months } = period;
  const prevMonths = previousMonths(months);
  const prevYear = Number(prevMonths[0].slice(0, 4));
  const label = periodLabel(months);
  const prevLabel = periodLabel(prevMonths);
  const toMonth = months[months.length - 1];
  const prevTo = prevMonths[prevMonths.length - 1];
  const q = `annee=${year}&de=${from}&a=${to}`;
  // KPI RH : douze mois glissants qui finissent avec la période (la fenêtre du turnover de la tuile ; une année civile non close y serait n.d.).
  const kpiHref = `${studio}/kpi?mode=glissant&fin=${toMonth}`;
  const msHref = `${studio}/masse-salariale?${q}`;

  // --- Indicateurs RH (moteur des KPI : aucun calcul ici)
  const rhTiles: TileData[] = [];
  let etpPoints: { cur: EtpMonthEnd[]; prev: EtpMonthEnd[] } | null = null;
  if (input) {
    const cur = windowOf(months);
    const prv = windowOf(prevMonths);
    const opts = countedOpts(input);
    const hCur = headcountAt(input.data, monthEnd(toMonth), opts);
    const hPrev = headcountAt(input.data, monthEnd(prevTo), opts);
    const etpEnd = compareWindows<EtpMonthEnd>(input, monthWindow(toMonth), (i, w) => etpMonthEnd(i, w.to), etpValue, "etp");
    const etpAvg = compareOver(input, cur, prv, etpAverage, (a) => a.ratio, "etp");
    // Turnover : défini sur 12 mois glissants ou une année civile close (glossaire) : les douze mois qui finissent avec la période.
    const roll = rollingWindow(toMonth);
    const to12 = compareWindows(input, roll, turnover, (t) => t.ratio, "points");
    const abs = compareOver(input, cur, prv, absenteeism, (a) => a.ratio, "points");
    const dEtp = deltaView(etpEnd.delta);
    const dAvg = deltaView(etpAvg.delta);
    const dTo = deltaView(to12.delta);
    const dAbs = deltaView(abs.delta);
    const endLabel = `fin ${monthLongLabel(toMonth).toLowerCase()}`;
    rhTiles.push(
      { id: "effectif", label: "Effectif (personnes)", term: T.effectif, sub: endLabel, value: headcountTile(hCur), previous: headcountTile(hPrev), size: "kpi", href: kpiHref },
      { id: "etp-fin", label: "ETP contractuel", term: T.etpFin, sub: endLabel, value: etpTile(etpEnd.current), previous: etpTile(etpEnd.previous), delta: { label: "Écart", ...dEtp, tone: "flat" }, size: "kpi", href: kpiHref },
      { id: "etp-moyen", label: "ETP moyen", term: T.etpMoyen, sub: label, value: averageTile(etpAvg.current), previous: averageTile(etpAvg.previous), delta: { label: "Écart", ...dAvg, tone: "flat" }, size: "kpi", href: kpiHref },
      { id: "turnover", label: "Turnover", term: T.turnover, sub: `12 mois glissants à fin ${monthLongLabel(toMonth).toLowerCase()}`, value: rateTile(to12.current), previous: rateTile(to12.previous), delta: { label: "Écart", ...dTo, tone: "flat" }, size: "kpi", href: kpiHref },
      { id: "absenteisme", label: "Absentéisme", term: T.absenteisme, sub: label, value: rateTile(abs.current), previous: rateTile(abs.previous), delta: { label: "Écart", ...dAbs, tone: "flat" }, size: "kpi", href: kpiHref },
    );
    etpPoints = { cur: months.map((m) => etpMonthEnd(input, m)), prev: prevMonths.map((m) => etpMonthEnd(input, m)) };
  }
  // Limites de la lecture PayFit qui changent la lecture des ETP (une ligne ; le détail est au glossaire).
  const data = kpi.collab.data;
  const limits: string[] = [];
  if (input && data?.build.source === "payfit") {
    if (kpi.collab.payfitHistory?.mode === "raw") limits.push(kpi.collab.payfitHistory.limit ? "contrats archivés de plus de 12 mois non renvoyés par PayFit" : "historique PayFit tel que renvoyé par l'API");
    limits.push(`quotités à la date de lecture (${formatDate(data.build.referenceDate)})`);
  }

  // --- Masse salariale chargée, coût par ETP-mois (journal de paie et ETP fin de mois du module KPI RH)
  const payTiles: TileData[] = [];
  let pay: { cur: ReturnType<typeof windowPayroll>; prev: ReturnType<typeof windowPayroll> } | null = null;
  if (journal) {
    const cur = windowPayroll(journal, months);
    const prev = windowPayroll(journal, prevMonths);
    pay = { cur, prev };
    const evo = evolution(cur, prev, (w) => w.masse);
    const money = (w: typeof cur): TileValue => (w.kind === "nd" ? nd(w.nd.reason) : { text: euros(w.masse), kind: "value", reason: null });
    const etpCur = ctx.etp(months);
    const etpPrev = ctx.etp(prevMonths);
    const cost = costPerEtp(cur, etpCur);
    const costPrev = costPerEtp(prev, etpPrev);
    const costValue = (c: typeof cost): TileValue => (c.kind === "nd" ? nd(c.nd.reason) : { text: eurosOfFraction(c.costCents), kind: "value", reason: null });
    const ev = evolutionView(evo);
    const open = cur.kind === "value" ? cur.openMonths : [];
    payTiles.push(
      { id: "masse", label: "Masse salariale chargée", term: T.masse, sub: open.length ? `${label} · provisoire : ${open.map(monthShortYear).join(", ")}` : label, value: money(cur), previous: money(prev), delta: { label: "Évolution", ...ev }, size: "money", href: msHref },
      { id: "cout-etp", label: "Coût par ETP-mois", term: T.coutEtp, sub: cost.kind === "value" ? `${fmtEtp4(cost.etpMonths4)} ETP-mois` : label, value: costValue(cost), previous: costValue(costPrev), size: "money", href: msHref },
    );
  }

  // --- Atterrissage de l'année face au budget saisi : la règle de la Masse salariale croisée (landing-compare.ts). Scénario : le plus
  // récemment créé qui couvre l'année de la période (aucun : n.d. avec la raison) ; budget : le plus récemment modifié de l'année ;
  // comparaison sur les seuls mois dotés d'un montant de budget, leur nombre écrit. Store de budget : lecture seule.
  const yearKey = String(year);
  const landingBase = { id: "atterrissage", label: `Atterrissage ${yearKey}`, term: T.atterrissage, size: "money" as const };
  let landingTile: TileData | null = null;
  let landingError: string | null = null;
  const pick = coveringScenario(await listScenarios(ws.id), yearKey);
  if (pick.kind === "nd") landingTile = { ...landingBase, value: nd(pick.reason), href: `${studio}/hypotheses` };
  else {
    const s = pick.row.scenario;
    const sub = `Scénario « ${s.name} » · le plus récent qui couvre ${yearKey} · douze mois`;
    const href = `${studio}/hypotheses?scenario=${s.id}&vue=resultat&sous=comparaison&annee=${yearKey}`;
    try {
      const full = await getScenario(ws.id, s.id);
      if (!full) landingTile = { ...landingBase, sub, value: nd("scénario introuvable"), href };
      else {
        // Raisons n.d. de la projection sans identité (le moteur nomme le contrat : « <libellé> : base n.d. (…) ») : publicScenario,
        // comme la Masse salariale croisée ; montants identiques, le détail nominatif reste dans Hypothèses budgétaires.
        const pub = publicScenario(full.base, project(full.base, s.firstMonth, s.lastMonth, full.hypotheses, s.conventions));
        const land = landing(pub.base, pub.proj, yearKey);
        const chosen = [...(await listBudgets(ws.id))].filter((b) => b.year === yearKey).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
        const budget = chosen
          ? { name: chosen.name, compare: compareLanding(scenarioSeries(s.id, s.name, pub.base, pub.proj), land.kind === "value", { name: chosen.name, series: budgetSeries(`budget-${chosen.id.slice(0, 8)}`, chosen.name, yearKey, chosen.amounts) }, yearKey) }
          : null;
        const v = landingTileView(land, budget, yearKey);
        landingTile = { ...landingBase, sub, value: v.value, budget: v.budget, compared: v.compared ?? undefined, delta: v.gap, note: v.note ?? undefined, href };
      }
    } catch (e) {
      // Base figée altérée : le scénario n'est pas lu, et l'écran le dit.
      if (!(e instanceof BudgetError)) throw e;
      landingError = e.message;
    }
  }

  // --- Graphiques : masse chargée N / N-1 par mois, ETP de fin de mois N / N-1 par mois
  const openAll = pay ? [...pay.cur.months, ...pay.prev.months].filter((r) => r.open).map((r) => r.month) : [];
  const axis = monthsAxis(months, prevMonths, openAll);
  const axisEtp = monthsAxis(months, prevMonths);
  const masseTitle = `Masse chargée par mois, ${year} face à ${prevYear} (N-1)`;
  const masseNames = { cur: `Masse chargée ${year}`, prev: `Masse chargée ${prevYear} (N-1)` };
  const masseS = pay ? masseSeries(pay.cur.months, pay.prev.months, masseNames) : [];
  const etpTitle = `ETP de fin de mois, ${year} face à ${prevYear} (N-1)`;
  const etpNames = { cur: `ETP fin de mois ${year}`, prev: `ETP fin de mois ${prevYear} (N-1)` };
  const etpS = etpPoints ? etpMonthlySeries(etpPoints.cur, etpPoints.prev, etpNames) : [];

  const presetList = presets(period.last).map((p) => ({ ...p, href: `${studio}?annee=${year}&de=${p.de}&a=${p.a}`, current: p.de === from && p.a === to }));
  const anyTrend = [...payTiles, ...(landingTile ? [landingTile] : [])].some((t) => t.delta && t.delta.tone !== "flat");

  return (
    <MoneyText><>
      {head}
      {switchNotice}

      <form method="get" className="filters bar sy-bar" data-testid="sy-filters" aria-label="Période">
        <div className="field-row">
          <label htmlFor="sy-annee">Année</label>
          <select className="select" id="sy-annee" name="annee" defaultValue={String(year)}>
            {period.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="sy-de">Premier mois</label>
          <select className="select" id="sy-de" name="de" defaultValue={from}>
            {MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="sy-a">Dernier mois</label>
          <select className="select" id="sy-a" name="a" defaultValue={to}>
            {MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}
          </select>
        </div>
        <div className="sy-bar-actions">
          <button className="btn primary" type="submit">Afficher</button>
          <a className="btn" href={studio}>Réinitialiser</a>
        </div>
        {presetList.length > 0 && (
          <div className="sy-presets" data-testid="sy-presets" role="group" aria-label="Périodes rapides">
            <span className="sy-presets-label">Périodes rapides</span>
            {presetList.map((p) => <a key={p.label} className="btn small" href={p.href} aria-current={p.current ? "true" : undefined}>{p.label}</a>)}
          </div>
        )}
      </form>
      {period.notices.map((n) => <p key={n} className="notice" data-testid="sy-param-notice">{n}</p>)}

      <div className="sy-toolbar">
        <p className="desc sy-period" data-testid="sy-period">
          <strong>{label}</strong> · N-1 : {prevLabel}
          <GlossaryLink slug={slug} term={T.nMoinsUn} />
        </p>
        {anyTrend && (
          <span className="trend-legend" data-testid="sy-trend-legend">
            <span><i className="dot bad" aria-hidden="true" />Coût en hausse</span>
            <span><i className="dot good" aria-hidden="true" />Coût en baisse</span>
            <GlossaryLink slug={slug} term={T.tendances} />
          </span>
        )}
      </div>

      <Panel testid="sy-rh" title="Effectifs et activité" link={{ href: kpiHref, label: "KPI RH" }}>
        {input ? (
          <>
            <ul className="sy-tiles" data-testid="sy-tiles-rh">{rhTiles.map((t) => <Tile key={t.id} t={t} slug={slug} />)}</ul>
            {limits.length > 0 && (
              <p className="tile-foot sy-limits" data-testid="sy-limits">
                Limites de la lecture : {limits.join(" · ")}
                <GlossaryLink slug={slug} term={T.limites} />
              </p>
            )}
          </>
        ) : (
          <NdState testid="sy-rh-nd" reason={capital(rhRefusal ?? "indicateurs RH indisponibles")} action={rhAction} />
        )}
      </Panel>

      <Panel testid="sy-masse" title="Masse salariale et budget" link={{ href: msHref, label: "Masse salariale" }}>
        {journal || landingTile ? (
          <ul className="sy-tiles" data-testid="sy-tiles-masse">
            {payTiles.map((t) => <Tile key={t.id} t={t} slug={slug} />)}
            {landingTile && <Tile t={landingTile} slug={slug} />}
          </ul>
        ) : null}
        {!journal && <NdState testid="sy-masse-nd" reason={capital(payrollWhy ?? "journal de paie indisponible")} action={dataAction} />}
        {landingError && <p className="error" data-testid="sy-landing-error">Atterrissage non lu : {landingError}</p>}
      </Panel>

      <Panel testid="sy-graphs" title="Graphiques">
        <div className="sy-charts">
          <div className="sy-chart" data-testid="sy-chart-masse-bloc">
            {pay && hasData(masseS) ? (
              <>
                <BarChart testid="sy-chart-masse" label={`Masse salariale chargée par mois, ${year} et ${prevYear}, montants monétaires`} title={masseTitle} categories={axis.categories} categoryTitles={axis.titles} series={masseS} unit="eur" mode="grouped" />
                {hasNd(masseS) && <p className="chart-legend sy-nd-key"><span className="legend-btn static"><i className="swatch hatch" aria-hidden="true" />n.d. (raison au survol)</span><GlossaryLink slug={slug} term={T.hachure} /></p>}
                <NdLines lines={ndReasonLines([months, prevMonths], masseS)} testid="sy-chart-masse-nd" />
                <ExactTable
                  testid="sy-table-masse"
                  caption={`${masseTitle}, montants monétaires`}
                  months={months}
                  columns={[{ name: masseNames.cur, cells: masseCells(pay.cur.months) }, { name: masseNames.prev, cells: masseCells(pay.prev.months) }]}
                  foot={{ label: "Période", cells: [pay.cur, pay.prev].map((w): Cell => (w.kind === "nd" ? nd(w.nd.reason) : { text: euros(w.masse), kind: "value", reason: null })) }}
                />
              </>
            ) : (
              <NdState testid="sy-chart-masse-nd-state" heading={masseTitle} reason={capital(pay ? (seriesReasons(masseS).slice(0, 3).join(" ; ") || "aucune valeur connue sur la période") : (payrollWhy ?? "journal de paie indisponible"))} action={pay ? undefined : dataAction} />
            )}
            <p className="tile-foot sy-chart-link"><a href={`${msHref}&affichage=tableau`}>Masse salariale ›</a><GlossaryLink slug={slug} term={T.tableau} /></p>
          </div>
          <div className="sy-chart" data-testid="sy-chart-etp-bloc">
            {etpPoints && hasData(etpS) ? (
              <>
                <LineChart testid="sy-chart-etp" label={`ETP contractuel de fin de mois, par mois, ${year} et ${prevYear}`} title={etpTitle} categories={axisEtp.categories} categoryTitles={axisEtp.titles} series={etpS} unit="etp" />
                {hasNd(etpS) && <p className="chart-legend sy-nd-key"><span className="legend-btn static"><i className="swatch hatch" aria-hidden="true" />n.d. (raison au survol)</span><GlossaryLink slug={slug} term={T.hachure} /></p>}
                <NdLines lines={ndReasonLines([months, prevMonths], etpS)} testid="sy-chart-etp-nd" />
                <ExactTable
                  testid="sy-table-etp"
                  caption={`${etpTitle}, en ETP`}
                  months={months}
                  columns={[{ name: etpNames.cur, cells: etpCells(etpPoints.cur) }, { name: etpNames.prev, cells: etpCells(etpPoints.prev) }]}
                />
              </>
            ) : (
              <NdState testid="sy-chart-etp-nd-state" heading={etpTitle} reason={capital(etpPoints ? (seriesReasons(etpS).slice(0, 3).join(" ; ") || "aucune valeur connue sur la période") : (rhRefusal ?? "indicateurs RH indisponibles"))} action={etpPoints ? undefined : rhAction} />
            )}
            <p className="tile-foot sy-chart-link"><a href={kpiHref}>KPI RH ›</a><GlossaryLink slug={slug} term={T.tableau} /></p>
          </div>
        </div>
      </Panel>
    </></MoneyText>
  );
}
