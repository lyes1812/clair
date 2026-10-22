import { isMonth } from "@/lib/connectors/months";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { PAYROLL_DEFINITIONS } from "@/lib/payroll/definitions";
import { dsnBrutWindow } from "@/lib/payroll/dsn";
import { costPerEtp, evolution, monthPayroll, servicesOf, shiftYear, windowPayroll, withService, type CostPerEtp, type Evolution, type JournalInput, type MonthPayroll, type PayrollWindow } from "@/lib/payroll/engine";
import { gridRubrics } from "@/lib/payroll/grid";
import { loadPayrollContext } from "@/lib/payroll/context";
import { fmtEtp4, fmtPercent } from "@/lib/rh/kpi/format";
import { STUDIO_RH_ITEMS } from "@/lib/nav";
import { Composition, eurosOf, monthShort, TrendChart } from "./components";
import { DsnView } from "./DsnView";
import { FixeVariableView, PaieComptaView } from "./Lot2Views";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ITEM = STUDIO_RH_ITEMS.find((i) => i.path === "studio-rh/masse-salariale")!;
const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const money = (w: PayrollWindow, pick: (x: Extract<PayrollWindow, { kind: "value" }>) => number) => (w.kind === "nd" ? `n.d. — ${w.nd.reason}` : formatEuros(pick(w)));
const evoText = (e: Evolution) => (e.kind === "nd" ? `n.d. — ${e.nd.reason}` : e.ratio === null ? "n.d. — N-1 nul : % non défini" : `${e.ratio.num > 0 ? "+" : ""}${fmtPercent(e.ratio)}`);
const evoEuros = (e: Evolution) => (e.kind === "nd" ? "" : `${e.deltaCents > 0 ? "+" : ""}${formatEuros(e.deltaCents)}`);
const costText = (c: CostPerEtp) => (c.kind === "nd" ? `n.d. — ${c.nd.reason}` : eurosOf(c.costCents));
const cell = (r: MonthPayroll, pick: (x: Extract<MonthPayroll, { kind: "value" }>) => number) => (r.kind === "nd" ? "n.d." : formatEuros(pick(r)));

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <span className="label">Studio RH</span>
        <h1>{ITEM.label}</h1>
        <p className="desc">{ITEM.summary}</p>
      </div>
      {children}
    </>
  );
}

