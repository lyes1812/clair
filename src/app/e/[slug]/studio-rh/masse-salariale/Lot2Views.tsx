import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { servicesOf, shiftYear, windowPayroll, withService, type JournalInput } from "@/lib/payroll/engine";
import { RUBRICS, type RubricId } from "@/lib/payroll/grid";
import { comptaGap, CONGES_PREFIX, labelTotals, operatingRevenue, provisionMonth, reconcile, type ComptaLine, type ProvisionMonth } from "@/lib/payroll/lot2";
import { fmtPercent } from "@/lib/rh/kpi/format";

const lowerMonth = (m: string) => formatMonth(m).toLowerCase();
const signed = (c: number) => `${c > 0 ? "+" : ""}${formatEuros(c)}`;
const pct = (a: number, b: number) => (b === 0 ? "n.d. (N-1 nul)" : b < 0 ? "n.d. (N-1 négatif)" : `${a - b > 0 ? "+" : ""}${fmtPercent({ num: a - b, den: b })}`);
const rubricLabel = (id: RubricId | "non-classe") => (id === "non-classe" ? "Comptes 63/64 non classés" : (RUBRICS.find((r) => r.id === id)?.label ?? id));
const BRUT: RubricId[] = ["salaires", "primes", "stages", "indemnites"];
// Raisons des n.d. d'un tableau, listées sous le tableau (jamais seulement en infobulle).
const ndReasons = (reasons: (string | null | undefined)[]) => {
  const list = [...new Set(reasons.filter((r): r is string => Boolean(r)))];
  return list.length ? <p className="tile-foot nd" data-testid="nd-reasons">n.d. : {list.join(" ; ")}</p> : null;
};

