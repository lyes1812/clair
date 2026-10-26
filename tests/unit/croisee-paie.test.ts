import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaieComptaChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChPaieCompta";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import type { CroiseeSetting } from "@/lib/croisee-settings";
import type { DsnMonth } from "@/lib/payroll/dsn";
import { windowPayroll, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { provisionMonth, reconcile, type ComptaLine } from "@/lib/payroll/lot2";
import { cellView, croiseeHref, type CroiseeCell, type CroiseeTable } from "@/lib/viz/croisee";
import {
  buildPaieCompta,
  guardProvision,
  loadPaieComptaInput,
  MEME_PERIODE_N1,
  NON_FILTRABLE_COMPTA,
  NON_FILTRABLE_DSN,
  PAIE_IDS as ID,
  PREVU_PAIE,
  ratioOf,
  SANS_DSN,
  SANS_PRODUITS,
  SEUIL_NON_VERIFIABLE,
  sousSeuil,
  TOTAL_PERIODE,
  type PaieModel,
} from "@/lib/viz/croisee-paie";
import { provisionParts } from "@/lib/viz/masse";

// Masse salariale croisée, chapitre 07 · Paie & comptabilité. Données fictives écrites à la main ; chaque résultat attendu est calculé à
// la main (commentaires). Un n.d. reste n.d. jusqu'au tableau et au graphique, jamais un zéro. Aucun nom de personne.

const sp = (s: string) => s.replace(/\s/g, " ");
const col = (t: CroiseeTable, key: string) => {
  const i = t.columns.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`colonne ${key} absente de ${t.id}`);
  return i;
};
const raw = (t: CroiseeTable, row: number | "foot", key: string): CroiseeCell | undefined => (row === "foot" ? t.foot! : t.rows[row]).cells[col(t, key)];
const shown = (t: CroiseeTable, row: number | "foot", key: string) => {
  const r = row === "foot" ? t.foot! : t.rows[row];
  const i = col(t, key);
  return sp(cellView(r.cells[i], t.columns[i], r).text);
};
const table = (m: PaieModel, id: string) => {
  const t = m.tables.find((x) => x.id === id);
  if (!t) throw new Error(`tableau ${id} absent`);
  return t;
};
const chart = (m: PaieModel, id: string) => {
  const c = m.charts.find((x) => x.id === id);
  if (!c) throw new Error(`graphique ${id} absent`);
  return c;
};
const tile = (m: PaieModel, id: string) => {
  const t = m.tiles.find((x) => x.id === id);
  if (!t) throw new Error(`carte ${id} absente`);
  return t;
};
const block = (m: PaieModel, id: string) => m.blocks.find((b) => b.id === id)!;

