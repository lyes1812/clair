import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SynthesePage from "@/app/e/[slug]/studio-rh/page";
import { MegaMenu } from "@/components/MegaMenu";
import { glossaryEntry } from "@/lib/glossary";
import type { BaseSnapshot, Hypothesis } from "@/lib/budget/types";
import { monthRange } from "@/lib/connectors/months";
import type { JournalInput, LedgerLine, MonthPayroll } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { etpMonthEnd } from "@/lib/rh/kpi/etp";
import type { Delta } from "@/lib/rh/kpi/types";
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
  landingView,
  masseCells,
  ndReasonLines,
  periodLabel,
  presets,
  previousMonths,
  rateTile,
  reasonView,
  resolvePeriod,
  shortReason,
  SYNTHESE_TERMS,
  windowOf,
} from "@/lib/viz/synthese";
import { DSN_ABSENCES, kpiInput } from "./helpers/kpi";
import { dsnFixtureBuild, payfitFixtureBuild } from "./helpers/rh";

// Synthèse du Studio RH : cas de référence écrits à la main (montants en centimes, ETP en dix-millièmes). Les espaces des montants et
// des nombres sont ceux de Intl (insécables) : les comparaisons passent par `flat`.
const flat = (s: string) => s.replace(/\s/g, " ");

const state = vi.hoisted(() => ({
  ctx: null as unknown,
  scenarios: [] as unknown[],
  full: null as unknown,
  budgets: [] as unknown[],
  fail: null as string | null,
}));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: async () => state.ctx }));
vi.mock("@/lib/budget/store", async (orig) => {
  const real = await orig<typeof import("@/lib/budget/store")>();
  return {
    ...real,
    listScenarios: async () => state.scenarios,
    getScenario: async () => {
      if (state.fail) throw new real.BudgetError(state.fail);
      return state.full;
    },
    listBudgets: async () => state.budgets,
  };
});

