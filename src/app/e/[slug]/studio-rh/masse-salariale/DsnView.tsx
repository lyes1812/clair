import { formatMonth } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { dsnBrutWindow, type DsnMonth, type DsnWindow } from "@/lib/payroll/dsn";
import { shiftYear } from "@/lib/payroll/engine";
import { fmtPercent } from "@/lib/rh/kpi/format";
import { monthShort } from "./components";

// Masse salariale quand la source RH retenue est la DSN : brut déclaré (S21.G00.51 type 001) des déclarations qui font
// foi. Les cotisations patronales ne sont pas portées salarié par salarié de façon fiable par la DSN : la masse chargée
// est n.d. avec sa raison, jamais estimée.
const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ND_CHARGES = "cotisations patronales non portées salarié par salarié par la DSN (blocs S21.G00.81 et S21.G00.23 non extraits) : utilisez l'API PayFit (journal de paie) pour la masse chargée";
const STATUS: Record<DsnMonth["status"], string> = { complete: "complet", incomplete: "incomplet ⚠", blocked: "bloqué" };

export function DsnView({ slug, dsn, sp }: { slug: string; dsn: Map<string, DsnMonth>; sp: Record<string, string> }) {
  const base = `/e/${slug}/studio-rh/masse-salariale`;
  const covered = [...dsn.keys()].sort();
  const usable = covered.filter((m) => dsn.get(m)!.status !== "blocked" && dsn.get(m)!.byType["001"] !== undefined);
  const last = usable.at(-1) ?? null;
  const source = (
    <p className="desc" data-testid="ms-source">
      Source : DSN déposées (déclarations qui font foi, module Données) · mois couverts {covered[0] ?? "n.d."} → {covered.at(-1) ?? "n.d."} ·{" "}
      <a href={`/e/${slug}/donnees`}>Données</a>
    </p>
  );
  if (!last) {
    return (
      <>
        {source}
        <section className="placeholder" data-testid="ms-nd">
          <h3>n.d. — aucune DSN appliquée avec une rémunération de type 001</h3>
        </section>
      </>
    );
  }
  const notices: string[] = [];
  const years = [...new Set(covered.map((m) => Number(m.slice(0, 4))))].sort();
  const year = years.includes(Number(sp.annee)) ? Number(sp.annee) : Number(last.slice(0, 4));
  if (sp.annee && String(year) !== sp.annee) notices.push(`paramètre ignoré : annee=${sp.annee} (année hors des DSN déposées)`);
  const lastOfYear = year === Number(last.slice(0, 4)) ? last.slice(5, 7) : (covered.filter((m) => m.startsWith(`${year}-`)).at(-1)?.slice(5, 7) ?? "12");
  let from = MM.includes(sp.de) ? sp.de : "01";
  const to = MM.includes(sp.a) ? sp.a : lastOfYear;
  if (from > to) from = "01";
  const months = MM.filter((m) => m >= from && m <= to).map((m) => `${year}-${m}`);
  const prevMonths = months.map((m) => shiftYear(m, -1));
  const cur = dsnBrutWindow(dsn, months);
  const prev = dsnBrutWindow(dsn, prevMonths);
  const show = (w: DsnWindow) => (w.kind === "nd" ? `n.d. — ${w.reason}` : formatEuros(w.brutCents));
  const evo = cur.kind === "value" && prev.kind === "value" && prev.brutCents !== 0 ? { delta: cur.brutCents - prev.brutCents, ratio: { num: cur.brutCents - prev.brutCents, den: prev.brutCents } } : null;
  const label = (ms: string[]) => (ms.length === 1 ? formatMonth(ms[0]) : `${MONTH_NAMES[Number(ms[0].slice(5)) - 1]} → ${MONTH_NAMES[Number(ms.at(-1)!.slice(5)) - 1]} ${ms[0].slice(0, 4)}`);
  const q = (de: string, a: string) => `${base}?annee=${year}&de=${de}&a=${a}`;
  const presets = [
    { label: "Janv.–mars", de: "01", a: "03" },
    { label: "Janv.–juin", de: "01", a: "06" },
    { label: `Janv.–${monthShort(`${year}-${lastOfYear}`)}`, de: "01", a: lastOfYear },
  ].filter((p, i, all) => p.a <= lastOfYear && all.findIndex((x) => x.a === p.a) === i);
  return (
    <>
      {source}
      <p className="notice" data-testid="ms-raw-notice">Montants tels que déclarés en DSN (rémunération brute non plafonnée, type 001). La masse chargée n'est pas calculée depuis la DSN.</p>
      {notices.map((n) => <p key={n} className="notice" data-testid="ms-param-notice">{n}</p>)}
      <form method="get" className="filters" data-testid="ms-filters">
        <div className="field-row">
          <label htmlFor="annee">Année</label>
          <select className="select" id="annee" name="annee" defaultValue={String(year)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
        <div className="field-row">
          <label htmlFor="de">Premier mois</label>
          <select className="select" id="de" name="de" defaultValue={from}>{MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}</select>
        </div>
        <div className="field-row">
          <label htmlFor="a">Dernier mois</label>
          <select className="select" id="a" name="a" defaultValue={to}>{MM.map((m, i) => <option key={m} value={m}>{MONTH_NAMES[i]}</option>)}</select>
        </div>
        <button className="btn" type="submit">Afficher</button>
        <span className="actions" data-testid="ms-presets">{presets.map((p) => <a key={p.label} className="btn" href={q(p.de, p.a)}>{p.label}</a>)}</span>
      </form>
      <p className="desc" data-testid="ms-period"><strong>{label(months)}</strong> · comparé à {label(prevMonths)} (mêmes mois)</p>
      <section className="panel">
        <h2>Vue d'ensemble — {label(months)}</h2>
        <dl className="facts">
          <div data-testid="ms-tile-brut">
            <dt>Brut déclaré (DSN, type 001)</dt>
            <dd className={cur.kind === "nd" ? "nd" : undefined}>{show(cur)}</dd>
            <span className="tile-foot" data-testid="ms-tile-brut-n1">N-1 : {show(prev)}{cur.kind === "value" && cur.incompleteMonths.length ? ` · mois incomplets : ${cur.incompleteMonths.join(", ")}` : ""}{prev.kind === "value" && prev.incompleteMonths.length ? ` · mois N-1 incomplets : ${prev.incompleteMonths.join(", ")}` : ""}</span>
            <span className="tile-foot"><a href="#def-brut-dsn">Définition</a></span>
          </div>
          <div data-testid="ms-tile-evolution">
            <dt>Évolution du brut vs N-1</dt>
            <dd className={evo ? undefined : "nd"}>{evo ? `${evo.delta > 0 ? "+" : ""}${fmtPercent(evo.ratio)}` : `n.d. — ${cur.kind === "nd" ? `période : ${cur.reason}` : prev.kind === "nd" ? `N-1 : ${prev.reason}` : "N-1 nul : % non défini"}`}</dd>
            <span className="tile-foot">{evo ? `${evo.delta > 0 ? "+" : ""}${formatEuros(evo.delta)}` : ""}</span>
            <span className="tile-foot"><a href="#def-brut-dsn">Définition</a></span>
          </div>
          <div data-testid="ms-tile-masse">
            <dt>Masse salariale chargée</dt>
            <dd className="nd">n.d. — {ND_CHARGES}</dd>
            <span className="tile-foot"><a href="#def-masse-dsn">Définition</a></span>
          </div>
        </dl>
      </section>
      <section className="panel">
        <h2>Mois par mois</h2>
        <div className="table-wrap">
          <table className="data-table" data-testid="ms-monthly-table">
            <thead><tr><th>Mois</th><th>DSN</th><th className="num">Brut déclaré (001)</th><th className="num">Brut N-1</th><th className="num">Écart</th><th>Autres types déclarés (non additionnés)</th></tr></thead>
            <tbody>
              {months.map((m) => {
                const d = dsn.get(m);
                const p = dsn.get(shiftYear(m, -1));
                const b = d && d.status !== "blocked" ? d.byType["001"] : undefined;
                const pInc = p?.status === "incomplete" ? " ⚠" : "";
                const bp = p && p.status !== "blocked" ? p.byType["001"] : undefined;
                const others = d ? Object.entries(d.byType).filter(([t]) => t !== "001") : [];
                return (
                  <tr key={m} data-month={m}>
                    <td>{formatMonth(m)}</td>
                    <td>{d ? STATUS[d.status] : <span className="nd">non déposée</span>}</td>
                    <td className="num" data-col="brut">{b === undefined ? "n.d." : formatEuros(b)}</td>
                    <td className="num" data-col="brut-n1">{bp === undefined ? "n.d." : `${formatEuros(bp)}${pInc}`}</td>
                    <td className="num" data-col="ecart">{b === undefined || bp === undefined ? "n.d." : `${b - bp > 0 ? "+" : ""}${formatEuros(b - bp)}`}</td>
                    <td className="wrap tile-foot">{others.length ? others.map(([t, c]) => `type ${t} : ${formatEuros(c)}`).join(" · ") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <details className="panel" data-testid="ms-definitions" id="definitions">
        <summary>Définitions et limites (source DSN)</summary>
        <dl className="defs">
          <div id="def-brut-dsn"><dt>Brut déclaré</dt><dd>Somme des rémunérations S21.G00.51 de type 001 (rémunération brute non plafonnée) des déclarations qui font foi pour chaque mois, tous établissements (sélection du module Données : numéro d'ordre, annule et remplace, fractions). Les autres types de rémunération sont listés sans être additionnés.</dd></div>
          <div id="def-masse-dsn"><dt>Masse chargée</dt><dd>n.d. en source DSN : {ND_CHARGES}.</dd></div>
          <div id="def-mois-dsn"><dt>Mois incomplet, bloqué ou non déposé</dt><dd>Incomplet : un établissement connu n'a pas déclaré ce mois (le brut ne couvre que les établissements déclarés, signalé ⚠). Bloqué ou non déposé : n.d., jamais zéro.</dd></div>
        </dl>
      </details>
    </>
  );
}