// --- Journal fictif (grille par défaut, axe « Service ») : janvier 2026 et janvier 2025 -------------------------------------------
// 2026-01 · A : salaires 1 000 € (contrat-fictif-1) et 200 € (contrat-fictif-3) ; cotisations 400 € ; provision congés payés « Mois
//           courant » 80 € et reprise « Mois précédent » −50 € (6412) ; charges sociales « Mois courant » 30 € (6485).
//         · B : salaires 500 € (contrat-fictif-2) ; cotisations 200 € ; provision 40 € (6412) et 15 € (6485), « Mois courant ».
//         · sans code : titres-restaurant 20 € (6476) ; compte 649100 non classé 3 € ; contrepartie 421000 ignorée.
// 2025-01 · A : salaires 900 € (contrat-fictif-1) ; cotisations 360 € ; provision 70 € (6412) et 28 € (6485), « Mois courant ».
//         · B : salaires 450 € (contrat-fictif-2) ; cotisations 180 € ; provision 35 € (6412) et 14 € (6485), « Mois courant ».
const an = (code: string) => [{ type: "Service", code, value: code }];
const ln = (key: string, month: string, accountId: string, debit: number | null, o: { credit?: number; contract?: string; svc?: string; name?: string } = {}): LedgerLine => ({
  key,
  month,
  accountId,
  accountName: o.name ?? null,
  debitCents: debit,
  creditCents: o.credit ?? null,
  contractId: o.contract ?? null,
  analytic: o.svc ? an(o.svc) : [],
});
const COURANT = "Provision congés payés - Mois courant";
const CHARGES_COURANT = "Charges sociales sur congés payés - Mois courant";
const LINES: LedgerLine[] = [
  ln("n1", "2026-01", "641100", 100000, { contract: "contrat-fictif-1", svc: "A" }),
  ln("n2", "2026-01", "641100", 20000, { contract: "contrat-fictif-3", svc: "A" }),
  ln("n3", "2026-01", "645000", 40000, { svc: "A" }),
  ln("n4", "2026-01", "641200", 8000, { svc: "A", name: COURANT }),
  ln("n5", "2026-01", "641200", null, { credit: 5000, svc: "A", name: "Provision congés payés - Mois précédent" }),
  ln("n6", "2026-01", "648500", 3000, { svc: "A", name: CHARGES_COURANT }),
  ln("n7", "2026-01", "641100", 50000, { contract: "contrat-fictif-2", svc: "B" }),
  ln("n8", "2026-01", "645000", 20000, { svc: "B" }),
  ln("n9", "2026-01", "641200", 4000, { svc: "B", name: COURANT }),
  ln("n10", "2026-01", "648500", 1500, { svc: "B", name: CHARGES_COURANT }),
  ln("n11", "2026-01", "647600", 2000),
  ln("n12", "2026-01", "649100", 300),
  ln("n13", "2026-01", "421000", null, { credit: 243800 }),
  ln("p1", "2025-01", "641100", 90000, { contract: "contrat-fictif-1", svc: "A" }),
  ln("p2", "2025-01", "645000", 36000, { svc: "A" }),
  ln("p3", "2025-01", "641200", 7000, { svc: "A", name: COURANT }),
  ln("p4", "2025-01", "648500", 2800, { svc: "A", name: CHARGES_COURANT }),
  ln("p5", "2025-01", "641100", 45000, { contract: "contrat-fictif-2", svc: "B" }),
  ln("p6", "2025-01", "645000", 18000, { svc: "B" }),
  ln("p7", "2025-01", "641200", 3500, { svc: "B", name: COURANT }),
  ln("p8", "2025-01", "648500", 1400, { svc: "B", name: CHARGES_COURANT }),
];
const JOURNAL: JournalInput = { lines: LINES, months: ["2025-01", "2026-01"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };

// Comptabilité fictive (API Pennylane) : 2026-01 cotisations 590 € (10 € de moins que le journal), le reste identique ; produits
// d'exploitation (706000) 10 000 €. 2025-01 identique au journal ; produits 9 000 €.
const cl = (month: string, accountId: string, debit: number | null, credit: number | null = null): ComptaLine => ({ month, accountId, debitCents: debit, creditCents: credit });
const COMPTA_LINES: ComptaLine[] = [
  cl("2026-01", "641100", 170000),
  cl("2026-01", "645000", 59000),
  cl("2026-01", "641200", 7000),
  cl("2026-01", "648500", 4500),
  cl("2026-01", "647600", 2000),
  cl("2026-01", "649100", 300),
  cl("2026-01", "706000", null, 1000000),
  cl("2025-01", "641100", 135000),
  cl("2025-01", "645000", 54000),
  cl("2025-01", "641200", 10500),
  cl("2025-01", "648500", 4200),
  cl("2025-01", "706000", null, 900000),
];
type ComptaStub = { source: "pennylane" | "fec" | null; reason: string; lines: ComptaLine[]; months: string[]; nd: Record<string, string>; error: boolean };
const COMPTA: ComptaStub = { source: "pennylane", reason: "Choix de l'espace : API Pennylane.", lines: COMPTA_LINES, months: ["2025-01", "2026-01"], nd: {}, error: false };
// DSN fictive : janvier 2026 complète, brut (type 001) 1 680 € ; aucune DSN pour janvier 2025.
const DSN = new Map<string, DsnMonth>([["2026-01", { month: "2026-01", status: "complete", sirets: [], byType: { "001": 168000 }, messages: [] }]]);

type PayStub = { input: JournalInput | null; unavailable: string | null; source: "payfit" | "dsn" | null; dsn: Map<string, DsnMonth> };
const PAY: PayStub = { input: JOURNAL, unavailable: null, source: "payfit", dsn: DSN };
const BASE = "/e/demo/studio-rh/masse-salariale/croisee";
const SEUIL = (value: number): CroiseeSetting<number> => ({ kind: "set", value, updatedAt: null, updatedBy: null });

function fakeCtx(o: { pay?: PayStub; compta?: ComptaStub; service?: string | null; period?: boolean; seuil?: CroiseeSetting<number>; axis?: boolean } = {}): CroiseeContext {
  const state = { chapitre: "paie-compta", annee: "2026", de: "01", a: "01", service: o.service === undefined ? null : o.service === null ? "__nv__" : o.service };
  return {
    slug: "demo",
    canEdit: true,
    period: o.period === false ? null : { year: 2026, from: "01", to: "01", years: [2025, 2026], last: "01", months: ["2026-01"], notices: [] },
    periodNd: o.period === false ? "Aucun mois clos à la date de référence" : null,
    prevMonths: ["2025-01"],
    labels: { period: "janvier 2026", prev: "janvier 2025" },
    openMonths: [],
    service: { axis: o.axis === false ? null : "Service", value: o.service, label: o.service === undefined ? "Tous les services" : (o.service ?? "Non ventilé"), options: [], reason: o.axis === false ? "aucun code analytique dans le journal PayFit" : null },
    settings: { confidentialite: o.seuil ?? SEUIL(2), seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } },
    query: { tri: null, sens: null },
    affichage: "tout",
    href: (patch: Record<string, string | null> = {}, hash?: string) => croiseeHref(BASE, { ...state, ...patch }, hash),
    load: { payroll: async () => o.pay ?? PAY, compta: async () => o.compta ?? COMPTA },
  } as unknown as CroiseeContext;
}
const model = async (o: Parameters<typeof fakeCtx>[0] = {}) => buildPaieCompta(await loadPaieComptaInput(fakeCtx(o)));