describe("période : année, premier et dernier mois, périodes rapides", () => {
  const available = [...monthRange("2025-01", "2025-12"), ...monthRange("2026-01", "2026-09")];
  it("par défaut : dernière année, de janvier au dernier mois disponible", () => {
    const p = resolvePeriod(available, {})!;
    expect(p).toMatchObject({ year: 2026, from: "01", to: "09", last: "09", years: [2025, 2026], notices: [] });
    expect(p.months).toEqual(monthRange("2026-01", "2026-09"));
  });
  it("année close : jusqu'à décembre ; mois choisis ; valeur invalide remplacée et signalée", () => {
    expect(resolvePeriod(available, { annee: "2025" })!.months).toHaveLength(12);
    expect(resolvePeriod(available, { annee: "2026", de: "04", a: "06" })!.months).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(resolvePeriod(available, { annee: "2024" })).toMatchObject({ year: 2026, notices: ["paramètre ignoré : annee=2024 (années disponibles : 2025, 2026)"] });
    const inverted = resolvePeriod(available, { de: "07", a: "03" })!;
    expect(inverted.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(inverted.notices).toEqual(["paramètre ignoré : de=07 (après le dernier mois 03)"]);
    const junk = resolvePeriod(available, { de: "13", a: "xx" })!;
    expect(junk.notices).toHaveLength(2);
    expect([junk.from, junk.to]).toEqual(["01", "09"]);
  });
  it("aucun mois disponible : rien à afficher", () => {
    expect(resolvePeriod([], {})).toBeNull();
  });
  it("libellés et mêmes mois un an plus tôt", () => {
    expect(periodLabel(["2026-03"])).toBe("mars 2026");
    expect(periodLabel(monthRange("2026-01", "2026-03"))).toBe("janvier → mars 2026");
    expect(periodLabel(monthRange("2026-01", "2026-12"))).toBe("année 2026");
    expect(periodLabel(monthRange("2026-04", "2026-12"))).toBe("avril → décembre 2026");
    expect(previousMonths(["2026-01", "2026-03"])).toEqual(["2025-01", "2025-03"]);
  });
  it("fenêtre du moteur des KPI sur les mois choisis", () => {
    const months = monthRange("2026-01", "2026-03");
    expect(windowOf(months)).toEqual({ mode: "civil", from: "2026-01", to: "2026-03", months, label: "janvier → mars 2026" });
  });
  it("périodes rapides : jalons jusqu'au dernier mois disponible, plus l'année à ce jour", () => {
    expect(presets("09").map((p) => p.label)).toEqual(["Janv.–mars", "Janv.–juin", "Janv.–sept."]);
    expect(presets("12").map((p) => [p.label, p.a])).toEqual([["Janv.–mars", "03"], ["Janv.–juin", "06"], ["Janv.–sept.", "09"], ["Année entière", "12"]]);
    expect(presets("10").map((p) => p.label)).toEqual(["Janv.–mars", "Janv.–juin", "Janv.–sept.", "Janv.–oct."]);
    expect(presets("02")).toEqual([{ label: "Janv.–févr.", de: "01", a: "02" }]);
    expect(presets("03").map((p) => p.label)).toEqual(["Janv.–mars"]);
  });
});

describe("valeur d'une tuile : exacte, borne basse, n.d. avec sa raison", () => {
  const nd = { kind: "nd" as const, nd: { reason: "mois 2026-03 non couvert" } };
  it("effectif, ETP, moyenne et taux (fractions exactes du moteur)", () => {
    expect(headcountTile({ kind: "exact", persons: 7 })).toEqual({ text: "7", kind: "value", reason: null });
    expect(flat(headcountTile({ kind: "exact", persons: 1234 }).text)).toBe("1 234");
    expect(etpTile({ kind: "exact", etp4: 61000 })).toEqual({ text: "6,10", kind: "value", reason: null });
    expect(etpTile({ kind: "lower_bound", etp4: 61000 })).toEqual({ text: "≥ 6,10", kind: "lower", reason: null });
    expect(averageTile({ kind: "exact", ratio: { num: 27, den: 5 } }).text).toBe("5,40");
    expect(flat(rateTile({ kind: "exact", ratio: { num: 12, den: 83 } }).text)).toBe("14,46 %");
    expect(flat(rateTile({ kind: "lower_bound", ratio: { num: 12, den: 83 } }).text)).toBe("≥ 14,46 %");
  });
  it("valeur absente : « n.d. » et la raison, jamais zéro", () => {
    for (const t of [headcountTile(nd), etpTile(nd), averageTile(nd), rateTile(nd)]) expect(t).toEqual({ text: "n.d.", kind: "nd", reason: "mois 2026-03 non couvert" });
  });
  it("écart d'un indicateur RH : texte signé avec son unité ; n.d. : la raison", () => {
    const etp: Delta = { kind: "exact", unit: "etp", value: { num: 1, den: 2 } };
    expect(deltaView(etp)).toEqual({ text: "+0,50 ETP", reason: null });
    expect(deltaView({ kind: "exact", unit: "points", value: { num: 39, den: 100 } }).text).toBe("+0,39 pts");
    expect(deltaView({ kind: "nd", nd: { code: "previous-nd", reason: "N-1 : trou" } })).toEqual({ text: null, reason: "N-1 : trou" });
  });
  it("raison courte : sans point final, coupée à un mot près", () => {
    expect(shortReason("n.d. ok.")).toBe("n.d. ok");
    expect(shortReason("aaaa bbbb cccc dddd.", 12)).toBe("aaaa bbbb…");
    expect(shortReason("x".repeat(20), 12)).toBe(`${"x".repeat(12)}…`);
  });
  it("raison à l'écran : courte et complète seulement quand elle est coupée (jamais retirée)", () => {
    expect(reasonView("n.d. ok.")).toEqual({ short: "n.d. ok", full: null });
    expect(reasonView("aaaa bbbb cccc dddd.", 12)).toEqual({ short: "aaaa bbbb…", full: "aaaa bbbb cccc dddd" });
    expect(reasonView("x".repeat(20), 12)).toEqual({ short: `${"x".repeat(12)}…`, full: "x".repeat(20) });
  });
  it("refus de calculer : source absente, référentiel indisponible, construction manquante, paramètres illisibles", () => {
    const ok = { chosen: true, sourceReason: "", unavailable: null, hasInput: true, invalid: [] };
    expect(kpiRefusal(ok)).toBeNull();
    expect(kpiRefusal({ ...ok, chosen: false, sourceReason: "Aucune source appliquée pour ce domaine." })).toBe("aucune source RH retenue (Aucune source appliquée pour ce domaine)");
    expect(kpiRefusal({ ...ok, unavailable: "clé refusée." })).toBe("référentiel indisponible : clé refusée");
    expect(kpiRefusal({ ...ok, hasInput: false })).toBe("référentiel RH non construit");
    expect(kpiRefusal({ ...ok, invalid: ["rh.kpi.a", "rh.kpi.b"] })).toBe("paramètres des KPI illisibles : rh.kpi.a, rh.kpi.b");
  });
});

describe("tendance d'un coût : rouge pour une hausse, vert pour une baisse, neutre sinon", () => {
  it("masse chargée : +3 550,00 € sur 100 000,00 € = +3,55 % (hausse, rouge) ; −79,51 € sur 10 000,00 € (baisse, vert)", () => {
    const up = evolutionView({ kind: "value", deltaCents: 355000, ratio: { num: 355000, den: 10000000 } });
    expect(up.tone).toBe("bad");
    expect(flat(up.text!)).toBe("+3 550,00 € (+3,55 %)");
    const down = evolutionView({ kind: "value", deltaCents: -7951, ratio: { num: -7951, den: 1000000 } });
    expect(down.tone).toBe("good");
    expect(flat(down.text!)).toBe("−79,51 € (−0,80 %)");
  });
  it("écart nul : neutre ; N-1 nul : l'écart en euros reste, le pourcentage est n.d. ; période n.d. : la raison", () => {
    const none = evolutionView({ kind: "value", deltaCents: 0, ratio: { num: 0, den: 100 } });
    expect(none.tone).toBe("flat");
    expect(flat(none.text!)).toBe("0,00 € (0,00 %)");
    const zero = evolutionView({ kind: "value", deltaCents: 1000, ratio: null });
    expect(zero.tone).toBe("bad");
    expect(flat(zero.text!)).toBe("+10,00 € (% n.d. : N-1 nul)");
    expect(evolutionView({ kind: "nd", nd: { reason: "période n.d." } })).toEqual({ text: null, tone: "flat", reason: "période n.d." });
  });
  it("coût par ETP-mois : fraction de centimes arrondie au centime (3 000 000 ÷ 7 = 428 571,43 centimes)", () => {
    expect(flat(eurosOfFraction({ num: 3000000, den: 7 }))).toBe("4 285,71 €");
  });
});

describe("atterrissage du dernier scénario face au budget saisi", () => {
  // Atterrissage 2026 = 9 × 7 000,00 € réalisés + 3 × 10 650,00 € projetés = 94 950,00 € ; budget saisi 12 × 8 000,00 € = 96 000,00 €.
  const land = { kind: "value" as const, total: 6300000 + 3 * 1065000 };
  const budget = { total: { kind: "value" as const, cost: 12 * 800000 } };
  it("écart −1 050,00 € (−1,09 %) : baisse du coût, vert", () => {
    const v = landingView(land, budget, { kind: "value", delta: -105000, pct: { num: -105000, den: 9600000 } }, "2026");
    expect(flat(v.value.text)).toBe("94 950,00 €");
    expect(flat(v.budget.text)).toBe("96 000,00 €");
    expect(v.gap.tone).toBe("good");
    expect(flat(v.gap.text!)).toBe("−1 050,00 € (−1,09 %)");
  });
  it("dépassement du budget : hausse du coût, rouge ; budget nul : pourcentage n.d.", () => {
    const v = landingView(land, budget, { kind: "value", delta: 50000, pct: null }, "2026");
    expect(v.gap.tone).toBe("bad");
    expect(flat(v.gap.text!)).toBe("+500,00 € (% n.d. : budget nul)");
  });
  it("sans budget saisi pour l'année : l'atterrissage reste affiché, le budget et l'écart sont n.d. avec la raison", () => {
    const v = landingView(land, null, null, "2026");
    expect(flat(v.value.text)).toBe("94 950,00 €");
    expect(v.budget).toEqual({ text: "n.d.", kind: "nd", reason: "aucun budget saisi pour 2026" });
    expect(v.gap).toEqual({ text: null, tone: "flat", reason: "aucun budget saisi pour 2026" });
  });
  it("atterrissage n.d. (projection refusée) ou mois du budget non saisis : n.d. avec la raison", () => {
    const refused = landingView({ kind: "nd", reason: "projection refusée (hypothèses en erreur)" }, budget, null, "2026");
    expect(refused.value).toMatchObject({ text: "n.d.", reason: "projection refusée (hypothèses en erreur)" });
    expect(refused.gap.reason).toBe("projection refusée (hypothèses en erreur)");
    const partial = landingView(land, { total: { kind: "nd", reason: "montant du budget non saisi (2026-12)" } }, null, "2026");
    expect(partial.budget).toMatchObject({ text: "n.d.", reason: "montant du budget non saisi (2026-12)" });
    expect(partial.gap.reason).toBe("montant du budget non saisi (2026-12)");
    expect(landingView(land, budget, { kind: "nd", reason: "écart n.d." }, "2026").gap).toEqual({ text: null, tone: "flat", reason: "écart n.d." });
  });
});

describe("graphiques : séries et tableaux exacts", () => {
  const value = (month: string, masse: number): MonthPayroll => ({ month, kind: "value", open: false, brut: masse - 120000, cotisations: 120000, masse, byRubric: { salaires: masse - 120000, primes: 0, stages: 0, indemnites: 0, cotisations: 120000, taxes: 0, "provisions-cp": 0, "autres-charges": 0 }, accounts: [], unclassified: [], paidContracts: [] });
  const absent = (month: string): MonthPayroll => ({ month, kind: "nd", open: false, nd: { code: "no-journal", reason: `journal ${month} non renvoyé` } });
  it("masse chargée : 4 200,00 € puis n.d. avec sa raison (jamais 0)", () => {
    const cells = masseCells([value("2026-01", 420000), absent("2026-02")]);
    expect(flat(cells[0].text)).toBe("4 200,00 €");
    expect(cells[1]).toEqual({ text: "n.d.", kind: "nd", reason: "journal 2026-02 non renvoyé" });
  });
  it("ETP de fin de mois : N en trait plein, N-1 en pointillés ; une borne basse n'est pas tracée mais écrite « ≥ x » au tableau", () => {
    const cur = [
      { kind: "exact" as const, etp4: 51000 },
      { kind: "lower_bound" as const, etp4: 61000 },
      { kind: "nd" as const, nd: { reason: "mois non couvert" } },
    ];
    const prev = [48000, 48000, 48000].map((etp4) => ({ kind: "exact" as const, etp4 }));
    const [n, n1] = etpMonthlySeries(cur, prev, { cur: "ETP 2026", prev: "ETP 2025 (N-1)" });
    expect(n.values).toEqual([51000, null, null]);
    expect(n.reasons).toEqual([null, "borne basse, non tracée comme valeur exacte (≥ 6,10 ETP)", "mois non couvert"]);
    expect([n.name, n.color, n.dashed]).toEqual(["ETP 2026", "var(--chart-1)", undefined]);
    expect(n1.values).toEqual([48000, 48000, 48000]);
    expect([n1.name, n1.color, n1.dashed]).toEqual(["ETP 2025 (N-1)", "var(--chart-7)", true]);
    expect(etpCells(cur).map((c) => c.text)).toEqual(["5,10", "≥ 6,10", "n.d."]);
    expect(etpCells(cur)[1].kind).toBe("lower");
  });
  it("raisons des n.d. regroupées par raison identique, mois de chaque série datés ; au-delà de trois, le nombre des autres", () => {
    const a = { key: "a", name: "A", values: [1, null], reasons: [null, "journal absent"] };
    const b = { key: "b", name: "B", values: [1, null], reasons: [null, "journal absent"] };
    expect(ndReasonLines([["2026-01", "2026-02"], ["2025-01", "2025-02"]], [a, b])).toEqual(["févr. 2026, févr. 2025 : journal absent"]);
    expect(capLines(["1", "2", "3", "4", "5"])).toEqual({ shown: ["1", "2", "3"], more: 2 });
    expect(capLines(["1"])).toEqual({ shown: ["1"], more: 0 });
  });
});

describe("glossaire et couleurs", () => {
  it("chaque « ? » de la page renvoie à une entrée existante du glossaire", () => {
    for (const id of Object.values(SYNTHESE_TERMS)) expect(glossaryEntry(id), id).toBeDefined();
  });
  it("la feuille de style n'a que des blancs, gris, noirs et bleus ; rouge et vert ne viennent que de trend-bad / trend-good", () => {
    const css = readFileSync(fileURLToPath(new URL("../../src/styles/synthese.css", import.meta.url)), "utf8");
    expect(css).not.toMatch(/rgba?\(|hsla?\(/);
    for (const [, hex] of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
      expect(b >= r && b >= g, `#${hex} : ni gris ni bleu`).toBe(true);
    }
    expect(css).not.toMatch(/var\(--(bad|good|danger)\)/);
  });
});

// --- Page rendue de bout en bout : référentiel DSN fictif (fixture de septembre 2026), journal écrit à la main, contexte remplacé.
const dsn = kpiInput(dsnFixtureBuild(), DSN_ABSENCES);
let n = 0;
const line = (month: string, accountId: string, debit: number): LedgerLine => ({ key: `${month}#${n++}`, month, accountId, accountName: accountId, debitCents: debit, creditCents: null, contractId: "C1", analytic: [] });
// Janvier à mars : 2026 = 3 000,00 € de salaires + 1 200,00 € de cotisations par mois ; 2025 = 2 700,00 € + 1 080,00 €.
const lines: LedgerLine[] = [];
for (const m of ["2026-01", "2026-02", "2026-03"]) lines.push(line(m, "641100", 300000), line(m, "645100", 120000));
for (const m of ["2025-01", "2025-02", "2025-03"]) lines.push(line(m, "641100", 270000), line(m, "645100", 108000));
const journal: JournalInput = { lines, months: ["2025-01", "2025-02", "2025-03", "2026-01", "2026-02", "2026-03"], openMonths: [], grid: DEFAULT_PREFIXES };

type Over = { role?: string; chosen?: string | null; input?: typeof dsn | null; journal?: JournalInput | null; invalid?: string[]; unavailable?: string | null; payfit?: Awaited<ReturnType<typeof payfitFixtureBuild>> | null };
function makeCtx(over: Over = {}) {
  const input = over.input === undefined ? dsn : over.input;
  const jr = over.journal === undefined ? journal : over.journal;
  const data = over.payfit ? over.payfit : input?.data;
  const payfit = Boolean(over.payfit);
  return {
    kpi: {
      collab: {
        slug: "demo",
        workspace: { id: "w1", name: "Espace fictif", slug: "demo", role: over.role ?? "reader" },
        source: { domain: "rh", mode: "auto", chosen: over.chosen === undefined ? (payfit ? "payfit" : "dsn") : over.chosen, reason: over.chosen === null ? "Aucune source appliquée pour ce domaine." : "Source fictive.", apiApplied: false, filesApplied: true, appliedAt: new Date("2026-10-21T08:00:00Z"), modeSetAt: null, modeSetBy: null },
        data: input ? data : null,
        state: over.unavailable ? { kind: "unavailable", reason: over.unavailable } : { kind: "ready" },
        switchedAt: null,
        payfitHistory: payfit ? { mode: "raw", origin: "default", limit: null } : null,
      },
      settings: { values: input?.params, invalid: over.invalid ?? [], origins: {} },
      input,
      readTypes: [],
    },
    source: over.chosen === null ? null : "dsn",
    input: jr,
    unavailable: jr ? null : "aucune lecture PayFit appliquée : connectez PayFit dans Données",
    read: null,
    etp: (months: string[]) =>
      months.map((month) => {
        const e = input ? etpMonthEnd(input, month) : null;
        return e?.kind === "exact" ? { month, etp4: e.etp4, reason: null } : { month, etp4: null, reason: e && e.kind === "nd" ? e.nd.reason : "référentiel RH indisponible" };
      }),
  };
}
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (html: string) => flat(decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
async function render(search: Record<string, string> = {}) {
  const el = (await SynthesePage({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve(search) })) as ReactElement;
  return { el, html: renderToStaticMarkup(el) };
}
const tile = (html: string, id: string) => {
  const m = new RegExp(`<li[^>]*data-testid="sy-tile-${id}"[^>]*>([\\s\\S]*?)</li>`).exec(html);
  if (!m) throw new Error(`tuile ${id} absente`);
  return { raw: m[1], text: text(m[1]) };
};
function find(node: unknown, pred: (el: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = find(c, pred);
      if (r) return r;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (pred(node)) return node;
  return find((node.props as { children?: unknown }).children, pred);
}
const reset = () => Object.assign(state, { ctx: makeCtx(), scenarios: [], full: null, budgets: [], fail: null });

describe("page : janvier à mars 2026 face à janvier à mars 2025", () => {
  it("indicateurs RH (ETP 5,10 / 6,10 / 6,10 ; N-1 4,80) et masse chargée (12 600,00 € face à 11 340,00 €)", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    // ETP de fin de mars : 6,10 face à 4,80 (+1,30). ETP moyen : (5,10 + 6,10 + 6,10) ÷ 3 = 5,77 face à 4,80 (+0,97).
    expect(tile(html, "etp-fin").text).toContain("6,10 N-1 : 4,80 Écart : +1,30 ETP");
    expect(tile(html, "etp-moyen").text).toContain("5,77 N-1 : 4,80 Écart : +0,97 ETP");
    // Masse chargée : 3 × 4 200,00 € = 12 600,00 € ; N-1 : 3 × 3 780,00 € = 11 340,00 € ; évolution +1 260,00 € = +11,11 %.
    const masse = tile(html, "masse");
    expect(masse.text).toContain("12 600,00 € N-1 : 11 340,00 € Évolution : +1 260,00 € (+11,11 %)");
    expect(masse.raw).toContain('class="sy-delta trend-bad"');
    // Coût par ETP-mois : 1 260 000 centimes ÷ 17,30 ETP-mois = 728,32 € ; N-1 : 1 134 000 ÷ 14,40 = 787,50 €.
    expect(tile(html, "cout-etp").text).toContain("17,30 ETP-mois 728,32 € N-1 : 787,50 €");
    // Un effectif ou un ETP n'est jamais rouge ni vert.
    expect(tile(html, "etp-fin").raw).not.toMatch(/trend-(bad|good)/);
    expect(tile(html, "effectif").raw).not.toMatch(/trend-(bad|good)/);
  });
  it("absentéisme : n.d. avec la raison de la source et un lien vers Données, une seule fois", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    const abs = tile(html, "absenteisme");
    expect(abs.text).toContain("n.d.");
    expect(abs.text.match(/arrêts non extraits de la DSN/g)).toHaveLength(1);
    expect(abs.raw).toContain(`href="/e/demo/donnees"`);
    expect(abs.raw).not.toMatch(/sy-tile-value[^>]*>0/);
  });
  it("légende des tendances présente (une hausse de coût est colorée) ; « ? » vers le glossaire sur chaque tuile", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(html).toContain('data-testid="sy-trend-legend"');
    for (const id of ["effectif", "etp-fin", "etp-moyen", "turnover", "absenteisme", "masse", "cout-etp"]) expect(tile(html, id).raw, id).toContain('class="gloss-link"');
  });
  it("graphiques : masse N / N-1 et ETP N / N-1, avec le tableau exact (période et mois)", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(html).toContain('data-testid="sy-chart-masse"');
    expect(html).toContain('data-testid="sy-chart-etp"');
    const t = text(/data-testid="sy-table-masse"[\s\S]*?<\/details>/.exec(html)![0]);
    expect(t).toContain("janvier 2026 4 200,00 € 3 780,00 €");
    expect(t).toContain("Période 12 600,00 € 11 340,00 €");
    expect(text(/data-testid="sy-table-etp"[\s\S]*?<\/details>/.exec(html)![0])).toContain("janvier 2026 5,10 4,80 février 2026 6,10 4,80 mars 2026 6,10 4,80");
  });
  it("chaque graphique renvoie au glossaire (graphique et tableau exact) ; la clé « n.d. » aussi quand un mois est n.d.", async () => {
    reset();
    const ok = await render({ annee: "2026", de: "01", a: "03" });
    expect(ok.html.match(/href="\/e\/demo\/glossaire#def-lecture-tableau"/g)).toHaveLength(2);
    expect(ok.html).not.toContain("def-lecture-hachure");
    const withNd = await render();
    expect(withNd.html).toContain('href="/e/demo/glossaire#def-lecture-hachure"');
  });
  it("aucune phrase explicative : pas de paragraphe de description ni de formule", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(html).not.toMatch(/colonne hachurée|moyenne des|÷|calculé|permet de|correspond à/i);
  });
});