// --- Onglet « Fixe & variable » : brut par rubrique et par libellé de paie PayFit, N et N-1, primes par famille et par mois.
export function FixeVariableView({ input, months, prevMonths }: { input: JournalInput; months: string[]; prevMonths: string[] }) {
  const cur = windowPayroll(input, months);
  const prev = windowPayroll(input, prevMonths);
  if (cur.kind === "nd") return <p className="nd" data-testid="fv-nd">n.d. — {cur.nd.reason}</p>;
  const n = labelTotals(input, months);
  const p = prev.kind === "value" ? labelTotals(input, prevMonths) : [];
  // Même clé que le calcul (libellé sans accents ni casse) ; libellé affiché : celui de la période N s'il existe.
  const keys = [...new Map([...p, ...n].map((t) => [t.key, t])).values()].sort((a, b) => BRUT.indexOf(a.rubric) - BRUT.indexOf(b.rubric) || a.label.localeCompare(b.label));
  const val = (list: typeof n, k: string) => list.filter((t) => t.key === k).reduce((s, t) => s + t.cents, 0);
  const prevNd = prev.kind === "nd" ? prev.nd.reason : null;
  const fixe = (w: typeof prev) => (w.kind === "value" ? w.byRubric.salaires : null);
  const variable = (w: typeof prev) => (w.kind === "value" ? w.byRubric.primes + w.byRubric.indemnites : null);
  const families = n.filter((t) => t.rubric === "primes").sort((a, b) => a.label.localeCompare(b.label));
  const tile = (id: string, label: string, a: number | null, b: number | null, foot: string) => (
    <div data-testid={`fv-tile-${id}`}>
      <dt>{label}</dt>
      <dd>{a === null ? "n.d." : formatEuros(a)}</dd>
      <span className="tile-foot">N-1 : {b === null ? `n.d. — ${prevNd ?? "non disponible"}` : formatEuros(b)}{a !== null && b !== null ? ` · ${signed(a - b)} · ${pct(a, b)}` : ""}</span>
      <span className="tile-foot">{foot} · <a href="#def-fixe-variable">Définition</a></span>
    </div>
  );
  return (
    <>
      <section className="panel">
        <h2>Fixe et variable</h2>
        <dl className="facts">
          {tile("fixe", "Fixe (salaires et congés payés)", fixe(cur), fixe(prev), "rubrique « Salaires et appointements »")}
          {tile("variable", "Variable (primes et indemnités)", variable(cur), variable(prev), "rubriques « Primes » et « Indemnités et avantages »")}
          {tile("primes", "dont primes", cur.byRubric.primes, prev.kind === "value" ? prev.byRubric.primes : null, `${families.length} famille(s) : ${families.map((f) => f.label).join(", ") || "aucune"}`)}
          {tile("stages", "Gratifications de stage", cur.byRubric.stages, prev.kind === "value" ? prev.byRubric.stages : null, "rubrique à part, comptée dans le brut")}
        </dl>
      </section>
      <section className="panel">
        <h2>Brut par libellé de paie <span className="desc">— libellés des lignes du journal PayFit, classés par la grille de comptes</span></h2>
        <div className="table-wrap">
          <table className="data-table" data-testid="fv-labels">
            <thead><tr><th>Rubrique</th><th>Libellé (PayFit)</th><th className="num">N-1</th><th className="num">N</th><th className="num">Écart €</th><th className="num">Écart %</th></tr></thead>
            <tbody>
              {keys.map((t) => {
                const k = t.key;
                const a = val(n, k);
                const b = val(p, k);
                return (
                  <tr key={k} data-label={t.label}>
                    <td>{rubricLabel(t.rubric)}</td>
                    <td className="wrap">{t.label}</td>
                    <td className="num" data-col="n1">{prev.kind === "value" ? formatEuros(b) : "n.d."}</td>
                    <td className="num" data-col="n">{formatEuros(a)}</td>
                    <td className="num">{prev.kind === "value" ? signed(a - b) : "n.d."}</td>
                    <td className="num">{prev.kind === "value" ? pct(a, b) : "n.d."}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr data-testid="fv-labels-total"><td colSpan={2}>Brut</td><td className="num">{prev.kind === "value" ? formatEuros(prev.brut) : "n.d."}</td><td className="num" data-col="n">{formatEuros(cur.brut)}</td><td className="num">{prev.kind === "value" ? signed(cur.brut - prev.brut) : "n.d."}</td><td className="num">{prev.kind === "value" ? pct(cur.brut, prev.brut) : "n.d."}</td></tr>
            </tfoot>
          </table>
        </div>
        {ndReasons([prevNd && `N-1 (${prevMonths[0]} → ${prevMonths.at(-1)}) : ${prevNd}`])}
      </section>
      <section className="panel">
        <h2>Primes par famille et par mois</h2>
        {families.length === 0 ? (
          <p className="desc">Aucune prime sur la période (rubrique « Primes » de la grille de comptes).</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="fv-primes-months">
              <thead><tr><th>Mois</th>{families.map((f) => <th key={f.key} className="num">{f.label}</th>)}<th className="num">Total primes</th></tr></thead>
              <tbody>
                {cur.months.map((r) => {
                  const lt = r.kind === "value" ? labelTotals(input, [r.month]) : [];
                  return (
                    <tr key={r.month} data-month={r.month}>
                      <td>{formatMonth(r.month)}</td>
                      {families.map((f) => <td key={f.key} className="num">{r.kind === "value" ? formatEuros(lt.filter((t) => t.key === f.key).reduce((s, t) => s + t.cents, 0)) : "n.d."}</td>)}
                      <td className="num">{r.kind === "value" ? formatEuros(r.byRubric.primes) : "n.d."}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="tile-foot" data-testid="fv-non-recurrents">
          Éléments non récurrents (indemnités de rupture conventionnelle, indemnités compensatrices de congés payés) : non distingués par le journal PayFit, qui les passe avec
          les autres lignes du compte 6414 « Indemnités et avantages divers » ; ils restent dans la rubrique « Indemnités et avantages ».
        </p>
      </section>
    </>
  );
}

// --- Onglet « Paie & comptabilité » : provision de congés payés et rapprochement avec la comptabilité.
export function PaieComptaView(props: {
  slug: string;
  input: JournalInput;
  fullInput: JournalInput;
  months: string[];
  serviceFiltered: boolean;
  compta: { source: "pennylane" | "fec" | null; reason: string; lines: ComptaLine[]; months: string[]; nd: Record<string, string> };
}) {
  const { slug, input, fullInput, months, serviceFiltered, compta } = props;
  const last = months.at(-1)!;
  const prov = (m: string) => provisionMonth(input, m);
  const cur = prov(last);
  const n1 = prov(shiftYear(last, -1));
  type PV = Extract<ProvisionMonth, { kind: "value" }>;
  const show = (x: ProvisionMonth, pick: (v: PV) => number | null) => {
    const v = x.kind === "nd" ? null : pick(x);
    return v === null ? "n.d." : formatEuros(v);
  };
  // Raisons des n.d. de la provision : mois n.d., ou part sans aucune ligne de dotation dans le mois.
  const why = (x: ProvisionMonth, m: string) =>
    x.kind === "nd"
      ? `${m} : ${x.reason}`
      : [x.conges === null ? `${m} : congés payés — aucune ligne ${CONGES_PREFIX} « Mois courant »` : null, x.charges === null ? `${m} : charges sociales — aucune ligne hors ${CONGES_PREFIX} « Mois courant »` : null].filter(Boolean).join(" ; ") || null;
  const services = fullInput.serviceAxis ? servicesOf(fullInput, [last, shiftYear(last, -1)]) : [];
  const recon = serviceFiltered ? null : compta.source ? reconcile(fullInput, compta.lines, compta.months, months, compta.nd) : null;
  const masse = windowPayroll(fullInput, months);
  const gap = compta.source ? comptaGap(compta.months, compta.nd, months) : null;
  const produits = compta.source && !gap ? operatingRevenue(compta.lines, months) : null;
  return (
    <>
      <section className="panel" data-testid="pc-provision">
        <h2>Que doit l'entreprise en congés payés ? <span className="desc">— provision à fin de mois, charges sociales comprises</span></h2>
        <dl className="facts">
          <div data-testid="pc-tile-provision">
            <dt>Provision fin {lowerMonth(last)}</dt>
            <dd className={cur.kind === "nd" ? "nd" : undefined}>{cur.kind === "nd" ? `n.d. — ${cur.reason}` : formatEuros(cur.total)}</dd>
            <span className="tile-foot">congés payés {show(cur, (v) => v.conges)} + charges sociales {show(cur, (v) => v.charges)}{cur.kind === "value" && why(cur, last) ? ` (${why(cur, last)})` : ""}</span>
            <span className="tile-foot" data-testid="pc-tile-provision-n1">fin {lowerMonth(shiftYear(last, -1))} : {n1.kind === "nd" ? `n.d. — ${n1.reason}` : formatEuros(n1.total)}{cur.kind === "value" && n1.kind === "value" ? ` · ${signed(cur.total - n1.total)}` : ""}</span>
            <span className="tile-foot"><a href="#def-provision">Définition</a></span>
          </div>
        </dl>
        <div className="table-wrap">
          <table className="data-table" data-testid="pc-provision-months">
            <thead><tr><th>Fin de mois</th><th className="num">Congés payés</th><th className="num">Charges sociales</th><th className="num">Total</th><th className="num">Total N-1</th><th className="num">Écart</th></tr></thead>
            <tbody>
              {months.map((m) => {
                const a = prov(m);
                const b = prov(shiftYear(m, -1));
                return (
                  <tr key={m} data-month={m}>
                    <td>{formatMonth(m)}</td>
                    <td className="num">{show(a, (v) => v.conges)}</td>
                    <td className="num">{show(a, (v) => v.charges)}</td>
                    <td className="num" data-col="total">{show(a, (v) => v.total)}</td>
                    <td className="num" data-col="total-n1">{show(b, (v) => v.total)}</td>
                    <td className="num">{a.kind === "value" && b.kind === "value" ? signed(a.total - b.total) : "n.d."}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {ndReasons(months.flatMap((m) => [why(prov(m), m), why(prov(shiftYear(m, -1)), shiftYear(m, -1))]))}
        {services.length > 0 && !serviceFiltered && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table" data-testid="pc-provision-services">
              <thead><tr><th>Service — fin {lowerMonth(last)}</th><th className="num">Congés payés</th><th className="num">Charges sociales</th><th className="num">Total</th><th className="num">Total N-1</th><th className="num">Écart</th></tr></thead>
              <tbody>
                {services.map((s) => {
                  const a = provisionMonth(withService(fullInput, s), last);
                  const b = provisionMonth(withService(fullInput, s), shiftYear(last, -1));
                  return (
                    <tr key={s ?? "__nv__"} data-service={s ?? "__nv__"}>
                      <td>{s ?? "Non ventilé"}</td>
                      <td className="num">{show(a, (v) => v.conges)}</td>
                      <td className="num">{show(a, (v) => v.charges)}</td>
                      <td className="num" data-col="total">{show(a, (v) => v.total)}</td>
                      <td className="num">{show(b, (v) => v.total)}</td>
                      <td className="num">{a.kind === "value" && b.kind === "value" ? signed(a.total - b.total) : "n.d."}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ndReasons(services.flatMap((s) => [last, shiftYear(last, -1)].map((m) => why(provisionMonth(withService(fullInput, s), m), `${s ?? "Non ventilé"} ${m}`))))}
          </div>
        )}
      </section>

      <section className="panel" data-testid="pc-recon">
        <h2>Rapprochement avec la comptabilité <span className="desc">— comptes 63 et 64 du journal de paie et de la comptabilité, mêmes mois, même grille</span></h2>
        {serviceFiltered ? (
          <p className="desc">Disponible sur le total entreprise (sans filtre Service) : la comptabilité ne porte pas le code analytique du journal de paie.</p>
        ) : !compta.source ? (
          <p className="nd" data-testid="pc-recon-nd">n.d. — aucune source comptable retenue ({compta.reason}) : connectez Pennylane ou déposez un FEC dans <a href={`/e/${slug}/donnees`}>Données</a>.</p>
        ) : recon?.kind === "nd" ? (
          <p className="nd" data-testid="pc-recon-nd">n.d. — {recon.reason} (source comptable : {compta.source === "fec" ? "FEC" : "API Pennylane"}).</p>
        ) : recon ? (
          <>
            <p className="desc">Source comptable : {compta.source === "fec" ? "FEC déposés" : "API Pennylane"} · {compta.reason}</p>
            <div className="table-wrap">
              <table className="data-table" data-testid="pc-recon-rubrics">
                <thead><tr><th>Rubrique</th><th className="num">Journal de paie</th><th className="num">Comptabilité</th><th className="num">Écart</th></tr></thead>
                <tbody>
                  {recon.rows.map((r) => (
                    <tr key={r.rubric} data-rubric={r.rubric}>
                      <td>{rubricLabel(r.rubric)}</td>
                      <td className="num">{formatEuros(r.journal)}</td>
                      <td className="num">{formatEuros(r.compta)}</td>
                      <td className="num" data-col="ecart">{signed(r.ecart)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr data-testid="pc-recon-total"><td>Total comptes 63/64</td><td className="num">{formatEuros(recon.journal)}</td><td className="num">{formatEuros(recon.compta)}</td><td className="num" data-col="ecart">{signed(recon.ecart)}</td></tr>
                </tfoot>
              </table>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table" data-testid="pc-recon-months">
                <thead><tr><th>Mois</th><th className="num">Journal de paie</th><th className="num">Comptabilité</th><th className="num">Écart</th></tr></thead>
                <tbody>
                  {recon.months.map((m) => (
                    <tr key={m.month} data-month={m.month}><td>{formatMonth(m.month)}</td><td className="num">{formatEuros(m.journal)}</td><td className="num">{formatEuros(m.compta)}</td><td className="num" data-col="ecart">{signed(m.journal - m.compta)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="panel" data-testid="pc-ratio">
        <h2>Masse salariale ÷ produits d'exploitation</h2>
        <p data-testid="pc-ratio-value">
          {serviceFiltered
            ? "Disponible sur le total entreprise (sans filtre Service)."
            : masse.kind === "nd"
              ? `n.d. — ${masse.nd.reason}`
              : produits === null
                ? `n.d. — ${compta.source ? gap : `aucune source comptable retenue (${compta.reason}) : produits d'exploitation 70 à 75`}`
                : produits <= 0
                  ? "n.d. — aucun produit d'exploitation (comptes 70 à 75) sur la période"
                  : `${fmtPercent({ num: masse.masse, den: produits })} — masse chargée ${formatEuros(masse.masse)} ÷ produits d'exploitation ${formatEuros(produits)}`}
        </p>
      </section>
    </>
  );
}