describe("passage vers les charges de personnel (tableau et graphique par nature)", () => {
  it("cas de référence : charges de personnel 2 435 € en 2026, 2 037 € en 2025, écart +398 € ; masse identique au moteur", async () => {
    const m = await model();
    const t = table(m, ID.charges);
    // 2026-01 : salaires 1 000 + 200 + 500 = 1 700 € ; cotisations 400 + 200 = 600 € ; masse 2 300 € ; provisions 80 − 50 + 30 + 40 + 15
    // = 115 € ; titres-restaurant 20 € ; total 2 300 + 115 + 20 = 2 435 €. 2025-01 : salaires 1 350 € ; cotisations 540 € ; masse
    // 1 890 € ; provisions 70 + 28 + 35 + 14 = 147 € ; total 2 037 €. Écart 2 435 − 2 037 = +398 €.
    expect(t.rows.map((r) => sp(String(r.cells[0])))).toEqual([
      "Salaires et appointements",
      "Primes",
      "Gratifications de stage",
      "Indemnités et avantages",
      "Rémunération brute",
      "Cotisations patronales",
      "Taxes et contributions sur les salaires",
      "Cotisations patronales et taxes",
      "Masse salariale chargée",
      "Provisions de congés payés",
      "Autres charges de personnel",
    ]);
    expect(raw(t, 0, "n")).toBe(170000);
    expect(raw(t, 8, "n")).toBe(230000);
    expect(raw(t, 8, "n1")).toBe(189000);
    expect(raw(t, 9, "n")).toBe(11500);
    expect(raw(t, 9, "n1")).toBe(14700);
    expect(raw(t, 10, "n")).toBe(2000);
    expect(shown(t, "foot", "n")).toBe("2 435,00 €");
    expect(shown(t, "foot", "n1")).toBe("2 037,00 €");
    expect(shown(t, "foot", "ecart")).toBe("+398,00 €");
    expect(cellView(t.foot!.cells[col(t, "ecart")], t.columns[col(t, "ecart")]).tone).toBe("bad");
    expect(raw(t, 0, "comptes")).toBe("641");
    expect(raw(t, 9, "comptes")).toBe("6412, 6485");
    expect(raw(t, 4, "comptes")).toBe("");
    expect(t.rows[4].style).toBe("subtotal");
    expect(t.rows[0].style).toBe("child");
    // La masse du passage est celle du moteur (même fenêtre, même journal).
    const w = windowPayroll(JOURNAL, ["2026-01"]);
    expect(w.kind === "value" && w.masse).toBe(230000);
    // Somme des lignes de rubrique = total.
    const rub = [0, 1, 2, 3, 5, 6, 9, 10].map((i) => raw(t, i, "n") as number);
    expect(rub.reduce((s, v) => s + v, 0)).toBe(t.foot!.cells[col(t, "n")]);
  });

  it("graphique par nature : mêmes valeurs que les lignes de rubrique du tableau, N et N-1", async () => {
    const c = chart(await model(), ID.chargesNature);
    expect(c.tableId).toBe(ID.charges);
    expect(c.categories).toEqual(["Salaires", "Primes", "Stages", "Indemnités", "Cotisations", "Taxes", "Prov. CP", "Autres"]);
    expect(c.series[0].values).toEqual([170000, 0, 0, 0, 60000, 0, 11500, 2000]);
    expect(c.series[1].values).toEqual([135000, 0, 0, 0, 54000, 0, 14700, 0]);
  });

  it("N-1 non lu : colonnes N-1 et écart n.d. avec la raison, série N-1 sans valeur (jamais 0), total N-1 n.d.", async () => {
    const pay = { ...PAY, input: { ...JOURNAL, months: ["2026-01"] } };
    const m = await model({ pay });
    const t = table(m, ID.charges);
    const why = "janv. 2025 : mois hors de la lecture PayFit appliquée";
    expect(raw(t, 0, "n1")).toEqual({ nd: why });
    expect(shown(t, "foot", "n1")).toBe("n.d.");
    expect(raw(t, "foot", "ecart")).toEqual({ nd: `N-1 n.d. (${why})` });
    const c = chart(m, ID.chargesNature);
    expect(c.series[1].values).toEqual([null, null, null, null, null, null, null, null]);
    expect(c.series[1].reasons?.[0]).toBe(why);
    expect(c.series[0].values[0]).toBe(170000);
    // Provision N-1 : n.d. dans le tableau et dans la courbe N-1.
    const prov = table(m, ID.provisionMois);
    expect(raw(prov, 0, "total-n1")).toEqual({ nd: "mois 2025-01 hors de la lecture PayFit appliquée" });
    expect(chart(m, ID.provisionN1).series[1].values).toEqual([null]);
    // Carte : N-1 et écart n.d.
    const k = tile(m, "charges");
    expect(k.variations?.map((v) => v.text)).toEqual([null, null]);
  });

  it("compte 63/64 non classé : signalé en limite, hors du passage", async () => {
    const m = await model();
    expect(m.limits.some((l) => sp(l).startsWith("Comptes 63 et 64 non classés dans la grille de comptes (1 compte, 3,00 €)"))).toBe(true);
  });
});