describe("page : référence de l'année civile 2025 et période par défaut (valeurs des cas de référence du moteur)", () => {
  it("année 2025 : ETP moyen 5,40 et turnover 14,81 % ; défaut : 12 mois glissants à fin septembre 2026, turnover 14,46 %", async () => {
    reset();
    const y = await render({ annee: "2025", de: "01", a: "12" });
    expect(tile(y.html, "etp-moyen").text).toContain("5,40");
    expect(tile(y.html, "turnover").text).toContain("12 mois glissants à fin décembre 2025 14,81 %");
    reset();
    const d = await render();
    expect(text(d.html)).toContain("janvier → septembre 2026 · N-1 : janvier → septembre 2025");
    expect(tile(d.html, "turnover").text).toContain("12 mois glissants à fin septembre 2026 14,46 %");
    expect(tile(d.html, "etp-fin").text).toContain("6,10");
    // Journal de paie absent d'avril à septembre : la masse chargée de la période est n.d., avec les mois en cause.
    expect(tile(d.html, "masse").text).toContain("n.d.");
    expect(tile(d.html, "masse").text).toContain("2026-04");
  });
  it("paramètre invalide : valeur par défaut et avis court", async () => {
    reset();
    const { html } = await render({ annee: "1999" });
    expect(text(html)).toContain("paramètre ignoré : annee=1999 (années disponibles : 2024, 2025, 2026)");
  });
  it("aucune raison de n.d. retirée : la raison complète d'une tuile et les raisons au-delà de trois d'un graphique restent dans la page", async () => {
    reset();
    const { html } = await render();
    // Masse chargée n.d. d'avril à septembre 2026 : la raison courte est coupée, le texte complet est dans le repli de la tuile.
    const masse = tile(html, "masse");
    expect(masse.raw).toMatch(/<details[^>]*data-testid="sy-tile-masse-nd-valeur"/);
    expect(masse.text).toContain("2026-09");
    // Graphique : douze mois n.d. (N et N-1), une raison par mois ; les trois premières sont visibles, les autres repliées mais présentes.
    const nd = /data-testid="sy-chart-masse-nd"[\s\S]*?<\/div>/.exec(html)![0];
    expect(nd).toContain('<details class="sy-more">');
    expect(text(nd)).toContain("avr. 2026");
    expect(text(nd)).toContain("sept. 2026");
    expect(text(nd)).toContain("sept. 2025");
    expect(text(nd)).toMatch(/… et \d+ autres/);
  });
  it("liens vers l'écran KPI RH : les douze mois glissants qui finissent avec la période (même fenêtre que le turnover)", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    for (const id of ["effectif", "etp-fin", "etp-moyen", "turnover", "absenteisme"]) expect(tile(html, id).raw, id).toContain('href="/e/demo/studio-rh/kpi?mode=glissant&amp;fin=2026-03"');
    expect(html).not.toContain("mode=civil");
  });
  it("chaque tableau exact a un nom distinct pour un lecteur d'écran", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    const names = [...html.matchAll(/<summary>Tableau exact<span class="sy-sr"> : ([^<]*)<\/span><\/summary>/g)].map((m) => decode(m[1]));
    expect(names).toEqual(["Masse chargée par mois, 2026 face à 2025 (N-1), en euros", "ETP de fin de mois, 2026 face à 2025 (N-1), en ETP"]);
  });
  it("périodes rapides : la période courante est marquée", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "06" });
    const bar = /data-testid="sy-presets"[\s\S]*?<\/div>/.exec(html)![0];
    expect(bar).toMatch(/aria-current="true"[^>]*>Janv\.–juin/);
    expect(bar).toContain(`href="/e/demo/studio-rh?annee=2026&amp;de=01&amp;a=03"`);
  });
});

