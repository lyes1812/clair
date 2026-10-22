import { isMonth } from "@/lib/connectors/months";
import { dateTimeFmt } from "@/lib/connectors/labels";
import { formatDate, monthEnd } from "@/lib/dates";
import { contractNatureLabel } from "@/lib/dsn/labels";
import { KPI_KEYS, kpiOriginText, type KpiSettingKey, type KpiSettings } from "@/lib/rh-kpi-settings";
import { coverageAt, gateAt, monthRanges, natureOfMonth } from "@/lib/rh/headcount";
import { KPI_DETAIL_IDS, kpiDashboard, kpiDetail } from "@/lib/rh/kpi/dashboard";
import { fmtDelta, fmtHalfDays, fmtPercent } from "@/lib/rh/kpi/format";
import { civilWindow, closedMonths, defaultYear, previousWindow, rollingWindow, selectableYears } from "@/lib/rh/kpi/period";
import type { Compared, KpiDetailId, KpiInput, Window } from "@/lib/rh/kpi/types";
import { loadKpiContext } from "@/lib/rh/kpi-context";
import { ABSENCE_STATUS_LABELS } from "@/lib/rh/labels";
import type { RhBuildData } from "@/lib/rh/referential/types";
import type { Shown } from "@/lib/rh/view";
import {
  AbsenceMonthDetail,
  AbsenteeismWindowDetail,
  absenceDaysShown,
  absenteeismShown,
  AverageDetail,
  averageShown,
  Cell,
  EtpEndDetail,
  etpShown,
  etpTitle,
  HeadcountDetail,
  KpiDefinitions,
  KpiHeader,
  KpiTile,
  type Maps,
  monthLabel,
  MovementsDetail,
  natureList,
  NdReasons,
  PayfitNotice,
  ratioTitle,
  show,
  showCount,
  showHeadcount,
  theoreticalShown,
  TurnoverDetail,
  turnoverShown,
} from "./components";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const DETAIL_TITLES: Record<KpiDetailId, string> = {
  "etp-end": "ETP contractuel fin de mois",
  headcount: "Effectif fin de mois (personnes)",
  entries: "Entrées du mois",
  exits: "Sorties du mois",
  theoretical: "Jours théoriques du mois",
  absenteeism: "Absentéisme",
  "etp-avg": "ETP moyen",
  "headcount-avg": "Effectif moyen (personnes)",
  turnover: "Turnover",
};

// Paramètres en vigueur, en clair, avec leur origine (défaut validé, défaut proposé, modification datée).
function paramList(settings: KpiSettings, natures: { codes: string[]; origin: string }) {
  const v = settings.values;
  const yes = (b: boolean) => (b ? "oui" : "non");
  const items: [KpiSettingKey, string, string][] = [
    ["fullTimeIsOne", "Un temps plein vaut 1 ETP", yes(v.fullTimeIsOne)],
    ["capAtOne", "Quotité plafonnée à 1", yes(v.capAtOne)],
    ["etpDecimals", "Décimales de la quotité avant la somme", String(v.etpDecimals)],
    ["turnoverFormula", "Formule du turnover", v.turnoverFormula === "half_sum" ? "((entrées + sorties) ÷ 2) ÷ effectif moyen" : "sorties ÷ effectif au premier jour"],
    ["neutralizeContinuity", "Contrats continus neutralisés", yes(v.neutralizeContinuity)],
    ["excludedExitNatures", "Sorties non comptées (natures)", v.excludedExitNatures.length ? natureList(v.excludedExitNatures) : "aucune"],
    ["absenceTypes", "Types d'absence comptés", v.absenceTypes.length ? v.absenceTypes.join(", ") : "aucun (absentéisme n.d.)"],
    ["absenceStatuses", "Statuts d'absence retenus", v.absenceStatuses.map((s) => ABSENCE_STATUS_LABELS[s] ?? s).join(", ")],
    ["dayBasis", "Base des jours", v.dayBasis === "calendar" ? "jours calendaires" : "du lundi au vendredi"],
  ];
  return [
    { label: "Natures comptées dans l'effectif", value: natureList(natures.codes), origin: natures.origin === "default" ? "valeur par défaut validée" : "modifié par un administrateur", testId: "natures" },
    ...items.map(([k, label, value]) => ({ label, value, origin: kpiOriginText(k, settings.origins[k], (d) => dateTimeFmt.format(d)).replace(/\.$/, ""), testId: k })),
  ];
}