describe("journal de paie et comptabilité : mêmes fonctions que l'onglet Paie & comptabilité", () => {
  it("rapprochement par rubrique et par mois (journal 2 438 €, comptabilité 2 428 €, écart +10 €), N-1 sans écart", async () => {
    const m = await model();
    // Référence : reconcile appelé comme l'onglet (journal entier, mêmes mois).
    const ref = reconcile(JOURNAL, COMPTA_LINES, COMPTA.months, ["2026-01"], {});
    expect(ref.kind).toBe("value");
    const r = table(m, ID.reconRubriques);
    // Journal : salaires 1 700, cotisations 600, provisions 115, autres 20, non classé 3 = 2 438 € ; comptabilité : cotisations 590 €.
    expect(r.rows.map((x) => x.cells[0])).toEqual(["Salaires et appointements", "Cotisations patronales", "Provisions de congés payés", "Autres charges de personnel", "Comptes 63 et 64 non classés"]);
    expect(raw(r, 1, "ecart")).toBe(1000);
    expect(shown(r, "foot", "journal")).toBe("2 438,00 €");
    expect(shown(r, "foot", "compta")).toBe("2 428,00 €");
    expect(shown(r, "foot", "ecart")).toBe("+10,00 €");
    // Écart de rapprochement : pas une tendance de coût (neutre).
    expect(cellView(r.foot!.cells[col(r, "ecart")], r.columns[col(r, "ecart")]).tone).toBe("flat");
    expect(ref.kind === "value" && ref.ecart).toBe(1000);
    const mo = table(m, ID.reconMois);
    expect(mo.rows.map((x) => sp(String(x.cells[0])))).toEqual(["Janvier 2026", TOTAL_PERIODE, MEME_PERIODE_N1]);
    expect(raw(mo, 0, "ecart")).toBe(1000);
    // N-1 : journal 1 350 + 540 + 147 = 2 037 € = comptabilité ; écart 0 €.
    expect(raw(mo, 2, "journal")).toBe(203700);
    expect(raw(mo, 2, "ecart")).toBe(0);
    expect(chart(m, ID.reconMois).series.map((s) => s.values)).toEqual([[243800], [242800]]);
    expect(chart(m, ID.reconRubriques).categories).toEqual(["Salaires", "Cotisations", "Prov. CP", "Autres", "Non classés"]);
    expect(block(m, "comptabilite").notes).toEqual(["Source comptable : API Pennylane · Choix de l'espace : API Pennylane"]);
    const k = tile(m, "ecart-compta");
    expect(sp(k.value.text)).toBe("+10,00 €");
    expect(sp(k.variations![0].text!)).toBe("0,00 €");
  });

  it("masse salariale ÷ produits d'exploitation : 23,00 % (2 300 € ÷ 10 000 €), N-1 21,00 % (1 890 € ÷ 9 000 €)", async () => {
    const m = await model();
    const t = table(m, ID.ratio);
    expect(raw(t, 0, "n")).toBe(230000);
    expect(raw(t, 1, "n")).toBe(1000000);
    expect(shown(t, 2, "n")).toBe("23,00 %");
    expect(shown(t, 2, "n1")).toBe("21,00 %");
    expect(sp(tile(m, "ratio").value.text)).toBe("23,00 %");
    expect(sp(tile(m, "ratio").variations![0].text!)).toBe("21,00 %");
    expect(ratioOf(230000, 0)).toEqual({ nd: SANS_PRODUITS });
    expect(ratioOf({ nd: "x" }, 10)).toEqual({ nd: "x" });
  });

  it("sans source comptable, en erreur, ou mois non couvert : une seule raison, rapprochement et ratio n.d.", async () => {
    const none = await model({ compta: { ...COMPTA, source: null, reason: "Aucune source appliquée pour ce domaine." } });
    expect(block(none, "comptabilite").nd[0].reason).toBe("aucune source comptable retenue pour ce domaine");
    expect(block(none, "comptabilite").tables).toEqual([]);
    expect(tile(none, "ratio").value.kind).toBe("nd");
    expect(tile(none, "ecart-compta").value.reason).toBe("aucune source comptable retenue pour ce domaine");
    const err = await model({ compta: { ...COMPTA, error: true } });
    expect(block(err, "comptabilite").nd[0].reason).toMatch(/^lecture de la comptabilité en erreur/);
    const gap = await model({ compta: { ...COMPTA, months: ["2025-01"], nd: { "2026-01": "mois non terminé à la lecture Pennylane du 2026-01-20" } } });
    expect(block(gap, "comptabilite").nd[0].reason).toBe("mois non terminé à la lecture Pennylane du 2026-01-20 pour 2026-01 (source comptable : API Pennylane)");
    // N-1 non couvert : le rapprochement N reste calculé, la ligne N-1 et le ratio N-1 sont n.d.
    const prev = await model({ compta: { ...COMPTA, months: ["2026-01"] } });
    const mo = table(prev, ID.reconMois);
    expect(raw(mo, 2, "journal")).toEqual({ nd: "comptabilité non lue pour 2025-01" });
    expect(raw(table(prev, ID.ratio), 1, "n1")).toEqual({ nd: "comptabilité non lue pour 2025-01" });
  });
});