describe("page : menu déroulant, rôle, refus de calculer", () => {
  it("le menu « Fonctionnalités » donne les cinq familles et les entrées de l'espace", async () => {
    reset();
    const { el, html } = await render({ annee: "2026", de: "01", a: "03" });
    const menu = find(el, (e) => e.type === MegaMenu);
    expect(menu).not.toBeNull();
    const p = menu!.props as { variant: string; label: string; families: { label: string; href: string; entries: unknown[] }[]; extras: { label: string; href: string }[] };
    expect(p.variant).toBe("page");
    expect(p.label).toBe("Fonctionnalités");
    expect(p.families.map((f) => f.label)).toEqual(["Collaborateurs", "KPI RH", "Masse salariale", "Hypothèses budgétaires", "Reporting social"]);
    expect(p.families.every((f) => f.entries.length > 0)).toBe(true);
    expect(p.extras.map((e) => e.label)).toEqual(["Données", "Paramètres", "Membres et accès", "Glossaire"]);
    expect(html).toContain('data-testid="mega-button-page"');
  });
  it("lecteur : aucune action de modification (un seul formulaire, en lecture, pour la période)", async () => {
    reset();
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toMatch(/<form[^>]*method="get"/);
    expect(html).not.toMatch(/method="post"|formAction|type="submit"[^>]*>(Enregistrer|Supprimer|Synchroniser)/);
  });
  it("aucune source RH : n.d. avec la raison et un lien vers Données ; le libellé du lien dépend du rôle", async () => {
    Object.assign(state, { ctx: makeCtx({ chosen: null, input: null, journal: null }), scenarios: [], full: null, budgets: [], fail: null });
    const reader = await render();
    expect(text(reader.html)).toContain("n.d. Aucune source RH retenue (Aucune source appliquée pour ce domaine)");
    expect(reader.html).toContain('data-testid="mega-button-page"');
    expect(text(reader.html)).toContain("Données →");
    Object.assign(state, { ctx: makeCtx({ chosen: null, input: null, journal: null, role: "editor" }) });
    expect(text((await render()).html)).toContain("Choisir ou lire une source dans Données →");
  });
  it("paramètres des KPI illisibles : indicateurs RH refusés avec le lien vers Paramètres ; la masse chargée reste calculée", async () => {
    Object.assign(state, { ctx: makeCtx({ invalid: ["fullTimeIsOne"] }), scenarios: [], full: null, budgets: [], fail: null });
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    const rh = /data-testid="sy-rh-nd"[\s\S]*?<\/div>/.exec(html)![0];
    expect(text(rh)).toContain("Paramètres des KPI illisibles");
    expect(rh).toContain('href="/e/demo/parametres#kpi"');
    expect(tile(html, "masse").text).toContain("12 600,00 €");
    expect(html).not.toContain('data-testid="sy-tile-etp-fin"');
  });
  it("journal de paie absent : masse et graphique n.d. avec la raison, indicateurs RH inchangés", async () => {
    Object.assign(state, { ctx: makeCtx({ journal: null }), scenarios: [], full: null, budgets: [], fail: null });
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(text(/data-testid="sy-masse-nd"[\s\S]*?<\/div>/.exec(html)![0])).toContain("Aucune lecture PayFit appliquée");
    expect(html).not.toContain('data-testid="sy-chart-masse"');
    expect(tile(html, "etp-fin").text).toContain("6,10");
  });
  it("source PayFit : la limite des quotités à la date de lecture reste écrite, en une ligne", async () => {
    const payfit = await payfitFixtureBuild();
    Object.assign(state, { ctx: makeCtx({ payfit, input: kpiInput(payfit, DSN_ABSENCES) }), scenarios: [], full: null, budgets: [], fail: null });
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(text(/data-testid="sy-limits"[\s\S]*?<\/p>/.exec(html)![0])).toMatch(/Limites de la lecture : historique PayFit tel que renvoyé par l'API · quotités à la date de lecture \(\d{2}\/\d{2}\/\d{4}\)/);
  });
});

describe("page : atterrissage du dernier scénario face au budget saisi", () => {
  // Base de référence du moteur budgétaire : réel janvier–septembre 2026 à 7 000,00 € ; octobre–décembre projetés à 10 650,00 € ;
  // atterrissage 94 950,00 €.
  const contract = (key: string, over: Record<string, unknown>) => ({ contractKey: key, externalId: key, label: key, service: null, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10000, etpNd: null, base: null, baseNd: null, ...over });
  const base = {
    currency: "EUR", refMonth: "2026-09", syncId: "s", readAt: "2026-10-05",
    contracts: [
      contract("A", { service: "TECH", base: { salaryCents: 300000, refBrutCents: 330000, refCotisationsCents: 132000 } }),
      contract("B", { service: "SALES", etp4: 5000, base: { salaryCents: 200000, refBrutCents: 200000, refCotisationsCents: 90000 } }),
      contract("C", { service: "TECH", startDate: "2026-09-16", baseNd: "entré le 2026-09-16 : mois de référence incomplet" }),
    ],
    actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, kind: "value" as const, brut: 500000, cotisations: 200000, masse: 700000, headcount: 3, etp4: 25000, etpNd: null })),
    refMasse: 700000, refBaseCost: null, etpNote: null,
  } as BaseSnapshot;
  const fixC: Hypothesis = { id: "fixC", kind: "base", label: "Base de C", contractKey: "C", salaryCents: 250000, chargesBps: 4200 };
  const scenario = { id: "11111111-1111-4111-8111-111111111111", name: "Budget 2026", kind: "budget", status: "fige", firstMonth: "2026-10", lastMonth: "2026-12", conventions: { prorata: "calendaire" }, createdAt: new Date("2026-10-06T08:00:00Z") };
  const budget = (name: string, monthly: number, updatedAt: string) => ({ id: `${name.length}`.padStart(8, "0") + "-0000-4000-8000-000000000000", name, year: "2026", amounts: Object.fromEntries(monthRange("2026-01", "2026-12").map((m) => [m, monthly])), updatedAt: new Date(updatedAt) });
  const arm = (budgets: unknown[]) => Object.assign(state, { ctx: makeCtx(), scenarios: [{ scenario, refMonth: "2026-09" }], full: { scenario, base, baseHash: "x", hypotheses: [fixC] }, budgets, fail: null });

  it("atterrissage 94 950,00 € face au budget 96 000,00 € : −1 050,00 € (−1,09 %), baisse du coût (vert)", async () => {
    arm([budget("Budget saisi 2026", 800000, "2026-10-07T08:00:00Z")]);
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    const t = tile(html, "atterrissage");
    expect(t.text).toContain("Atterrissage 2026 ? Scénario « Budget 2026 » 94 950,00 €");
    expect(t.text).toContain("Budget saisi « Budget saisi 2026 » : 96 000,00 € ? Écart : −1 050,00 € (−1,09 %)");
    // « ? » du glossaire sur l'atterrissage et sur le budget saisi.
    expect(t.raw).toContain('aria-label="Définition : Budget saisi"');
    expect(t.raw.match(/class="gloss-link"/g)).toHaveLength(2);
    expect(t.raw).toContain('class="sy-delta trend-good"');
    expect(t.raw).toContain("sous=comparaison");
  });
  it("plusieurs budgets de l'année : le plus récemment modifié, nommé dans la tuile", async () => {
    arm([budget("Ancien", 700000, "2026-01-07T08:00:00Z"), budget("Révision d'octobre", 900000, "2026-10-07T08:00:00Z")]);
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(tile(html, "atterrissage").text).toContain("Budget saisi « Révision d'octobre » : 108 000,00 € ? Écart : −13 050,00 €");
  });
  it("sans budget saisi pour l'année : atterrissage affiché, budget n.d. avec sa raison", async () => {
    arm([]);
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    const t = tile(html, "atterrissage");
    expect(t.text).toContain("94 950,00 €");
    expect(t.text).toContain("Budget saisi : n.d.");
    expect(t.text).toContain("aucun budget saisi pour 2026");
    expect(t.raw).not.toMatch(/trend-(bad|good)/);
  });
  it("aucun scénario : pas de tuile ; base figée altérée : le scénario n'est pas lu et l'écran le dit", async () => {
    reset();
    expect((await render({ annee: "2026", de: "01", a: "03" })).html).not.toContain("sy-tile-atterrissage");
    arm([]);
    state.fail = "Base figée altérée : son empreinte ne correspond plus à celle enregistrée à la création.";
    const { html } = await render({ annee: "2026", de: "01", a: "03" });
    expect(html).not.toContain('data-testid="sy-tile-atterrissage"');
    expect(text(/data-testid="sy-landing-error"[\s\S]*?<\/p>/.exec(html)![0])).toContain("Atterrissage non lu : Base figée altérée");
  });
});