export default async function MasseSalarialePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadPayrollContext(slug);
  const base = `/e/${slug}/studio-rh/masse-salariale`;
  if (ctx.source === "dsn") {
    return (
      <Header>
        <DsnView slug={slug} dsn={ctx.dsn} sp={{ annee: one(sp.annee), de: one(sp.de), a: one(sp.a) }} />
      </Header>
    );
  }
  const gridOrigin = ctx.grid.origin === "default" ? "valeur par défaut validée le 22/10/2026" : `modifiée le ${ctx.grid.updatedAt ? dateTimeFmt.format(ctx.grid.updatedAt) : "n.d."}`;
  const sourceLine = ctx.read ? (
    <p className="desc" data-testid="ms-source">
      Source : journal comptable de paie PayFit — lecture du {dateTimeFmt.format(ctx.read.startedAt)} · mois lus {ctx.read.months[0] ?? "n.d."} → {ctx.read.months.at(-1) ?? "n.d."} · grille de comptes : {gridOrigin} (
      <a href={`/e/${slug}/parametres#masse-salariale`}>Paramètres</a>)
    </p>
  ) : null;
  const fullInput = ctx.input;
  if (!fullInput) {
    return (
      <Header>
        {sourceLine}
        <section className="placeholder" data-testid="ms-nd">
          <h3>n.d. — {ctx.unavailable}</h3>
          <p className="muted">La masse salariale réelle suit la source RH retenue : journal comptable de paie PayFit (API) ou DSN déposées. <a href={`/e/${slug}/donnees`}>Données</a></p>
        </section>
      </Header>
    );
  }

  const valueMonths = fullInput.months.filter((m) => monthPayroll(fullInput, m).kind === "value");
  const closed = valueMonths.filter((m) => !fullInput.openMonths.includes(m));
  const last = closed.at(-1) ?? valueMonths.at(-1) ?? null;
  if (!last) {
    return (
      <Header>
        {sourceLine}
        <section className="placeholder" data-testid="ms-nd">
          <h3>n.d. — aucun mois de journal de paie dans la lecture appliquée</h3>
        </section>
      </Header>
    );
  }

  // Période : année, premier et dernier mois (paramètres GET ; une valeur invalide est remplacée et signalée).
  const notices: string[] = [];
  const ignore = (k: string, v: string, why: string) => notices.push(`paramètre ignoré : ${k}=${v} (${why})`);
  // Service (code analytique de l'axe choisi) : « __nv__ » = lignes sans code de l'axe (non ventilé).
  const NV = "__nv__";
  // Onglets de l'écran (sous-vues de Masse salariale, pas des entrées de menu).
  const VUES = { synthese: "Synthèse", "fixe-variable": "Fixe & variable", "paie-compta": "Paie & comptabilité" } as const;
  const rawVue = one(sp.vue);
  const vue: keyof typeof VUES = rawVue in VUES ? (rawVue as keyof typeof VUES) : "synthese";
  if (rawVue && !(rawVue in VUES)) ignore("vue", rawVue, "vues : synthese, fixe-variable, paie-compta");
  const rawService = one(sp.service);
  const knownServices = ctx.service.axis ? servicesOf(fullInput, fullInput.months) : [];
  const serviceValue: string | null | undefined = !rawService ? undefined : rawService === NV && knownServices.includes(null) ? null : knownServices.includes(rawService) ? rawService : undefined;
  if (rawService && serviceValue === undefined) ignore("service", rawService, ctx.service.axis ? "service absent du journal" : "aucun axe analytique choisi");
  const input: JournalInput = serviceValue === undefined ? fullInput : withService(fullInput, serviceValue);
  const serviceLabel = (v: string | null) => (v === null ? "Non ventilé" : v);
  const years = [...new Set(input.months.map((m) => Number(m.slice(0, 4))))].sort();
  const rawYear = one(sp.annee);
  const yearOk = years.map(String).includes(rawYear);
  const year = yearOk ? Number(rawYear) : Number(last.slice(0, 4));
  if (rawYear && !yearOk) ignore("annee", rawYear, `années lues : ${years.join(", ")}`);
  const lastOfYear = year === Number(last.slice(0, 4)) ? last.slice(5, 7) : (input.months.filter((m) => m.startsWith(`${year}-`)).at(-1)?.slice(5, 7) ?? "12");
  const rawFrom = one(sp.de);
  const rawTo = one(sp.a);
  let from = MM.includes(rawFrom) ? rawFrom : "01";
  let to = MM.includes(rawTo) ? rawTo : lastOfYear;
  if (rawFrom && from !== rawFrom) ignore("de", rawFrom, "mois 01 à 12 attendu");
  if (rawTo && to !== rawTo) ignore("a", rawTo, "mois 01 à 12 attendu");
  if (from > to) {
    ignore("de", from, "après le dernier mois");
    from = "01";
    to = to < from ? lastOfYear : to;
  }
  const months = MM.filter((m) => m >= from && m <= to).map((m) => `${year}-${m}`);
  const prevMonths = months.map((m) => shiftYear(m, -1));
  const label = (ms: string[]) => (ms.length === 1 ? formatMonth(ms[0]) : `${MONTH_NAMES[Number(ms[0].slice(5)) - 1]} → ${MONTH_NAMES[Number(ms.at(-1)!.slice(5)) - 1]} ${ms[0].slice(0, 4)}`);

  const cur = windowPayroll(input, months);
  const prev = windowPayroll(input, prevMonths);
  const evo = evolution(cur, prev, (w) => w.masse);
  const svcFilter = serviceValue === undefined ? undefined : { value: serviceValue };
  const etpCur = ctx.etp(months, svcFilter);
  const etpPrev = ctx.etp(prevMonths, svcFilter);
  const cost = costPerEtp(cur, etpCur);
  const costPrev = costPerEtp(prev, etpPrev);
  const rate = (w: PayrollWindow) => (w.kind === "nd" || w.brut === 0 ? "n.d." : fmtPercent({ num: w.cotisations, den: w.brut }));
  const rawDetail = one(sp.mois);
  const detailMonth = isMonth(rawDetail) && (months.includes(rawDetail) || prevMonths.includes(rawDetail)) ? rawDetail : null;
  if (rawDetail && !detailMonth) ignore("mois", rawDetail, "hors de la période affichée et de son N-1");
  const detail = detailMonth ? monthPayroll(input, detailMonth) : null;
  const unclassified = new Map<string, { name: string | null; cents: number }>();
  for (const r of cur.months) if (r.kind === "value") for (const a of r.unclassified) unclassified.set(a.accountId, { name: a.accountName, cents: (unclassified.get(a.accountId)?.cents ?? 0) + a.balanceCents });
  const svcParam = serviceValue === undefined ? "" : `&service=${encodeURIComponent(serviceValue ?? NV)}`;
  const vueParam = vue === "synthese" ? "" : `&vue=${vue}`;
  const q = (y: number, de: string, a: string, extra = "", svc = svcParam, v = vueParam) => `${base}?annee=${y}&de=${de}&a=${a}${svc}${v}${extra}`;
  // Table par service (toujours sur tout le journal) : la somme des services, non ventilé compris, égale le total.
  const serviceRows = ctx.service.axis
    ? servicesOf(fullInput, [...months, ...prevMonths]).map((v) => {
        const si = withService(fullInput, v);
        const c = windowPayroll(si, months);
        const p = windowPayroll(si, prevMonths);
        return { value: v, cur: c, prev: p, evo: evolution(c, p, (w) => w.masse) };
      })
    : [];
  const totalCur = windowPayroll(fullInput, months);
  const masseOf = (w: PayrollWindow) => (w.kind === "value" ? w.masse : -1);
  serviceRows.sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : masseOf(b.cur) - masseOf(a.cur)));
  const presets = [
    { label: "Janv.–mars", de: "01", a: "03" },
    { label: "Janv.–juin", de: "01", a: "06" },
    { label: `Janv.–${monthShort(`${year}-${lastOfYear}`)}`, de: "01", a: lastOfYear },
    { label: `${monthShort(`${year}-${lastOfYear}`)} seul`, de: lastOfYear, a: lastOfYear },
  ].filter((p, i, all) => p.a <= lastOfYear && all.findIndex((x) => x.de === p.de && x.a === p.a) === i);
  // Contrôle DSN : affiché sur le total entreprise seulement (la DSN ne porte pas le code analytique du journal).
  const showDsn = serviceValue === undefined && [...months, ...prevMonths].some((m) => ctx.dsn.has(m));
  const etpSum = (c: CostPerEtp) => (c.kind === "value" ? `${fmtEtp4(c.etpMonths4)} ETP-mois` : "");

  return (
    <Header>
      {sourceLine}
      <p className="notice" data-testid="ms-raw-notice">
        Montants tels que renvoyés par l'API PayFit (journal de paie), soldés débit − crédit. Aucun montant n'est recalculé ni reconstitué.
      </p>
      {notices.map((n) => (
        <p key={n} className="notice" data-testid="ms-param-notice">{n}</p>
      ))}

      <nav className="tabs" aria-label="Vues" data-testid="ms-tabs">
        {(Object.keys(VUES) as (keyof typeof VUES)[]).map((v) => (
          <a key={v} href={q(year, from, to, "", svcParam, v === "synthese" ? "" : `&vue=${v}`)} aria-current={v === vue ? "page" : undefined}>{VUES[v]}</a>
        ))}
      </nav>
      <form method="get" className="filters" data-testid="ms-filters">
        {vue !== "synthese" && <input type="hidden" name="vue" value={vue} />}
        <div className="field-row">
          <label htmlFor="annee">Année</label>
          <select className="select" id="annee" name="annee" defaultValue={String(year)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="de">Premier mois</label>
          <select className="select" id="de" name="de" defaultValue={from}>
            {MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="a">Dernier mois</label>
          <select className="select" id="a" name="a" defaultValue={to}>
            {MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}
          </select>
        </div>
        {ctx.service.axis && (
          <div className="field-row">
            <label htmlFor="service">Service</label>
            <select className="select" id="service" name="service" defaultValue={serviceValue === undefined ? "" : (serviceValue ?? NV)}>
              <option value="">Tous les services</option>
              {knownServices.map((v) => <option key={v ?? NV} value={v ?? NV}>{serviceLabel(v)}</option>)}
            </select>
          </div>
        )}
        <button className="btn" type="submit">Afficher</button>
        <span className="actions" data-testid="ms-presets">
          {presets.map((p) => (
            <a key={p.label} className="btn" href={q(year, p.de, p.a)} aria-current={p.de === from && p.a === to ? "page" : undefined}>{p.label}</a>
          ))}
        </span>
      </form>
      <p className="desc" data-testid="ms-period">
        <strong>{label(months)}</strong> · comparé à {label(prevMonths)} (mêmes mois) · {serviceValue === undefined ? "tous les services" : `service ${serviceLabel(serviceValue)}`}
        {cur.kind === "value" && cur.openMonths.length > 0 && <> · paie non clôturée à la lecture : {cur.openMonths.join(", ")} (montants provisoires)</>}
      </p>

      {vue === "fixe-variable" && <FixeVariableView input={input} months={months} prevMonths={prevMonths} />}
      {vue === "paie-compta" && <PaieComptaView slug={slug} input={input} fullInput={fullInput} months={months} serviceFiltered={serviceValue !== undefined} compta={ctx.compta} />}
      {vue === "synthese" && (
        <>
      <section className="panel">
        <h2>Vue d'ensemble — {label(months)}</h2>
        <dl className="facts">
          <div data-testid="ms-tile-masse">
            <dt>Masse salariale chargée</dt>
            <dd className={cur.kind === "nd" ? "nd" : undefined}>{money(cur, (w) => w.masse)}</dd>
            <span className="tile-foot" data-testid="ms-tile-masse-n1">brut + cotisations patronales · N-1 : {money(prev, (w) => w.masse)}</span>
            <span className="tile-foot"><a href="#def-masse">Définition</a></span>
          </div>
          <div data-testid="ms-tile-evolution">
            <dt>Évolution vs N-1</dt>
            <dd className={evo.kind === "nd" ? "nd" : undefined}>{evoText(evo)}</dd>
            <span className="tile-foot">{evoEuros(evo)}{evo.kind === "value" ? ` · (N − N-1) ÷ N-1 = ${formatEuros(evo.deltaCents)} ÷ ${prev.kind === "value" ? formatEuros(prev.masse) : ""}` : ""}</span>
            <span className="tile-foot"><a href="#def-evolution">Définition</a></span>
          </div>
          <div data-testid="ms-tile-cost-etp">
            <dt>Coût par ETP-mois</dt>
            <dd className={cost.kind === "nd" ? "nd" : undefined}>{costText(cost)}</dd>
            <span className="tile-foot">{etpSum(cost)}{cost.kind === "value" ? " · " : ""}N-1 : {costText(costPrev)}</span>
            {ctx.etpQualifiers.length > 0 && <span className="tile-foot" data-testid="ms-etp-qualifiers">ETP : {ctx.etpQualifiers.join(" ; ")}</span>}
            <span className="tile-foot"><a href="#def-cout-etp">Définition</a></span>
          </div>
          <div data-testid="ms-tile-brut">
            <dt>Brut</dt>
            <dd className={cur.kind === "nd" ? "nd" : undefined}>{money(cur, (w) => w.brut)}</dd>
            <span className="tile-foot">dont primes : {money(cur, (w) => w.byRubric.primes)} · N-1 : {money(prev, (w) => w.brut)}</span>
            <span className="tile-foot"><a href="#def-brut">Définition</a></span>
          </div>
          <div data-testid="ms-tile-cotisations">
            <dt>Cotisations patronales</dt>
            <dd className={cur.kind === "nd" ? "nd" : undefined}>{money(cur, (w) => w.cotisations)}</dd>
            <span className="tile-foot">taux : {rate(cur)} du brut · N-1 : {money(prev, (w) => w.cotisations)} ({rate(prev)})</span>
            <span className="tile-foot"><a href="#def-cotisations">Définition</a></span>
          </div>
        </dl>
        {cur.kind === "value" && <Composition brut={cur.brut} cotisations={cur.cotisations} />}
      </section>

      <section className="panel">
        <h2>Tendance mensuelle <span className="desc">— masse chargée en k€, {year} (noir, valeur au-dessus ; bleu clair = paie provisoire ; hachuré = n.d., raison au survol) et {year - 1} (gris)</span></h2>
        <TrendChart rows={cur.months} previous={prev.months} />
      </section>

      {unclassified.size > 0 && (
        <p className="notice" data-testid="ms-unclassified">
          Comptes de charges de personnel sans rubrique (hors masse chargée) :{" "}
          {[...unclassified.entries()].map(([id, a]) => `${id} ${a.name ?? ""} (${formatEuros(a.cents)})`).join(" · ")} — <a href={`/e/${slug}/parametres#masse-salariale`}>classer dans Paramètres</a>
        </p>
      )}

      <section className="panel" data-testid="ms-services">
        <h2>Services <span className="desc">— coût employeur par service ({ctx.service.axis ? `code analytique « ${ctx.service.axis} » du journal PayFit${ctx.service.origin === "single-axis" ? ", seul axe présent" : ""}` : "aucun axe"}) ; cliquer un service pour filtrer l'écran</span></h2>
        {!ctx.service.axis ? (
          <p className="nd" data-testid="ms-services-nd">
            n.d. — {ctx.service.origin === "setting" ? "ventilation par service désactivée par un administrateur" : ctx.axes.length === 0 ? "aucun code analytique dans le journal PayFit" : `plusieurs axes analytiques (${ctx.axes.join(", ")}) : choisir celui du service`} · <a href={`/e/${slug}/parametres#masse-salariale`}>Paramètres</a>
          </p>
        ) : (
          <div className="table-wrap">
            {ctx.axisMissing && <p className="notice" data-testid="ms-axis-missing">L'axe « {ctx.service.axis} » choisi dans Paramètres n'existe plus dans le journal appliqué : toutes les lignes sont « Non ventilé ».</p>}
            <table className="data-table" data-testid="ms-services-table">
              <thead>
                <tr><th>Service</th><th className="num">Coût {year - 1}</th><th className="num">Coût {year}</th><th className="num">Écart €</th><th className="num">Écart %</th><th className="num">Hors primes {year}</th><th className="num">Primes {year}</th><th className="num">Cotisations {year}</th><th className="num">Coût / personne-mois {year}</th><th className="num">Part du coût</th></tr>
              </thead>
              <tbody>
                {serviceRows.map((r) => {
                  const c = r.cur;
                  return (
                    <tr key={r.value ?? NV} data-service={r.value ?? NV}>
                      <td><a href={q(year, from, to, "", `&service=${encodeURIComponent(r.value ?? NV)}`)}>{serviceLabel(r.value)}</a></td>
                      <td className="num" data-col="n1">{money(r.prev, (w) => w.masse).replace(/^n\.d\..*/, "n.d.")}</td>
                      <td className="num" data-col="n">{money(c, (w) => w.masse).replace(/^n\.d\..*/, "n.d.")}</td>
                      <td className="num" data-col="ecart">{r.evo.kind === "value" ? evoEuros(r.evo) : "n.d."}</td>
                      <td className="num" data-col="ecart-pct">{r.evo.kind === "value" ? evoText(r.evo) : "n.d."}</td>
                      <td className="num" data-col="hors-primes">{c.kind === "value" ? formatEuros(c.brut - c.byRubric.primes) : "n.d."}</td>
                      <td className="num" data-col="primes">{c.kind === "value" ? formatEuros(c.byRubric.primes) : "n.d."}</td>
                      <td className="num" data-col="cotisations">{c.kind === "value" ? formatEuros(c.cotisations) : "n.d."}</td>
                      <td className="num" data-col="cout-pm">{c.kind === "value" && c.paidContractMonths > 0 ? eurosOf({ num: c.masse, den: c.paidContractMonths }) : "n.d."}</td>
                      <td className="num" data-col="part">{c.kind === "value" && totalCur.kind === "value" && totalCur.masse > 0 ? fmtPercent({ num: c.masse, den: totalCur.masse }) : "n.d."}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr data-testid="ms-services-total">
                  <td>Total</td>
                  <td className="num">{money(windowPayroll(fullInput, prevMonths), (w) => w.masse).replace(/^n\.d\..*/, "n.d.")}</td>
                  <td className="num" data-col="n">{money(totalCur, (w) => w.masse).replace(/^n\.d\..*/, "n.d.")}</td>
                  <td colSpan={7} className="tile-foot">Coût = masse chargée (brut + cotisations patronales). Coût / personne-mois = coût ÷ nombre de contrats rémunérés (ligne de brut) chaque mois ; ce n'est pas un coût par ETP.</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Mois par mois <span className="desc">— N-1 = même mois un an plus tôt ; cliquer un mois pour le détail par compte</span></h2>
        <div className="table-wrap">
          <table className="data-table" data-testid="ms-monthly-table">
            <thead>
              <tr>
                <th>Mois</th><th className="num">Brut</th><th className="num">dont primes</th><th className="num">Cotisations</th><th className="num">Masse chargée</th><th className="num">Masse N-1</th><th className="num">Écart</th><th className="num">ETP fin de mois</th><th className="num">Coût / ETP</th>{showDsn && <><th className="num">Brut DSN (001)</th><th className="num">Écart journal − DSN</th></>}
              </tr>
            </thead>
            <tbody>
              {cur.months.map((r, i) => {
                const p = prev.months[i];
                const e = etpCur[i];
                const diff = r.kind === "value" && p.kind === "value" ? r.masse - p.masse : null;
                return (
                  <tr key={r.month} data-month={r.month}>
                    <td><a href={q(year, from, to, `&mois=${r.month}#ms-detail`)}>{formatMonth(r.month)}</a>{r.open && <span className="tile-foot"> · provisoire</span>}</td>
                    <td className="num" data-col="brut">{r.kind === "nd" ? <span className="nd" title={r.nd.reason}>n.d.</span> : formatEuros(r.brut)}</td>
                    <td className="num" data-col="primes">{cell(r, (x) => x.byRubric.primes)}</td>
                    <td className="num" data-col="cotisations">{cell(r, (x) => x.cotisations)}</td>
                    <td className="num" data-col="masse">{cell(r, (x) => x.masse)}</td>
                    <td className="num" data-col="masse-n1"><a href={q(year, from, to, `&mois=${p.month}#ms-detail`)}>{cell(p, (x) => x.masse)}</a></td>
                    <td className="num" data-col="ecart">{diff === null ? "n.d." : `${diff > 0 ? "+" : ""}${formatEuros(diff)}`}</td>
                    <td className="num" data-col="etp">{e.etp4 === null ? <span className="nd" title={e.reason ?? ""}>n.d.</span> : fmtEtp4(e.etp4)}</td>
                    <td className="num" data-col="cout-etp">{r.kind === "value" && e.etp4 ? eurosOf({ num: r.masse * 10000, den: e.etp4 }) : "n.d."}</td>
                    {showDsn && (() => {
                      const d = ctx.dsn.get(r.month);
                      const b = d && d.status !== "blocked" ? d.byType["001"] : undefined;
                      if (!d || b === undefined) return <><td className="num nd" data-col="dsn" title={d?.messages.join(" ; ")}>{!d ? "non déposée" : d.status === "blocked" ? "bloquée" : "type 001 absent"}</td><td className="num">—</td></>;
                      return (
                        <>
                          <td className="num" data-col="dsn" title={d.status !== "complete" ? d.messages.join(" ; ") : undefined}>{formatEuros(b)}{d.status !== "complete" ? " ⚠" : ""}</td>
                          <td className="num" data-col="dsn-ecart">{r.kind === "value" ? `${r.brut - b > 0 ? "+" : ""}${formatEuros(r.brut - b)}` : "n.d."}</td>
                        </>
                      );
                    })()}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr data-testid="ms-monthly-foot">
                <td>Période</td>
                <td className="num">{money(cur, (w) => w.brut).replace(/^n\.d\..*/, "n.d.")}</td>
                <td className="num">{money(cur, (w) => w.byRubric.primes).replace(/^n\.d\..*/, "n.d.")}</td>
                <td className="num">{money(cur, (w) => w.cotisations).replace(/^n\.d\..*/, "n.d.")}</td>
                <td className="num" data-col="masse">{money(cur, (w) => w.masse).replace(/^n\.d\..*/, "n.d.")}</td>
                <td className="num" data-col="masse-n1">{money(prev, (w) => w.masse).replace(/^n\.d\..*/, "n.d.")}</td>
                <td className="num">{evo.kind === "value" ? evoEuros(evo) : "n.d."}</td>
                <td className="num">{etpCur.every((e) => e.etp4 !== null) ? `${fmtEtp4(etpCur.reduce((s, e) => s + (e.etp4 ?? 0), 0))} ETP-mois` : "n.d."}</td>
                <td className="num" data-col="cout-etp">{cost.kind === "value" ? eurosOf(cost.costCents) : "n.d."}</td>
                {showDsn && (() => {
                  const w = dsnBrutWindow(ctx.dsn, months);
                  if (w.kind === "nd") return <><td className="num nd" data-col="dsn" title={w.reason}>n.d.</td><td className="num">—</td></>;
                  const warn = w.incompleteMonths.length ? " ⚠" : "";
                  return <><td className="num" data-col="dsn" title={w.incompleteMonths.length ? `mois incomplets : ${w.incompleteMonths.join(", ")}` : undefined}>{formatEuros(w.brutCents)}{warn}</td><td className="num" data-col="dsn-ecart">{cur.kind === "value" ? `${cur.brut - w.brutCents > 0 ? "+" : ""}${formatEuros(cur.brut - w.brutCents)}` : "n.d."}</td></>;
                })()}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="tile-foot" data-testid="ms-dsn-control">
          {showDsn
            ? "Contrôle DSN : brut déclaré (rémunération S21.G00.51 de type 001, brut non plafonné) des déclarations qui font foi, tous établissements ; ⚠ = mois DSN incomplet ou bloqué. Un écart s'explique ligne par ligne dans le détail du mois."
            : serviceValue !== undefined
              ? "Contrôle DSN : disponible sur le total entreprise (sans filtre Service)."
              : "Contrôle DSN : aucune DSN déposée pour ces mois — déposez-les dans Données › DSN pour comparer le brut du journal au brut déclaré."}{" "}
          <a href={`/e/${slug}/donnees/dsn`}>Données › DSN</a>
        </p>
        {cur.kind === "value" && (
          <p className="tile-foot" data-testid="ms-hors-masse">
            Dans les cotisations : taxes et contributions sur les salaires {formatEuros(cur.byRubric.taxes)} · dans le brut : gratifications de stage {formatEuros(cur.byRubric.stages)} · hors masse chargée : provisions de congés payés {formatEuros(cur.byRubric["provisions-cp"])}, autres charges de personnel {formatEuros(cur.byRubric["autres-charges"])}
          </p>
        )}
      </section>

      {detail && (
        <section className="panel" id="ms-detail" data-testid="ms-detail">
          <h2>Détail par compte — {formatMonth(detail.month)}{detail.open ? " (provisoire)" : ""}{serviceValue !== undefined ? ` · service ${serviceLabel(serviceValue)}` : ""}</h2>
          {detail.kind === "nd" ? (
            <p className="nd">n.d. — {detail.nd.reason}</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table" data-testid="ms-detail-accounts">
                <thead><tr><th>Compte</th><th>Libellé (PayFit)</th><th>Rubrique</th><th className="num">Débit</th><th className="num">Crédit</th><th className="num">Solde</th><th className="num">Lignes</th></tr></thead>
                <tbody>
                  {detail.accounts.map((a) => (
                    <tr key={a.accountId} data-account={a.accountId}>
                      <td>{a.accountId}</td>
                      <td className="wrap">{a.accountName ?? <span className="nd">n.d.</span>}</td>
                      <td>{a.rubric ? `${a.rubric.label}${a.rubric.role === "hors-masse" ? " (hors masse)" : ""}` : <span className="nd">non classé (hors masse)</span>}</td>
                      <td className="num">{formatEuros(a.debitCents)}</td>
                      <td className="num">{formatEuros(a.creditCents)}</td>
                      <td className="num">{formatEuros(a.balanceCents)}</td>
                      <td className="num">{a.lines}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={5}>Brut</td><td className="num" data-testid="ms-detail-brut">{formatEuros(detail.brut)}</td><td /></tr>
                  <tr><td colSpan={5}>Cotisations patronales</td><td className="num" data-testid="ms-detail-cotisations">{formatEuros(detail.cotisations)}</td><td /></tr>
                  <tr><td colSpan={5}><strong>Masse salariale chargée</strong></td><td className="num" data-testid="ms-detail-masse"><strong>{formatEuros(detail.masse)}</strong></td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}

        </>
      )}

      <details className="panel" data-testid="ms-definitions" id="definitions">
        <summary>Définitions, grille de comptes et raisons des « n.d. »</summary>
        <dl className="defs">
          {PAYROLL_DEFINITIONS.map((d) => (
            <div key={d.id} id={`def-${d.id}`}>
              <dt>{d.title}</dt>
              <dd>{d.text}</dd>
            </div>
          ))}
          <div id="def-grille-active">
            <dt>Grille de comptes en vigueur ({gridOrigin})</dt>
            <dd data-testid="ms-grid">
              {gridRubrics(ctx.grid.grid).map((r) => `${r.label} (${r.role === "brut" ? "brut" : r.role === "cotisations" ? "cotisations" : "hors masse"}) : ${r.prefixes.join(", ") || "aucun compte"}`).join(" · ")}
            </dd>
          </div>
        </dl>
      </details>
    </Header>
  );
}