describe("journal de paie et DSN", () => {
  it("brut du journal 1 700 € face au brut DSN 1 680 € : écart +20 € ; N-1 sans DSN : n.d. avec la raison", async () => {
    const m = await model();
    const t = table(m, ID.dsn);
    expect(t.rows.map((r) => sp(String(r.cells[0])))).toEqual(["Janvier 2026", TOTAL_PERIODE, MEME_PERIODE_N1]);
    expect(shown(t, 0, "journal")).toBe("1 700,00 €");
    expect(shown(t, 0, "dsn")).toBe("1 680,00 €");
    expect(shown(t, 0, "ecart")).toBe("+20,00 €");
    expect(raw(t, 0, "etat")).toBe("complète");
    expect(raw(t, 2, "journal")).toBe(135000);
    expect(raw(t, 2, "dsn")).toEqual({ nd: "2025-01 : aucune DSN retenue" });
    expect(shown(t, 2, "ecart")).toBe("n.d.");
    const k = tile(m, "ecart-dsn");
    expect(sp(k.value.text)).toBe("+20,00 €");
    expect(k.variations![0]).toMatchObject({ text: null, reason: "2025-01 : aucune DSN retenue" });
  });

  it("aucune DSN pour ces mois : bloc n.d. avec un lien vers Données › DSN", async () => {
    const m = await model({ pay: { ...PAY, dsn: new Map() } });
    expect(block(m, "dsn").nd[0]).toEqual({ reason: SANS_DSN, action: { href: "/e/demo/donnees/dsn", label: "Données › DSN" } });
    expect(tile(m, "ecart-dsn").value).toMatchObject({ kind: "nd", reason: SANS_DSN });
  });
});