// Couverture d'un mois du tableau : complet, borne basse ou n.d. avec la raison.
function coverageShown(data: RhBuildData, month: string, establishments?: string[]): Shown {
  const ref = data.build.referenceDate;
  if (ref && monthEnd(month) > ref) return { text: `n.d. — mois non clos à la date de référence (${formatDate(ref)})`, kind: "nd" };
  const cov = coverageAt(data, month, establishments);
  const g = gateAt(data, monthEnd(month), establishments);
  if (g.nd) return { text: `n.d. — ${g.nd.reason}`, kind: "nd" };
  const lower = cov.filter((c) => c.presenceStatus === "lower_bound");
  if (lower.length) return { text: "borne basse", kind: "lower", foot: lower[0].presenceReason ?? undefined };
  return { text: "complet", kind: "value" };
}

export default async function KpiPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Search> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await loadKpiContext(slug, {});
  if (!ctx.input) return <KpiHeader ctx={ctx} closedMonth={null} />;
  const data = ctx.input.data;
  const closed = closedMonths(data);
  const last = closed.at(-1) ?? null;

  if (ctx.settings.invalid.length) {
    return (
      <KpiHeader ctx={ctx} closedMonth={last}>
        <section className="placeholder" data-testid="kpi-settings-invalid">
          <h3>n.d. — paramètres des KPI illisibles</h3>
          <p className="muted">
            Valeur enregistrée illisible pour : {ctx.settings.invalid.map((k) => KPI_KEYS[k]).join(", ")}. Aucun KPI n'est calculé avec une valeur remplacée en silence. Un administrateur doit
            ré-enregistrer <a href={`/e/${slug}/parametres#kpi`}>Paramètres › Définitions des KPI</a>.
          </p>
        </section>
      </KpiHeader>
    );
  }
  if (!last) {
    return (
      <KpiHeader ctx={ctx} closedMonth={null}>
        <section className="placeholder" data-testid="kpi-no-closed-month">
          <h3>n.d. — aucun mois clos à la date de référence</h3>
          <p className="muted">Un mois est clos quand son dernier jour est antérieur ou égal à la date de référence ({formatDate(data.build.referenceDate)}).</p>
        </section>
      </KpiHeader>
    );
  }

  // Paramètres GET : une valeur invalide est remplacée par le défaut, et l'écran le dit.
  const notices: string[] = [];
  const ignore = (k: string, v: string, why: string) => notices.push(`paramètre ignoré : ${k}=${v} (${why})`);
  const rawMode = one(sp.mode);
  const mode = rawMode === "civil" ? "civil" : "glissant";
  if (rawMode && rawMode !== "civil" && rawMode !== "glissant") ignore("mode", rawMode, "valeurs possibles : glissant, civil");
  const rawFin = one(sp.fin);
  const fin = closed.includes(rawFin) ? rawFin : last;
  if (rawFin && rawFin !== fin) ignore("fin", rawFin, "hors des mois clos");
  const years = selectableYears(data);
  const rawYear = one(sp.annee);
  const year = years.some((y) => String(y.year) === rawYear) ? Number(rawYear) : defaultYear(data)!;
  if (rawYear && String(year) !== rawYear) ignore("annee", rawYear, "hors des années couvertes");
  const rawEtab = one(sp.etab);
  const etab = ctx.collab.establishments.some((e) => e.id === rawEtab) ? rawEtab : "";
  if (rawEtab && !etab) ignore("etab", rawEtab, "établissement inconnu");
  const rawNature = one(sp.nature);
  const nature = ctx.collab.natures.codes.includes(rawNature) ? rawNature : "";
  if (rawNature && !nature) ignore("nature", rawNature, "nature non comptée dans l'effectif");

  const w: Window = mode === "civil" ? civilWindow(year) : rollingWindow(fin);
  const input: KpiInput = { ...ctx.input, scope: { establishments: etab ? [etab] : undefined, nature: nature || undefined } };
  const dash = kpiDashboard(input, w);

  // detail et mois : un détail de mois exige un mois valide de la fenêtre ou de son N-1 ; un détail de période n'en prend pas ;
  // l'absentéisme accepte les deux. Tout paramètre écarté est signalé avec sa raison.
  const rawDetail = one(sp.detail);
  const rawMois = one(sp.mois);
  const detailId = (KPI_DETAIL_IDS as string[]).includes(rawDetail) ? (rawDetail as KpiDetailId) : null;
  if (rawDetail && !detailId) ignore("detail", rawDetail, "détail inconnu");
  const moisOk = isMonth(rawMois);
  if (rawMois && !moisOk) ignore("mois", rawMois, "format AAAA-MM attendu");
  // periode=n1 : le détail porte sur la période N-1 (retrace les valeurs N-1 des tuiles et de la ligne « Période »).
  const rawPeriode = one(sp.periode);
  const onPrevious = rawPeriode === "n1";
  if (rawPeriode && !onPrevious) ignore("periode", rawPeriode, "valeur possible : n1");
  const detailWindow = onPrevious ? previousWindow(w) : w;
  const windowDetail = detailId === "etp-avg" || detailId === "headcount-avg" || detailId === "turnover";
  const monthDetail = detailId !== null && !windowDetail && detailId !== "absenteeism";
  let detail: ReturnType<typeof kpiDetail> = null;
  if (detailId && monthDetail && !moisOk) {
    ignore("detail", rawDetail, rawMois ? "mois invalide : détail non affiché" : "mois requis pour ce détail");
  } else if (detailId) {
    if (windowDetail && moisOk) ignore("mois", rawMois, "sans objet pour un détail de période");
    detail = kpiDetail(input, detailWindow, detailId, moisOk && !windowDetail ? rawMois : null);
    if (!detail) {
      ignore("mois", rawMois, "hors de la période affichée et de son N-1");
      // L'absentéisme a un défaut sans mois (la période) ; un détail de mois n'en a pas et n'est pas affiché.
      if (detailId === "absenteeism") detail = kpiDetail(input, detailWindow, detailId, null);
      else ignore("detail", rawDetail, "mois hors période : détail non affiché");
    }
  } else if (moisOk) ignore("mois", rawMois, "aucun détail demandé");

  const query = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (mode === "civil") {
      p.set("mode", "civil");
      p.set("annee", String(year));
    } else p.set("fin", fin);
    if (etab) p.set("etab", etab);
    if (nature) p.set("nature", nature);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `?${p.toString()}`;
  };
  const detailHref = (id: string, month: string | null, previous = false) => `${query({ detail: id, ...(month ? { mois: month } : {}), ...(previous ? { periode: "n1" } : {}) })}#kpi-detail`;

  // Nature retenue pour un contrat un mois donné (DSN : déclarée ce mois-là ; PayFit : celle du contrat).
  const natureAt = (key: string, month: string): string | null => {
    const c = data.contracts.find((x) => x.contractKey === key);
    if (!c) return null;
    const m = data.months.find((x) => x.contractKey === key && x.month === month && x.presenceBasis === "declared" && (!etab || x.establishmentId === etab));
    return m ? natureOfMonth(c, m) : c.nature;
  };
  // Liens internes d'un détail : un détail de période N-1 renvoie aux détails de période N-1 ; les mois gardent leur date.
  const inDetail = (id: string, month: string | null) => detailHref(id, month, onPrevious && month === null);
  const maps: Maps = { persons: new Map(data.persons.map((p) => [p.personKey, p])), contracts: new Map(data.contracts.map((c) => [c.contractKey, c])) };
  const s = ctx.settings.values;
  const natures = nature ? [nature] : ctx.collab.natures.codes;
  const changed = (keys: KpiSettingKey[]) => {
    const dates = keys.map((k) => ctx.settings.origins[k]).filter((o) => o.origin === "setting").map((o) => (o.origin === "setting" ? o.updatedAt : null)!);
    if (!dates.length) return "défauts";
    const lastChange = dates.sort((a, b) => b.getTime() - a.getTime())[0];
    return `modifié le ${dateTimeFmt.format(lastChange)}`;
  };
  const etpParams = `temps plein = 1 : ${s.fullTimeIsOne ? "oui" : "non"} · plafond 1 : ${s.capAtOne ? "oui" : "non"} · ${s.etpDecimals} décimales · natures ${natureList(natures)} (${changed(["fullTimeIsOne", "capAtOne", "etpDecimals"])})`;
  const hcParams = `natures ${natureList(natures)}${nature ? " (filtre)" : ""}`;
  const toParams = `${s.turnoverFormula === "half_sum" ? "((E + S) ÷ 2) ÷ effectif moyen" : "S ÷ effectif au premier jour"} · continus ${s.neutralizeContinuity ? "neutralisés" : "comptés"} · sorties exclues : ${s.excludedExitNatures.length ? natureList(s.excludedExitNatures) : "aucune"} (${changed(["turnoverFormula", "neutralizeContinuity", "excludedExitNatures"])})`;
  const absParams = `types : ${s.absenceTypes.length ? s.absenceTypes.join(", ") : "aucun"} · statuts : ${s.absenceStatuses.map((x) => ABSENCE_STATUS_LABELS[x] ?? x).join(", ")} · ${s.dayBasis === "calendar" ? "jours calendaires" : "du lundi au vendredi"} (${changed(["absenceTypes", "absenceStatuses", "dayBasis"])})`;

  const t = dash.tiles;
  const n1 = <T,>(c: Compared<T>, shown: Shown) => `N-1 (${c.previousWindow.label}) : ${shown.text}`;
  const pw = dash.previousWindow;
  const lowerMonths = new Set(data.coverage.filter((c) => c.presenceStatus === "lower_bound").map((c) => c.month));

  // Avis de couverture des mois non complets de la période, regroupés par raison.
  const covNotices = new Map<string, string[]>();
  for (const m of w.months) {
    const c = coverageShown(data, m, input.scope.establishments);
    if (c.kind === "value") continue;
    const key = c.kind === "lower" ? `borne basse — ${c.foot ?? "contrats archivés inconnus"}` : c.text;
    covNotices.set(key, [...(covNotices.get(key) ?? []), m]);
  }

  const chosenTypes = dash.absenceTypes.filter((x) => x.chosen);
  const otherTypes = dash.absenceTypes.filter((x) => !x.chosen);
  const missingTypes = chosenTypes.filter((x) => !x.inRead);

  // Cellules du tableau, gardées pour la liste des raisons « n.d. ».
  const rows = dash.rows.map((r) => ({
    r,
    cells: {
      coverage: coverageShown(data, r.month, input.scope.establishments),
      headcount: showHeadcount(r.headcount, "persons"),
      etp: etpShown(r.etp),
      entries: showCount(r.movements.entries),
      exits: showCount(r.movements.exits),
      theoretical: theoreticalShown(r.theoretical),
      absenceDays: absenceDaysShown(r.absenteeism),
      absenteeism: absenteeismShown(r.absenteeism),
      etpN1: etpShown(r.previous.etp),
      absenteeismN1: absenteeismShown(r.previous.absenteeism),
    },
  }));
  // Les colonnes N-1 portent sur le même mois un an plus tôt : leurs raisons sont datées de ce mois-là.
  const ndItems = rows.flatMap(({ r, cells }) =>
    Object.entries(cells).map(([col, shown]) => ({ month: col === "etpN1" || col === "absenteeismN1" ? r.previous.month : r.month, shown })),
  );
  const toCur = t.turnover.current;
  const absCur = t.absenteeism.current;

  return (
    <KpiHeader ctx={ctx} closedMonth={last}>
      <PayfitNotice data={data} />
      {notices.map((n) => (
        <p key={n} className="notice" data-testid="kpi-param-notice">{n}</p>
      ))}

      <form method="get" className="filters" data-testid="kpi-filters">
        <div className="field-row">
          <label htmlFor="mode">Période</label>
          <select className="select" id="mode" name="mode" defaultValue={mode}>
            <option value="glissant">12 mois glissants</option>
            <option value="civil">Année civile</option>
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="fin">Fin des 12 mois glissants</label>
          <select className="select" id="fin" name="fin" defaultValue={fin}>
            {[...closed].reverse().map((m) => (
              <option key={m} value={m}>{m}{lowerMonths.has(m) ? " — borne basse" : ""}</option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="annee">Année civile</label>
          <select className="select" id="annee" name="annee" defaultValue={String(year)}>
            {[...years].reverse().map((y) => (
              <option key={y.year} value={y.year}>{y.year}{y.closed ? "" : " — non close"}</option>
            ))}
          </select>
        </div>
        {ctx.collab.establishments.length > 1 && (
          <div className="field-row">
            <label htmlFor="etab">Établissement</label>
            <select className="select" id="etab" name="etab" defaultValue={etab}>
              <option value="">Tous</option>
              {ctx.collab.establishments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
        )}
        <div className="field-row">
          <label htmlFor="nature">Nature</label>
          <select className="select" id="nature" name="nature" defaultValue={nature}>
            <option value="">Natures comptées</option>
            {ctx.collab.natures.codes.map((n) => <option key={n} value={n}>{contractNatureLabel(n)}</option>)}
          </select>
        </div>
        <button className="btn" type="submit">Afficher</button>
      </form>

      <p className="desc" data-testid="kpi-period">
        <strong>{w.label}</strong> · N-1 : {pw.label} · date de référence {formatDate(data.build.referenceDate)}
        {etab ? ` · établissement ${etab}` : ""}
        {nature ? ` · nature ${contractNatureLabel(nature)}` : ""}
      </p>
      {[...covNotices].map(([reason, months]) => (
        <p key={reason} className="notice" data-testid="coverage-notice">{monthRanges(months)} : {reason}</p>
      ))}

      <section className="panel">
        <h2>Indicateurs — {w.label}</h2>
        <dl className="facts" data-testid="kpi-tiles">
          <KpiTile
            id="etp-end"
            label={`ETP contractuel fin ${monthLabel(w.to)}`}
            shown={etpShown(t.etpEnd.current)}
            title={etpTitle(t.etpEnd.current)}
            n1={n1(t.etpEnd, etpShown(t.etpEnd.previous))}
            delta={fmtDelta(t.etpEnd.delta)}
            params={etpParams}
            qualifiers={t.etpEnd.current.kind === "nd" ? [] : t.etpEnd.current.qualifiers}
            def="etp-month-end"
            detail={detailHref("etp-end", w.to)}
            detailN1={detailHref("etp-end", dash.previousWindow.to)}
          />
          <KpiTile
            id="etp-avg"
            label="ETP moyen"
            shown={averageShown(t.etpAverage.current)}
            title={ratioTitle(t.etpAverage.current)}
            n1={n1(t.etpAverage, averageShown(t.etpAverage.previous))}
            delta={fmtDelta(t.etpAverage.delta)}
            params={etpParams}
            qualifiers={t.etpAverage.current.kind === "nd" ? [] : t.etpAverage.current.qualifiers}
            def="etp-average"
            detail={detailHref("etp-avg", null)}
            detailN1={detailHref("etp-avg", null, true)}
          />
          <KpiTile
            id="headcount-avg"
            label="Effectif moyen (personnes)"
            shown={averageShown(t.headcountAverage.current)}
            title={ratioTitle(t.headcountAverage.current)}
            n1={n1(t.headcountAverage, averageShown(t.headcountAverage.previous))}
            delta={fmtDelta(t.headcountAverage.delta)}
            params={hcParams}
            def="headcount-average"
            detail={detailHref("headcount-avg", null)}
            detailN1={detailHref("headcount-avg", null, true)}
          />
          <KpiTile
            id="turnover"
            label="Turnover"
            shown={turnoverShown(toCur)}
            title={ratioTitle(toCur)}
            n1={n1(t.turnover, turnoverShown(t.turnover.previous))}
            delta={fmtDelta(t.turnover.delta)}
            params={toParams}
            qualifiers={toCur.kind === "exact" ? toCur.qualifiers : []}
            def="turnover"
            detail={detailHref("turnover", null)}
            detailN1={detailHref("turnover", null, true)}
          />
          <KpiTile
            id="absenteeism"
            label="Absentéisme"
            shown={absenteeismShown(absCur)}
            title={ratioTitle(absCur)}
            n1={n1(t.absenteeism, absenteeismShown(t.absenteeism.previous))}
            delta={fmtDelta(t.absenteeism.delta)}
            params={absParams}
            qualifiers={absCur.kind === "nd" ? [] : absCur.qualifiers}
            def="absenteeism"
            detail={detailHref("absenteeism", null)}
            detailN1={detailHref("absenteeism", null, true)}
          >
            {input.absences.status === "read" && (
              <span className="tile-foot" data-testid="kpi-absence-types">
                types comptés : {chosenTypes.length ? chosenTypes.map((x) => `${x.type} (${x.count})`).join(", ") : "aucun"} — types présents non comptés :{" "}
                {otherTypes.length ? otherTypes.map((x) => `${x.type} (${x.count})`).join(", ") : "aucun"}
                {missingTypes.length > 0 && <> — absents de la lecture : {missingTypes.map((x) => x.type).join(", ")}</>} · <a href={`/e/${slug}/parametres#kpi`}>Paramètres</a>
              </span>
            )}
          </KpiTile>
        </dl>
      </section>

      <section className="panel">
        <h2>Mois par mois <span className="desc">— {w.months.length} mois, valeurs de fin de mois ; N-1 = même mois un an plus tôt</span></h2>
        <div className="table-wrap">
          <table className="data-table" data-testid="kpi-monthly-table">
            <thead>
              <tr>
                <th>Mois</th><th>Couverture</th><th className="num wrap">Effectif fin de mois</th><th className="num wrap">ETP fin de mois</th><th className="num">Entrées</th><th className="num">Sorties</th>
                <th className="num wrap">Jours théoriques</th><th className="num wrap">Jours d'absence</th><th className="num">Absentéisme</th><th className="num">ETP N-1</th><th className="num wrap">Absentéisme N-1</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, cells: c }) => (
                <tr key={r.month} data-month={r.month}>
                  <td>{r.month}</td>
                  <Cell col="coverage" shown={c.coverage} href={null} />
                  <Cell col="headcount" shown={c.headcount} href={detailHref("headcount", r.month)} />
                  <Cell col="etp" shown={c.etp} href={detailHref("etp-end", r.month)} />
                  <Cell col="entries" shown={c.entries} href={detailHref("entries", r.month)} />
                  <Cell col="exits" shown={c.exits} href={detailHref("exits", r.month)} />
                  <Cell col="theoretical" shown={c.theoretical} href={detailHref("theoretical", r.month)} />
                  <Cell col="absence-days" shown={c.absenceDays} href={detailHref("absenteeism", r.month)} />
                  <Cell col="absenteeism" shown={c.absenteeism} href={detailHref("absenteeism", r.month)} />
                  <Cell col="etp-n1" shown={c.etpN1} href={detailHref("etp-end", r.previous.month)} />
                  <Cell col="absenteeism-n1" shown={c.absenteeismN1} href={detailHref("absenteeism", r.previous.month)} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="kpi-monthly-foot">
                <td>Période</td>
                <td />
                <Cell col="headcount" shown={averageShown(t.headcountAverage.current)} href={detailHref("headcount-avg", null)} />
                <Cell col="etp" shown={averageShown(t.etpAverage.current)} href={detailHref("etp-avg", null)} />
                <Cell col="entries" shown={show(dash.movements.entries, (x) => String(x.value))} href={detailHref("turnover", null)} />
                <Cell col="exits" shown={show(dash.movements.exits, (x) => String(x.value))} href={detailHref("turnover", null)} />
                <Cell col="theoretical" shown={show(dash.theoretical, (x) => fmtHalfDays(x.half))} href={detailHref("absenteeism", null)} />
                <Cell col="absence-days" shown={show(absCur, (x) => fmtHalfDays(x.ratio.num))} href={detailHref("absenteeism", null)} />
                <Cell col="absenteeism" shown={show(absCur, (x) => fmtPercent(x.ratio))} href={detailHref("absenteeism", null)} />
                <Cell col="etp-n1" shown={averageShown(t.etpAverage.previous)} href={detailHref("etp-avg", null, true)} />
                <Cell col="absenteeism-n1" shown={absenteeismShown(t.absenteeism.previous)} href={detailHref("absenteeism", null, true)} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="desc">
          Ligne « Période » : valeurs des indicateurs ci-dessus (moyennes de fin de mois, mouvements comptés, somme des jours), jamais une moyenne de colonne recalculée par l'écran.
        </p>
        <NdReasons items={ndItems} />
      </section>

      {detail && detailId && (
        <section className="panel" id="kpi-detail" data-testid="kpi-detail">
          <h2>
            Détail — {DETAIL_TITLES[detailId]}
            {onPrevious ? " (N-1)" : ""}
            {"month" in detail && detail.month ? ` · ${detail.month}` : ` · ${"window" in detail ? detail.window.label : w.label}`}
          </h2>
          <p className="desc"><a href={query({})}>Fermer le détail</a></p>
          {detail.id === "etp-end" && <EtpEndDetail v={detail.value} maps={maps} slug={slug} decimals={s.etpDecimals} refDate={data.build.referenceDate} />}
          {detail.id === "headcount" && <HeadcountDetail v={detail.value} maps={maps} slug={slug} month={detail.month} natureAt={natureAt} />}
          {(detail.id === "entries" || detail.id === "exits") && <MovementsDetail v={detail.value} kind={detail.id === "entries" ? "entry" : "exit"} maps={maps} slug={slug} />}
          {(detail.id === "theoretical" || detail.id === "absenteeism") && <AbsenceMonthDetail id={detail.id} v={detail.value} theoretical={detail.theoretical} maps={maps} slug={slug} />}
          {detail.id === "absenteeism-window" && <AbsenteeismWindowDetail v={detail.value} theoretical={detail.theoretical} detailHref={inDetail} />}
          {(detail.id === "etp-avg" || detail.id === "headcount-avg") && <AverageDetail v={detail.value} detailHref={inDetail} />}
          {detail.id === "turnover" && <TurnoverDetail v={detail.value} maps={maps} slug={slug} detailHref={inDetail} natureAt={natureAt} />}
        </section>
      )}

      <KpiDefinitions slug={slug} params={paramList(ctx.settings, ctx.collab.natures)} />
    </KpiHeader>
  );
}