describe("provision de congés payés", () => {
  it("fin janvier 2026 : 165 € (congés payés 120 € + charges sociales 45 €), fin janvier 2025 : 147 €, écart +18 €", async () => {
    const m = await model();
    // Dotations « Mois courant » 2026-01 : congés payés 80 + 40 = 120 € ; charges 30 + 15 = 45 € (la reprise « Mois précédent » n'entre
    // pas dans le stock). 2025-01 : 70 + 35 = 105 € et 28 + 14 = 42 €, total 147 €.
    const t = table(m, ID.provisionMois);
    expect(shown(t, 0, "total")).toBe("165,00 €");
    expect(shown(t, 0, "total-n1")).toBe("147,00 €");
    expect(shown(t, 0, "ecart")).toBe("+18,00 €");
    expect(shown(t, 0, "conges")).toBe("120,00 €");
    expect(shown(t, 0, "charges")).toBe("45,00 €");
    // Mêmes valeurs que provisionMonth (fonction de l'onglet) et que ses séries.
    const ref = provisionMonth(JOURNAL, "2026-01");
    expect(ref.kind === "value" && ref.total).toBe(16500);
    expect(chart(m, ID.provisionParts).series).toEqual(provisionParts([ref]));
    const k = tile(m, "provision");
    expect(k.label).toBe("Provision fin janvier 2026");
    expect(sp(k.value.text)).toBe("165,00 €");
    expect(sp(k.sub!)).toBe("congés payés 120,00 € + charges sociales 45,00 €");
    expect(k.variations!.map((v) => [v.label, v.text && sp(v.text)])).toEqual([["Fin janvier 2025", "147,00 €"], ["Écart", "+18,00 €"]]);
    expect(k.variations![1].tone).toBe("bad");
  });

  it("par service, seuil de 2 personnes : A affiché en N (2 contrats rémunérés), n.d. en N-1 (1) ; B et non ventilé n.d. ; total complet", async () => {
    const m = await model();
    const t = table(m, ID.provisionServices);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "B", "Non ventilé"]);
    // A, fin janvier 2026 : 80 + 30 = 110 €.
    expect(raw(t, 0, "total")).toBe(11000);
    expect(raw(t, 0, "total-n1")).toEqual({ nd: sousSeuil(2) });
    expect(raw(t, 0, "ecart")).toEqual({ nd: "écart non calculable : provision n.d." });
    expect(raw(t, 1, "total")).toEqual({ nd: sousSeuil(2) });
    expect(raw(t, 2, "conges")).toEqual({ nd: sousSeuil(2) });
    expect(sousSeuil(2)).toBe("service de moins de 2 personnes : non affiché (seuil de confidentialité)");
    expect(shown(t, "foot", "total")).toBe("165,00 €");
    expect(shown(t, "foot", "total-n1")).toBe("147,00 €");
    expect(shown(t, "foot", "ecart")).toBe("+18,00 €");
    // Seuil 1 : tout est affiché.
    const all = table(await model({ seuil: SEUIL(1) }), ID.provisionServices);
    expect(raw(all, 1, "total")).toBe(5500);
    expect(raw(all, 0, "total-n1")).toBe(9800);
  });

  it("seuil de confidentialité absent ou illisible : provision par service n.d. avec le lien vers Paramètres ; le reste du bloc est calculé", async () => {
    const m = await model({ seuil: { kind: "absent" } });
    expect(m.tables.some((t) => t.id === ID.provisionServices)).toBe(false);
    expect(block(m, "provision").nd).toEqual([{ label: "Provision par service", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: "/e/demo/parametres#croisee", label: "Paramètres" }, tableOnly: true }]);
    expect(table(m, ID.provisionMois).rows).toHaveLength(1);
    const bad = await model({ seuil: { kind: "invalid", raw: "2" } });
    expect(block(bad, "provision").nd[0].reason).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
  });

  it("sans axe de service : provision par service n.d. avec la raison de l'axe", async () => {
    const m = await model({ axis: false });
    expect(block(m, "provision").nd[0]).toMatchObject({ label: "Provision par service", reason: "aucun code analytique dans le journal PayFit" });
  });

  it("guardProvision : effectif inconnu ⇒ seuil non vérifiable ; mois n.d. garde sa raison ; à partir du seuil, valeurs", () => {
    const v = provisionMonth(JOURNAL, "2026-01");
    expect(guardProvision(v, null, 3).total).toEqual({ nd: SEUIL_NON_VERIFIABLE });
    expect(guardProvision(v, 3, 3).total).toBe(16500);
    expect(guardProvision({ month: "2024-01", kind: "nd", reason: "mois hors lecture" }, null, 3).total).toEqual({ nd: "mois hors lecture" });
  });
});

describe("filtre de service et chapitre non calculable", () => {
  it("service A : passage et provision du service ; comptabilité et DSN n.d. « non filtrables par service » avec retrait du filtre", async () => {
    const m = await model({ service: "A" });
    // A, 2026-01 : salaires 1 200 € + cotisations 400 € = 1 600 € ; provisions 80 − 50 + 30 = 60 € ; total 1 660 €.
    const t = table(m, ID.charges);
    expect(raw(t, 8, "n")).toBe(160000);
    expect(raw(t, "foot", "n")).toBe(166000);
    expect(tile(m, "provision").value.text.replace(/\s/g, " ")).toBe("110,00 €");
    const href = croiseeHref(BASE, { chapitre: "paie-compta", annee: "2026", de: "01", a: "01" });
    expect(block(m, "comptabilite").nd[0]).toEqual({ reason: NON_FILTRABLE_COMPTA, action: { href, label: "Retirer le filtre Service" } });
    expect(block(m, "dsn").nd[0].reason).toBe(NON_FILTRABLE_DSN);
    expect(m.tables.some((x) => x.id === ID.provisionServices)).toBe(false);
    expect(block(m, "provision").nd).toEqual([]);
  });

  it("sans période, ou source RH = DSN : chapitre n.d. avec la raison et le lien vers Données", async () => {
    const none = await model({ period: false });
    expect(none.nd).toEqual({ reason: "Aucun mois clos à la date de référence", action: { href: "/e/demo/donnees", label: "Choisir ou lire une source dans Données" } });
    expect(none.tiles).toEqual([]);
    const dsn = await model({ pay: { ...PAY, input: null, source: "dsn" } });
    expect(dsn.nd?.reason).toBe("source RH retenue : DSN — journal de paie PayFit non lu");
  });

  it("blocs « Prévu » : décaissements par créancier, estimation des décaissements, provisions de RTT et de primes", async () => {
    const m = await model();
    expect(m.prevu.map((x) => x.id)).toEqual(["paie-compta-decaissements", "paie-compta-decaissements-estimes", "paie-compta-provisions-rtt-primes"]);
    expect(PREVU_PAIE[2].reason).toBe("le journal ne provisionne que les congés payés");
  });
});

describe("rendu du chapitre (écran = modèle)", () => {
  const render = (m: PaieModel, affichage: Affichage = "tout") => renderToStaticMarkup(h(PaieComptaChapter, { model: m, slug: "demo", affichage, tableauHref: `${BASE}?chapitre=paie-compta&affichage=tableau` }));

  it("« Afficher tout » : cartes, graphiques, tableaux exacts, Prévu, limites ; aucun identifiant de contrat", async () => {
    const html = render(await model());
    for (const id of ["charges", "ecart-compta", "ecart-dsn", "provision", "ratio"]) expect(html).toContain(`data-testid="cx-tile-paie-compta-${id}"`);
    for (const id of [ID.charges, ID.reconRubriques, ID.reconMois, ID.ratio, ID.dsn, ID.provisionMois, ID.provisionServices]) expect(html).toContain(`data-testid="cx-table-${id}"`);
    for (const id of [ID.chargesNature, ID.reconMois, ID.reconRubriques, ID.provisionParts, ID.provisionN1]) expect(html).toContain(`data-testid="cx-chart-${id}"`);
    for (const p of PREVU_PAIE) expect(html).toContain(`data-testid="cx-prevu-${p.id}"`);
    expect(html).toContain('id="cx-paie-compta-charges"');
    expect(html).toContain('id="cx-paie-compta-provision"');
    expect(html).toContain('data-testid="cx-paie-compta-limites"');
    expect(html).not.toContain("contrat-fictif");
    // Identifiants de la page uniques (ancres des blocs, tableaux et graphiques).
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]);
    expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
  });

  it("« Graphiques » : aucun tableau, bloc DSN (sans graphique) absent, lien vers le tableau exact ; « Tableaux » : aucun graphique", async () => {
    const m = await model();
    const g = render(m, "graphique");
    expect(g).not.toContain('data-testid="cx-table-');
    expect(g).not.toContain('data-testid="cx-paie-compta-dsn"');
    expect(g).toContain(`data-testid="cx-chart-${ID.chargesNature}-tableau"`);
    expect(g).toContain(`affichage=tableau#cx-table-${ID.charges}`);
    expect(g).not.toContain('data-testid="cx-paie-compta-prevu"');
    const t = render(m, "tableau");
    expect(t).not.toContain('data-testid="cx-chart-');
    expect(t).toContain(`data-testid="cx-table-${ID.dsn}"`);
  });

  it("seuil absent : mention n.d. et lien Paramètres en « Tableaux », masquée en « Graphiques » ; un n.d. s'écrit « n.d. », jamais 0", async () => {
    const m = await model({ seuil: { kind: "absent" } });
    const t = render(m, "tableau");
    expect(t).toContain('data-testid="cx-paie-compta-provision-nd"');
    expect(t).toContain('href="/e/demo/parametres#croisee"');
    expect(render(m, "graphique")).not.toContain('data-testid="cx-paie-compta-provision-nd"');
    const nd = render(await model({ pay: { ...PAY, input: { ...JOURNAL, months: ["2026-01"] } } }), "tableau");
    expect(nd).toContain('<abbr class="nd" title="janv. 2025 : mois hors de la lecture PayFit appliquée">n.d.</abbr>');
  });

  it("chapitre n.d. : l'état n.d. et sa raison, rien d'autre", async () => {
    const html = render(await model({ period: false }));
    expect(html).toContain('data-testid="cx-paie-compta-nd"');
    expect(html).toContain("Aucun mois clos à la date de référence");
    expect(html).not.toContain("cx-tile-");
  });
});
