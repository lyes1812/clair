import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaieComptaChapter } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChPaieCompta";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import type { Affichage } from "@/app/e/[slug]/studio-rh/masse-salariale/components";
import { confidentialiteReason, type PersonLink, type PersonsOfContracts } from "@/lib/confidentialite";
import type { CroiseeSetting } from "@/lib/croisee-settings";
import { glossaryEntry } from "@/lib/glossary";
import type { DsnMonth } from "@/lib/payroll/dsn";
import { monthPayroll, windowPayroll, withService, type JournalInput, type LedgerLine } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { provisionMonth, reconcile, type ComptaLine } from "@/lib/payroll/lot2";
import { cellView, croiseeHref, type CroiseeCell, type CroiseeTable } from "@/lib/viz/croisee";
import {
  buildPaieCompta,
  guardProvision,
  loadPaieComptaInput,
  maskedWindow,
  maskServices,
  MEME_PERIODE_N1,
  NON_FILTRABLE_COMPTA,
  NON_FILTRABLE_DSN,
  PAIE_CX_TERMS,
  PAIE_IDS as ID,
  paieComptaModel,
  passageContracts,
  passageGroup,
  passageStatus,
  PREVU_PAIE,
  PROVISION_SERVICES_LIMITE,
  provisionContracts,
  provisionGroup,
  ratioOf,
  SANS_DSN,
  SANS_PRODUITS,
  SERVICE_RETENU_LIMITE,
  SEUIL_NON_VERIFIABLE,
  sousSeuil,
  TOTAL_PERIODE,
  windowReason,
  type MaskStatus,
  type PaieModel,
  type WindowIn,
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
// Tous les montants que le modèle publie (cellules, séries, textes des cartes) : pour vérifier qu'une valeur masquée n'y est nulle part.
const published = (m: PaieModel): { numbers: number[]; texts: string[] } => {
  const numbers: number[] = [];
  for (const t of m.tables) for (const r of [...t.rows, ...(t.foot ? [t.foot] : [])]) for (const c of r.cells) if (typeof c === "number") numbers.push(c);
  for (const c of m.charts) for (const s of c.series) for (const v of s.values) if (typeof v === "number") numbers.push(v);
  const texts = m.tiles.flatMap((k) => [k.value.text, k.sub ?? "", ...(k.variations ?? []).map((v) => v.text ?? "")]).map(sp);
  return { numbers, texts };
};

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

// --- Journal fictif du seuil de confidentialité (seuil 2) : A = 3 contrats, B = 1, « Non ventilé » sans contrat -----------------------
// Comme dans PayFit, chaque ligne de dotation de la provision porte son contrat (dot : une ligne par contrat) ; les lignes de
// cotisations de ces fixtures n'en portent pas. Taille d'un groupe : provision = contrats des lignes de dotation ; passage = contrats
// de toute ligne de charges de personnel.
// 2026-01 · A : salaires 3 × 1 000 € (contrat-fictif-a1, a2, a3) ; cotisations 1 200 € ; provision « Mois courant » 3 × 30 € (6412)
//           + 3 × 10 € (6485) = 120 € (contrats a1, a2, a3). Passage : 3 000 + 1 200 + 120 = 4 320 €.
//         · B : salaires 800 € (contrat-fictif-b1) ; cotisations 320 € ; provision 40 € (6412) + 10 € (6485) = 50 € (b1). Passage
//           1 170 €.
//         · sans code (« Non ventilé ») : titres-restaurant 60 € (6476) sans contrat ; aucune ligne de provision (0 €, 0 contrat).
//         Toute l'entreprise : provision 130 € (congés payés) + 40 € (charges sociales) = 170 €.
// 2025-01 · A : salaires 2 × 1 000 € (a1, a2) ; cotisations 800 € ; provision 2 × 35 € (6412) + 2 × 10 € (6485) = 90 € (a1, a2).
//         · B : salaires 2 × 700 € (b1, b2) ; cotisations 560 € ; provision 2 × 26 € (6412) + 2 × 6,50 € (6485) = 65 € (b1, b2).
//         Toute l'entreprise : provision 122 € + 33 € = 155 €.
// Lignes de dotation « Mois courant » d'un service, une par contrat : [contrat, montant en centimes] (null : ligne sans contrat).
const dot = (key: string, month: string, accountId: string, svc: string | undefined, parts: [string | null, number][]): LedgerLine[] =>
  parts.map(([contract, cents], i) => ln(`${key}-${i + 1}`, month, accountId, cents, { contract: contract ?? undefined, svc, name: accountId.startsWith("6412") ? COURANT : CHARGES_COURANT }));
const SEUIL_LINES: LedgerLine[] = [
  ln("s1", "2026-01", "641100", 100000, { contract: "contrat-fictif-a1", svc: "A" }),
  ln("s2", "2026-01", "641100", 100000, { contract: "contrat-fictif-a2", svc: "A" }),
  ln("s3", "2026-01", "641100", 100000, { contract: "contrat-fictif-a3", svc: "A" }),
  ln("s4", "2026-01", "645000", 120000, { svc: "A" }),
  ...dot("s5", "2026-01", "641200", "A", [["contrat-fictif-a1", 3000], ["contrat-fictif-a2", 3000], ["contrat-fictif-a3", 3000]]),
  ...dot("s6", "2026-01", "648500", "A", [["contrat-fictif-a1", 1000], ["contrat-fictif-a2", 1000], ["contrat-fictif-a3", 1000]]),
  ln("s7", "2026-01", "641100", 80000, { contract: "contrat-fictif-b1", svc: "B" }),
  ln("s8", "2026-01", "645000", 32000, { svc: "B" }),
  ...dot("s9", "2026-01", "641200", "B", [["contrat-fictif-b1", 4000]]),
  ...dot("s10", "2026-01", "648500", "B", [["contrat-fictif-b1", 1000]]),
  ln("s11", "2026-01", "647600", 6000),
  ln("t1", "2025-01", "641100", 100000, { contract: "contrat-fictif-a1", svc: "A" }),
  ln("t2", "2025-01", "641100", 100000, { contract: "contrat-fictif-a2", svc: "A" }),
  ln("t3", "2025-01", "645000", 80000, { svc: "A" }),
  ...dot("t4", "2025-01", "641200", "A", [["contrat-fictif-a1", 3500], ["contrat-fictif-a2", 3500]]),
  ...dot("t5", "2025-01", "648500", "A", [["contrat-fictif-a1", 1000], ["contrat-fictif-a2", 1000]]),
  ln("t6", "2025-01", "641100", 70000, { contract: "contrat-fictif-b1", svc: "B" }),
  ln("t7", "2025-01", "641100", 70000, { contract: "contrat-fictif-b2", svc: "B" }),
  ln("t8", "2025-01", "645000", 56000, { svc: "B" }),
  ...dot("t9", "2025-01", "641200", "B", [["contrat-fictif-b1", 2600], ["contrat-fictif-b2", 2600]]),
  ...dot("t10", "2025-01", "648500", "B", [["contrat-fictif-b1", 650], ["contrat-fictif-b2", 650]]),
];
const JOURNAL_SEUIL: JournalInput = { ...JOURNAL, lines: SEUIL_LINES };
// Variante : un service C de 2 contrats (c1, c2) en 2026-01, salaires 2 × 1 000 €, cotisations 800 €, provision 2 × 75 € + 2 × 25 € =
// 200 € (c1, c2) ; passage 2 000 + 800 + 200 = 3 000 €. Toute l'entreprise 2026-01 : provision 280 € + 90 € = 370 €.
const C_LINES: LedgerLine[] = [
  ln("c1", "2026-01", "641100", 100000, { contract: "contrat-fictif-c1", svc: "C" }),
  ln("c2", "2026-01", "641100", 100000, { contract: "contrat-fictif-c2", svc: "C" }),
  ln("c3", "2026-01", "645000", 80000, { svc: "C" }),
  ...dot("c4", "2026-01", "641200", "C", [["contrat-fictif-c1", 7500], ["contrat-fictif-c2", 7500]]),
  ...dot("c5", "2026-01", "648500", "C", [["contrat-fictif-c1", 2500], ["contrat-fictif-c2", 2500]]),
];
const JOURNAL_SEUIL_C: JournalInput = { ...JOURNAL, lines: [...SEUIL_LINES, ...C_LINES] };
// Cas de la relecture (seuil 3) : A = 3 contrats payés ; B = 1 contrat SANS brut (congé non rémunéré, par exemple) qui porte sa
// dotation « Mois courant » : 150 € (6412) + 60 € (6485) = 210 € (contrat-fictif-b9). Seul janvier 2026 est lu.
// 2026-01 · A : salaires 3 × 1 000 € ; cotisations 1 200 € ; provision 3 × 30 € + 3 × 10 € = 120 €. Passage A 4 320 €, B 210 €.
//         Toute l'entreprise : provision 120 + 210 = 330 € (congés payés 90 + 150 = 240 € ; charges sociales 30 + 60 = 90 €).
// Avec la taille comptée sur le brut, B comptait 0 contrat et sa provision (celle d'une seule personne) restait affichée.
const SANS_BRUT_A: LedgerLine[] = SEUIL_LINES.filter((l) => l.month === "2026-01" && l.analytic?.some((a) => a.code === "A"));
const JOURNAL_SANS_BRUT: JournalInput = {
  ...JOURNAL,
  months: ["2026-01"],
  lines: [...SANS_BRUT_A, ...dot("u1", "2026-01", "641200", "B", [["contrat-fictif-b9", 15000]]), ...dot("u2", "2026-01", "648500", "B", [["contrat-fictif-b9", 6000]])],
};
// Variante : les mêmes lignes de B, sans contrat rattaché (taille 0, provision non nulle).
const JOURNAL_SANS_CONTRAT: JournalInput = {
  ...JOURNAL_SANS_BRUT,
  lines: [...SANS_BRUT_A, ...dot("u1", "2026-01", "641200", "B", [[null, 15000]]), ...dot("u2", "2026-01", "648500", "B", [[null, 6000]])],
};

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
const pay = (input: JournalInput): PayStub => ({ ...PAY, input });
const BASE = "/e/demo/studio-rh/masse-salariale/croisee";
const SEUIL = (value: number): CroiseeSetting<number> => ({ kind: "set", value, updatedAt: null, updatedBy: null });
type Period = { months: string[]; prevMonths: string[]; from: string; to: string; period: string; prev: string };
const JANVIER: Period = { months: ["2026-01"], prevMonths: ["2025-01"], from: "01", to: "01", period: "janvier 2026", prev: "janvier 2025" };

// Lien contrat → jeton de personne du référentiel : chaque contrat fictif a sa propre personne (les cas où deux contrats portent la
// même personne, ou un contrat n'est pas relié, passent leur propre lien).
const CONTRACTS = ["contrat-fictif-1", "contrat-fictif-2", "contrat-fictif-3", "contrat-fictif-a1", "contrat-fictif-a2", "contrat-fictif-a3", "contrat-fictif-a8", "contrat-fictif-a9", "contrat-fictif-b1", "contrat-fictif-b2", "contrat-fictif-b9", "contrat-fictif-c1", "contrat-fictif-c2", "contrat-fictif-e1", "contrat-fictif-e2", "contrat-fictif-e3", "contrat-fictif-n1"];
const LINK: PersonLink = new Map(CONTRACTS.map((c) => [c, `personne-${c.slice("contrat-fictif-".length)}`]));
const G = (persons: string[], unlinked = 0): PersonsOfContracts => ({ persons, unlinked });
const CONF_HREF = "/e/demo/parametres#confidentialite";
type CtxOptions = { pay?: PayStub; compta?: ComptaStub; service?: string | null; period?: boolean | Period; seuil?: CroiseeSetting<number>; axis?: boolean; openMonths?: string[]; onPayroll?: () => void; link?: PersonLink };
function fakeCtx(o: CtxOptions = {}): CroiseeContext {
  const per = typeof o.period === "object" ? o.period : JANVIER;
  const state = { chapitre: "paie-compta", annee: "2026", de: per.from, a: per.to, service: o.service === undefined ? null : o.service === null ? "__nv__" : o.service };
  return {
    slug: "demo",
    canEdit: true,
    period: o.period === false ? null : { year: 2026, from: per.from, to: per.to, years: [2025, 2026], last: per.to, months: per.months, notices: [] },
    periodNd: o.period === false ? "Aucun mois clos à la date de référence" : null,
    prevMonths: per.prevMonths,
    labels: { period: per.period, prev: per.prev },
    openMonths: o.openMonths ?? [],
    service: { axis: o.axis === false ? null : "Service", value: o.service, label: o.service === undefined ? "Tous les services" : (o.service ?? "Non ventilé"), options: [], reason: o.axis === false ? "aucun code analytique dans le journal PayFit" : null },
    settings: { confidentialite: o.seuil ?? SEUIL(2), seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } },
    query: { tri: null, sens: null },
    affichage: "tout",
    href: (patch: Record<string, string | null> = {}, hash?: string) => croiseeHref(BASE, { ...state, ...patch }, hash),
    load: {
      payroll: async () => {
        o.onPayroll?.();
        return o.pay ?? PAY;
      },
      compta: async () => o.compta ?? COMPTA,
      persons: async () => o.link ?? LINK,
    },
  } as unknown as CroiseeContext;
}
const model = async (o: CtxOptions = {}) => buildPaieCompta(await loadPaieComptaInput(fakeCtx(o)));

describe("passage vers les charges de personnel (tableau et graphique par nature)", () => {
  it("cas de référence : charges de personnel 2 435 € en janvier 2026, 2 037 € en janvier 2025, écart +398 € ; masse identique au moteur", async () => {
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
    // En-têtes de période (D4) : le libellé de la période et de N-1, jamais l'année seule.
    expect(t.columns.map((c) => c.header)).toEqual(["Journal de paie", "Janvier 2026", "N-1 (janvier 2025)", "Écart", "Comptes de la grille"]);
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
    // Carte : période écrite sous le libellé.
    expect(tile(m, "charges").sub).toBe("janvier 2026");
  });

  it("graphique par nature : mêmes valeurs que les lignes de rubrique du tableau, N et N-1 ; séries nommées par la période", async () => {
    const c = chart(await model(), ID.chargesNature);
    expect(c.tableId).toBe(ID.charges);
    expect(c.categories).toEqual(["Salaires", "Primes", "Stages", "Indemnités", "Cotisations", "Taxes", "Prov. CP", "Autres"]);
    expect(c.categoryTitles?.[0]).toBe("Salaires et appointements");
    expect(c.series.map((s) => s.name)).toEqual(["Janvier 2026", "N-1 (janvier 2025)"]);
    expect(c.series[0].values).toEqual([170000, 0, 0, 0, 60000, 0, 11500, 2000]);
    expect(c.series[1].values).toEqual([135000, 0, 0, 0, 54000, 0, 14700, 0]);
  });

  it("N-1 non lu : colonnes N-1 et écart n.d. avec la raison, série N-1 sans valeur (jamais 0), total N-1 n.d.", async () => {
    const m = await model({ pay: pay({ ...JOURNAL, months: ["2026-01"] }) });
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

  it("compte 63/64 non classé : signalé en limite (nombre et montant), hors du passage", async () => {
    const m = await model();
    expect(m.limits.some((l) => sp(l).startsWith("Comptes 63 et 64 non classés dans la grille de comptes (1 compte, 3,00 €)"))).toBe(true);
  });

  it("période en partie n.d. : la limite des comptes non classés n'additionne pas les seuls mois connus (nombre et montant n.d.)", async () => {
    // Janvier → février 2026 : février n'est pas lu ; janvier porte le compte 649100 (3 €). Le passage est n.d. : la limite aussi.
    const per: Period = { months: ["2026-01", "2026-02"], prevMonths: ["2025-01", "2025-02"], from: "01", to: "02", period: "janvier → février 2026", prev: "janvier → février 2025" };
    const m = await model({ period: per });
    expect(raw(table(m, ID.charges), "foot", "n")).toEqual({ nd: "févr. 2026 : mois hors de la lecture PayFit appliquée" });
    expect(m.limits.filter((l) => l.startsWith("Comptes 63 et 64"))).toEqual([
      "Comptes 63 et 64 non classés dans la grille de comptes : nombre et montant n.d. (févr. 2026 : mois hors de la lecture PayFit appliquée) ; hors du passage vers les charges de personnel.",
    ]);
    expect(m.limits.join(" ")).not.toContain("3,00");
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
    expect(r.rows.map((x) => x.cells[0])).toEqual(["Salaires et appointements", "Cotisations patronales", "Provisions de congés payés", "Autres charges de personnel", "Comptes 63/64 non classés"]);
    expect(raw(r, 1, "ecart")).toBe(1000);
    expect(shown(r, "foot", "journal")).toBe("2 438,00 €");
    expect(shown(r, "foot", "compta")).toBe("2 428,00 €");
    expect(shown(r, "foot", "ecart")).toBe("+10,00 €");
    // Écart de rapprochement : pas une tendance de coût (neutre).
    expect(cellView(r.foot!.cells[col(r, "ecart")], r.columns[col(r, "ecart")]).tone).toBe("flat");
    expect(ref.kind === "value" && ref.ecart).toBe(1000);
    const mo = table(m, ID.reconMois);
    expect(mo.rows.map((x) => sp(String(x.cells[0])))).toEqual(["Janvier 2026", `${TOTAL_PERIODE} (janvier 2026)`, `${MEME_PERIODE_N1} (janvier 2025)`]);
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
    expect(k.sub).toBe("Comptes 63 et 64 · janvier 2026");
  });

  it("masse salariale ÷ produits d'exploitation : 23,00 % (2 300 € ÷ 10 000 €), N-1 21,00 % (1 890 € ÷ 9 000 €)", async () => {
    const m = await model();
    const t = table(m, ID.ratio);
    expect(t.columns.map((c) => c.header)).toEqual(["Indicateur", "Janvier 2026", "N-1 (janvier 2025)"]);
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
    expect(t.rows.map((r) => sp(String(r.cells[0])))).toEqual(["Janvier 2026", `${TOTAL_PERIODE} (janvier 2026)`, `${MEME_PERIODE_N1} (janvier 2025)`]);
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

describe("mois non clos : ceux du journal de paie, partout dans le chapitre", () => {
  it("un mois ouvert seulement dans le référentiel RH n'est pas « provisoire » ; ouvert dans le journal, il l'est dans chaque tableau", async () => {
    const rhOnly = await model({ openMonths: ["2026-01"] });
    expect(raw(table(rhOnly, ID.provisionMois), 0, "mois")).toBe("Janvier 2026");
    expect(raw(table(rhOnly, ID.reconMois), 0, "mois")).toBe("Janvier 2026");
    expect(raw(table(rhOnly, ID.dsn), 0, "mois")).toBe("Janvier 2026");
    const journalOpen = await model({ pay: pay({ ...JOURNAL, openMonths: ["2026-01"] }) });
    expect(raw(table(journalOpen, ID.provisionMois), 0, "mois")).toBe("Janvier 2026 (provisoire)");
    expect(raw(table(journalOpen, ID.reconMois), 0, "mois")).toBe("Janvier 2026 (provisoire)");
    expect(raw(table(journalOpen, ID.dsn), 0, "mois")).toBe("Janvier 2026 (provisoire)");
    expect(chart(journalOpen, ID.provisionParts).categoryTitles).toEqual(["janvier 2026 (provisoire)"]);
  });
});

describe("provision de congés payés (toute l'entreprise)", () => {
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
    expect(chart(m, ID.provisionN1).series.map((s) => s.name)).toEqual(["Provision janvier 2026", "Provision N-1 (janvier 2025)"]);
    const k = tile(m, "provision");
    expect(k.label).toBe("Provision fin janvier 2026");
    expect(sp(k.value.text)).toBe("165,00 €");
    expect(sp(k.sub!)).toBe("congés payés 120,00 € + charges sociales 45,00 €");
    expect(k.variations!.map((v) => [v.label, v.text && sp(v.text)])).toEqual([["Fin janvier 2025", "147,00 €"], ["Écart", "+18,00 €"]]);
    expect(k.variations![1].tone).toBe("bad");
  });

  it("seuil de confidentialité absent ou illisible : provision par service n.d. avec le lien vers Paramètres ; le reste du bloc est calculé", async () => {
    const m = await model({ seuil: { kind: "absent" } });
    expect(m.tables.some((t) => t.id === ID.provisionServices)).toBe(false);
    expect(block(m, "provision").nd).toEqual([{ label: "Provision par service", reason: "seuil de confidentialité non défini (Paramètres)", action: { href: CONF_HREF, label: "Paramètres" }, tableOnly: true }]);
    expect(table(m, ID.provisionMois).rows).toHaveLength(1);
    // Toute l'entreprise : non soumise au seuil, la carte et le passage restent chiffrés.
    expect(sp(tile(m, "provision").value.text)).toBe("165,00 €");
    expect(raw(table(m, ID.charges), "foot", "n")).toBe(243500);
    const bad = await model({ seuil: { kind: "invalid", raw: "2" } });
    expect(block(bad, "provision").nd[0].reason).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
  });

  it("sans axe de service : provision par service n.d. avec la raison de l'axe", async () => {
    const m = await model({ axis: false });
    expect(block(m, "provision").nd[0]).toMatchObject({ label: "Provision par service", reason: "aucun code analytique dans le journal PayFit" });
  });
});

describe("seuil de confidentialité : maskServices = maskGroups du module partagé, groupes en personnes distinctes (cas écrits à la main)", () => {
  // g : personnes reliées (jetons), valeur affichée, contrats non reliés.
  const g = (persons: string[], value: number | null, unlinked = 0) => ({ group: G(persons, unlinked), value });
  const P = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

  it("seuil 2, A = 3 personnes (120 €), B = 1 (50 €), « Non ventilé » = 0 (0 €) : B masqué, A masqué en second ; « Non ventilé » (0 €, personne) reste affiché", () => {
    // B est masqué (1 personne). Les masqués ne décrivent qu'une personne (1 < 2) : « Non ventilé » n'apporte personne, A (3) est masqué
    // (1 + 3 = 4 ≥ 2). Sans cela, B se lirait comme « total − A − Non ventilé ». « Non ventilé » vaut 0 € pour personne : rien à cacher.
    expect(maskServices([g(P("a", 3), 12000), g(["b1"], 5000), g([], 0)], 2)).toEqual<MaskStatus[]>(["secondary", "masked", "shown"]);
  });

  it("avec un service C de 2 personnes (200 €) : A (le plus petit montant qui apporte quelqu'un) est masqué, C reste affiché", () => {
    // Masqués : B (1) + A (3) = 4 personnes ≥ 2 ; la différence total − C − Non ventilé décrit ce groupe de 4 personnes.
    expect(maskServices([g(P("a", 3), 12000), g(["b1"], 5000), g(P("c", 2), 20000), g([], 0)], 2)).toEqual<MaskStatus[]>(["secondary", "masked", "shown", "shown"]);
  });

  it("deux services sous le seuil qui, ensemble, restent sous le seuil : un troisième est masqué (seuil 3 : B = 1, C = 1)", () => {
    // B + C = 2 personnes < 3 : leur somme se lirait par différence ; D (400 €, plus petit que A à 500 €) est masqué : 2 + 4 = 6 ≥ 3.
    expect(maskServices([g(P("a", 5), 50000), g(["b1"], 1000), g(["c1"], 2000), g(P("d", 4), 40000)], 3)).toEqual<MaskStatus[]>(["shown", "masked", "masked", "secondary"]);
  });

  it("aucun service sous le seuil : rien n'est masqué, même un service à 0 personne et 0 €", () => {
    expect(maskServices([g(P("a", 3), 12000), g([], 0)], 2)).toEqual<MaskStatus[]>(["shown", "shown"]);
    expect(maskServices([], 2)).toEqual([]);
  });

  it("effectif non dénombré (mois n.d., groupe null) : non vérifiable, protégé comme un service masqué (sans apporter personne)", () => {
    expect(maskServices([{ group: null, value: 10000 }, g(P("b", 5), 20000), g(P("c", 5), 30000)], 2)).toEqual<MaskStatus[]>(["unverifiable", "secondary", "shown"]);
  });

  it("valeur n.d. (null) : la cellule n'affiche rien, elle n'est ni masquée ni protectrice ; à montant égal, le premier dans l'ordre ; un service seul reste masqué", () => {
    expect(maskServices([g(["a1"], 5000), g(P("b", 4), null), g(P("c", 4), 1000)], 2)).toEqual<MaskStatus[]>(["masked", "nd", "secondary"]);
    expect(maskServices([g(["a1"], 500), g(P("b", 3), 1000), g(P("c", 3), 1000)], 2)).toEqual<MaskStatus[]>(["masked", "secondary", "shown"]);
    expect(maskServices([g(["a1"], 500)], 2)).toEqual<MaskStatus[]>(["masked"]);
  });

  it("valeur non nulle sans contrat rattaché (0 personne) : non vérifiable, quel que soit le seuil ; nulle, elle reste affichée", () => {
    // Seuil 2 : A = 3 personnes (432 €), « Non ventilé » = 0 personne et 60 € → non vérifiable ; il n'apporte personne (0 < 2) : A est
    // masqué aussi, sinon « Non ventilé » se lirait comme total − A.
    expect(maskServices([{ group: G(P("a", 3)), value: 43200, nonZero: true }, { group: G([]), value: 6000, nonZero: true }], 2)).toEqual<MaskStatus[]>(["secondary", "unverifiable"]);
    // 0 personne et valeur nulle : rien à protéger.
    expect(maskServices([{ group: G(P("a", 3)), value: 43200, nonZero: true }, { group: G([]), value: 0, nonZero: false }], 2)).toEqual<MaskStatus[]>(["shown", "shown"]);
    // nonZero absent : lu sur le montant (0 € : nul ; montant n.d. : rien n'est affiché).
    expect(maskServices([g(P("a", 3), 43200), g([], 6000)], 2)).toEqual<MaskStatus[]>(["secondary", "unverifiable"]);
    expect(maskServices([g(P("a", 3), 43200), g([], null)], 2)).toEqual<MaskStatus[]>(["shown", "nd"]);
    // Seuil 1 : un montant non nul sans aucune personne reste non vérifiable (effectif non dénombré), A masqué en second.
    expect(maskServices([g(P("a", 3), 43200), g([], 6000)], 1)).toEqual<MaskStatus[]>(["secondary", "unverifiable"]);
  });

  it("une personne à deux contrats dans deux services compte une fois ; un contrat non relié ne protège pas", () => {
    // Seuil 2 : B = {p-b1} masqué ; « Non ventilé » = {p-b1} (une ligne du second contrat de la même personne, sans code analytique)
    // masqué ; ensemble, ils ne décrivent qu'une personne (1 < 2) : C (300 €, plus petit que A à 432 €) est masqué aussi → {p-b1, p-c1,
    // p-c2} = 3 ≥ 2. Additionner les tailles (1 + 1 = 2) laisserait A et C affichés, et B + « Non ventilé » (une personne) se lirait.
    const A = g(P("a", 3), 43200);
    const B = g(["p-b1"], 11700);
    const NV = g(["p-b1"], 600);
    const C = g(P("c", 2), 30000);
    expect(maskServices([A, B, C, NV], 2)).toEqual<MaskStatus[]>(["shown", "masked", "secondary", "masked"]);
    // Deux personnes différentes (p-b1 et p-n1) : 2 ≥ 2, A et C restent affichés.
    expect(maskServices([A, B, C, g(["p-n1"], 600)], 2)).toEqual<MaskStatus[]>(["shown", "masked", "shown", "masked"]);
    // « Non ventilé » porté par un contrat non relié (aucune personne reliée, 1 contrat) : non vérifiable, il n'apporte personne : C
    // masqué en second.
    expect(maskServices([A, B, C, g([], 600, 1)], 2)).toEqual<MaskStatus[]>(["shown", "masked", "secondary", "unverifiable"]);
    // Seuil 3 : A compte 2 personnes reliées et 1 contrat non relié : non dénombré (le contrat non relié ne protège pas) ; 3 reliées
    // suffisent, quels que soient les contrats non reliés.
    expect(maskServices([g(P("a", 2), 43200, 1), g(P("c", 3), 30000)], 3)).toEqual<MaskStatus[]>(["unverifiable", "secondary"]);
    expect(maskServices([g(P("a", 3), 43200, 1), g(P("c", 3), 30000)], 3)).toEqual<MaskStatus[]>(["shown", "shown"]);
  });

  it("passageStatus : le passage d'un service est masqué quand sa provision l'est (principal ou secondaire), pas quand elle est n.d.", () => {
    expect(passageStatus("shown", "shown")).toBe("shown");
    expect(passageStatus("shown", "masked")).toBe("masked");
    expect(passageStatus("shown", "secondary")).toBe("secondary");
    expect(passageStatus("shown", "unverifiable")).toBe("shown");
    expect(passageStatus("secondary", "shown")).toBe("secondary");
    expect(passageStatus("unverifiable", "masked")).toBe("unverifiable");
  });

  it("guardProvision (un service seul) : 1 à seuil − 1 personnes ⇒ n.d. ; aucune personne et provision non nulle ⇒ non vérifiable ; au moins le seuil ⇒ valeurs", () => {
    const v = provisionMonth(JOURNAL, "2026-01");
    const two = G(["p1", "p2"]);
    expect(guardProvision(v, two, 3).total).toEqual({ nd: sousSeuil(3) });
    expect(guardProvision(v, two, 3).conges).toEqual({ nd: sousSeuil(3) });
    expect(guardProvision(v, G(["p1", "p2", "p3"]), 3).total).toBe(16500);
    // 0 personne et 165 € de provision : non vérifiable, même au seuil 1.
    expect(guardProvision(v, G([]), 3).total).toEqual({ nd: SEUIL_NON_VERIFIABLE });
    expect(guardProvision(v, G([]), 1).total).toEqual({ nd: SEUIL_NON_VERIFIABLE });
    // 0 personne et provision nulle (0 € + 0 €) : affichée.
    expect(guardProvision({ month: "2026-01", kind: "value", conges: 0, charges: 0, total: 0, missing: [] }, G([]), 3).total).toBe(0);
    // Un contrat non relié ne protège pas : 2 personnes reliées + 1 contrat non relié restent non dénombrées au seuil 3.
    expect(guardProvision(v, G(["p1", "p2"], 1), 3).total).toEqual({ nd: SEUIL_NON_VERIFIABLE });
    expect(guardProvision(v, G(["p1", "p2", "p3"], 1), 3).total).toBe(16500);
    expect(guardProvision(v, null, 3).total).toEqual({ nd: SEUIL_NON_VERIFIABLE });
    expect(guardProvision({ month: "2024-01", kind: "nd", reason: "mois hors lecture" }, null, 3).total).toEqual({ nd: "mois hors lecture" });
    // Une seule raison dans toute l'application, en personnes.
    expect(sousSeuil(2)).toBe("non affiché (seuil de confidentialité : 2 personnes)");
    expect(sousSeuil(1)).toBe("non affiché (seuil de confidentialité : 1 personne)");
    expect(sousSeuil(2)).toBe(confidentialiteReason(2));
    expect(SEUIL_NON_VERIFIABLE).toBe("effectif du groupe non dénombré : seuil de confidentialité non vérifiable");
  });

  it("taille d'un groupe : contrats des lignes de dotation (provision) ; contrats de toute ligne de charges de personnel (passage)", () => {
    const a = withService(JOURNAL_SEUIL, "A");
    const b = withService(JOURNAL_SANS_BRUT, "B");
    const nv = withService(JOURNAL_SEUIL, null);
    expect(provisionContracts(a, "2026-01")).toEqual(["contrat-fictif-a1", "contrat-fictif-a2", "contrat-fictif-a3"]);
    expect(passageContracts(a, "2026-01")).toEqual(["contrat-fictif-a1", "contrat-fictif-a2", "contrat-fictif-a3"]);
    // B sans brut : sa dotation porte son contrat ; aucun contrat rémunéré (ligne de brut) dans le moteur.
    expect(provisionContracts(b, "2026-01")).toEqual(["contrat-fictif-b9"]);
    expect(passageContracts(b, "2026-01")).toEqual(["contrat-fictif-b9"]);
    const mb = monthPayroll(b, "2026-01");
    expect(mb.kind === "value" && mb.paidContracts).toEqual([]);
    // « Non ventilé » : titres-restaurant 60 € sans contrat ; aucune ligne de provision.
    expect(provisionContracts(nv, "2026-01")).toEqual([]);
    expect(passageContracts(nv, "2026-01")).toEqual([]);
    expect(passageGroup(nv, "2026-01", LINK)).toEqual({ group: G([]), value: 6000, nonZero: true });
    expect(provisionGroup(nv, "2026-01", LINK)).toEqual({ group: G([]), value: 0, nonZero: false });
    // Provision de B (150 € + 60 €) et passage (provisions 210 €) : le contrat b9 relié à sa personne ; sans lien, contrat non relié.
    expect(provisionGroup(b, "2026-01", LINK)).toEqual({ group: G(["personne-b9"]), value: 21000, nonZero: true });
    expect(passageGroup(b, "2026-01", LINK)).toEqual({ group: G(["personne-b9"]), value: 21000, nonZero: true });
    expect(provisionGroup(b, "2026-01")).toEqual({ group: G([], 1), value: 21000, nonZero: true });
    // Mois n.d. : groupe non dénombré, aucune valeur.
    expect(provisionGroup(b, "2024-01", LINK)).toEqual({ group: null, value: null });
    // Une reprise « Mois précédent » (contrat sorti, sans dotation) et une contrepartie 428 ne font pas partie du stock affiché : leur
    // contrat ne compte pas pour la provision ; la reprise compte pour le passage (ligne de charges de personnel).
    const extra: JournalInput = {
      ...JOURNAL_SEUIL,
      lines: [
        ...JOURNAL_SEUIL.lines,
        ln("r1", "2026-01", "641200", null, { credit: 2500, contract: "contrat-fictif-a8", svc: "A", name: "Provision congés payés - Mois précédent" }),
        ln("r2", "2026-01", "428200", null, { credit: 3000, contract: "contrat-fictif-a9", svc: "A", name: COURANT }),
      ],
    };
    expect(provisionContracts(withService(extra, "A"), "2026-01")).toEqual(["contrat-fictif-a1", "contrat-fictif-a2", "contrat-fictif-a3"]);
    expect(passageContracts(withService(extra, "A"), "2026-01")).toEqual(["contrat-fictif-a1", "contrat-fictif-a2", "contrat-fictif-a3", "contrat-fictif-a8"]);
  });

  it("maskedWindow : un mois masqué rend la fenêtre n.d. (raison du seuil pour ce mois) ; tous affichés, la fenêtre est inchangée", () => {
    const byRubric = { salaires: 100, primes: 0, stages: 0, indemnites: 0, cotisations: 0, taxes: 0, "provisions-cp": 0, "autres-charges": 0 };
    const mv = (month: string) => ({ month, kind: "value" as const, open: false, brut: 100, masse: 100, byRubric, unclassified: [] });
    const w: WindowIn = { kind: "value", brut: 200, masse: 200, byRubric: { ...byRubric, salaires: 200 }, months: [mv("2026-01"), mv("2026-02")] };
    const out = maskedWindow(w, (m) => (m === "2026-01" ? "masked" : "shown"), 2);
    expect(out.kind).toBe("nd");
    expect(out.kind === "nd" && windowReason(out)).toBe(`janv. 2026 : ${sousSeuil(2)}`);
    expect(maskedWindow(w, () => "shown", 2)).toBe(w);
  });
});

describe("provision par service : seuil de confidentialité et masquage secondaire, colonne par colonne", () => {
  it("seuil 2, A = 3, B = 1, « Non ventilé » à 0 personne : A et B n.d. en janvier 2026, « Non ventilé » (0 €) affiché, N-1 affiché, total complet", async () => {
    const m = await model({ pay: pay(JOURNAL_SEUIL) });
    const t = table(m, ID.provisionServices);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "B", "Non ventilé"]);
    // Fin janvier 2026 : B (1 personne) masqué ; « Non ventilé » (0 €, personne) n'apporte personne, A (3) est masqué à son tour : sans
    // A, B se lirait comme 170 − 120 − 0 = 50 €. Même raison pour A et B (masquage principal ou secondaire, indiscernables) ; « Non
    // ventilé » reste à 0 € (il ne décrit personne).
    for (const r of [0, 1]) for (const k of ["total", "conges", "charges"]) expect(raw(t, r, k)).toEqual({ nd: sousSeuil(2) });
    for (const r of [0, 1]) expect(raw(t, r, "ecart")).toEqual({ nd: "écart non calculable : provision n.d." });
    expect(raw(t, 2, "total")).toBe(0);
    // Fin janvier 2025 (colonne N-1, statuts propres) : A = 2 et B = 2 personnes, aucun masquage : 90 €, 65 €, 0 €.
    expect([0, 1, 2].map((r) => raw(t, r, "total-n1"))).toEqual([9000, 6500, 0]);
    // Toute l'entreprise : jamais masquée (170 €, 155 €, +15 €, 130 € + 40 €).
    expect(shown(t, "foot", "total")).toBe("170,00 €");
    expect(shown(t, "foot", "total-n1")).toBe("155,00 €");
    expect(shown(t, "foot", "ecart")).toBe("+15,00 €");
    expect(shown(t, "foot", "conges")).toBe("130,00 €");
    expect(shown(t, "foot", "charges")).toBe("40,00 €");
    // Aucune valeur de B (50 €, 40 €, 10 €) ni de A (120 €, 90 €, 30 €) de janvier 2026 dans le tableau.
    const nums = [...t.rows.flatMap((r) => r.cells)].filter((c): c is number => typeof c === "number");
    for (const v of [5000, 4000, 1000, 12000, 3000]) expect(nums).not.toContain(v);
    expect(m.limits).toContain(PROVISION_SERVICES_LIMITE);
    expect(m.limits).not.toContain(SERVICE_RETENU_LIMITE);
  });

  it("cas de la relecture, seuil 3 : B (1 contrat sans brut, dotation 210 €) n.d. ; A (3 contrats) masqué en secondaire ; B non reconstituable", async () => {
    const m = await model({ pay: pay(JOURNAL_SANS_BRUT), seuil: SEUIL(3) });
    const t = table(m, ID.provisionServices);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "B"]);
    // B : 1 contrat porte la dotation (taille 1 < 3) → masqué. Masqués : {b9} = 1 contrat < 3 → A (120 €) masqué aussi : {b9, a1, a2,
    // a3} = 4 ≥ 3. Même raison sur les deux lignes.
    for (const r of [0, 1]) for (const k of ["total", "conges", "charges"]) expect(raw(t, r, k)).toEqual({ nd: sousSeuil(3) });
    // Toute l'entreprise : 330 € (240 € + 90 €) ; total − A ne se calcule pas, A étant n.d. : 210 € n'apparaît nulle part.
    expect(raw(t, "foot", "total")).toBe(33000);
    expect(raw(t, "foot", "conges")).toBe(24000);
    expect(raw(t, "foot", "charges")).toBe(9000);
    const pub = published(m);
    // Valeurs de B (210 €, 150 €, 60 €) et de A (120 €, 30 € de charges sociales) ; 90 € n'est pas vérifiable ici (pied : 30 + 60 €).
    for (const v of [21000, 15000, 6000, 12000, 3000]) expect(pub.numbers).not.toContain(v);
    // Sous le filtre B : provision et passage n.d. (B porte 210 € de provisions, 1 contrat) ; sous le filtre A, n.d. aussi.
    const fb = await model({ pay: pay(JOURNAL_SANS_BRUT), seuil: SEUIL(3), service: "B" });
    expect(tile(fb, "provision").value).toMatchObject({ kind: "nd", reason: sousSeuil(3) });
    expect(raw(table(fb, ID.provisionMois), 0, "total")).toEqual({ nd: sousSeuil(3) });
    expect(raw(table(fb, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${sousSeuil(3)}` });
    expect(published(fb).numbers).not.toContain(21000);
    expect(fb.limits).toContain(SERVICE_RETENU_LIMITE);
    const fa = await model({ pay: pay(JOURNAL_SANS_BRUT), seuil: SEUIL(3), service: "A" });
    expect(tile(fa, "provision").value).toMatchObject({ kind: "nd", reason: sousSeuil(3) });
    expect(raw(table(fa, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${sousSeuil(3)}` });
  });

  it("même cas, dotation de B sans contrat rattaché : 0 personne et 210 € → non vérifiable (raison « non dénombré ») ; A masqué en secondaire", async () => {
    const m = await model({ pay: pay(JOURNAL_SANS_CONTRAT), seuil: SEUIL(3) });
    const t = table(m, ID.provisionServices);
    for (const k of ["total", "conges", "charges"]) expect(raw(t, 0, k)).toEqual({ nd: sousSeuil(3) });
    for (const k of ["total", "conges", "charges"]) expect(raw(t, 1, k)).toEqual({ nd: SEUIL_NON_VERIFIABLE });
    expect(raw(t, "foot", "total")).toBe(33000);
    expect(published(m).numbers).not.toContain(21000);
    expect(published(m).numbers).not.toContain(12000);
  });

  it("cas inverse, seuil 3 : E = 3 contrats payés mais 1 seul porte la dotation (deux stagiaires sans provision) → provision de E n.d.", async () => {
    // 2026-01 · A : comme ci-dessus (3 contrats, provision 120 €, passage 4 320 €).
    //         · E : salaires 1 000 € (contrat-fictif-e1), gratifications de stage 2 × 600 € (e2, e3), cotisations 400 € ; dotation de
    //           e1 seul : 40 € (6412) + 10 € (6485) = 50 €. Passage E : 1 000 + 1 200 + 400 + 50 = 2 650 € (3 contrats).
    // Provision : A = 3, E = {e1} = 1 < 3 → masqué ; {e1} = 1 < 3 → A masqué en secondaire. Compter le brut donnerait E = 3 contrats et
    // publierait les 50 € d'une seule personne.
    const e: LedgerLine[] = [
      ln("e1", "2026-01", "641100", 100000, { contract: "contrat-fictif-e1", svc: "E" }),
      ln("e2", "2026-01", "641370", 60000, { contract: "contrat-fictif-e2", svc: "E" }),
      ln("e3", "2026-01", "641370", 60000, { contract: "contrat-fictif-e3", svc: "E" }),
      ln("e4", "2026-01", "645000", 40000, { svc: "E" }),
      ...dot("e5", "2026-01", "641200", "E", [["contrat-fictif-e1", 4000]]),
      ...dot("e6", "2026-01", "648500", "E", [["contrat-fictif-e1", 1000]]),
    ];
    const journal: JournalInput = { ...JOURNAL_SANS_BRUT, lines: [...SANS_BRUT_A, ...e] };
    const t = table(await model({ pay: pay(journal), seuil: SEUIL(3) }), ID.provisionServices);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "E"]);
    for (const r of [0, 1]) expect(raw(t, r, "total")).toEqual({ nd: sousSeuil(3) });
    expect(raw(t, "foot", "total")).toBe(17000);
    // Sous le filtre E : le passage (3 contrats) passerait le seuil, mais sa ligne « Provisions de congés payés » vaudrait les 50 € de
    // e1 : il est masqué avec la provision. Aucun montant de E n'est publié (50 €, 40 €, 10 €, 2 650 €).
    const fe = await model({ pay: pay(journal), seuil: SEUIL(3), service: "E" });
    expect(tile(fe, "provision").value).toMatchObject({ kind: "nd", reason: sousSeuil(3) });
    expect(raw(table(fe, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${sousSeuil(3)}` });
    const pub = published(fe);
    for (const v of [5000, 4000, 1000, 265000]) expect(pub.numbers).not.toContain(v);
  });

  it("« Non ventilé » peut devenir n.d. : dotation de 12 € sans contrat ni code (non vérifiable) ; A (3 personnes, 120 €) masqué en secondaire, C (2, 200 €) affiché", async () => {
    // Seuil 2, fin janvier 2026, sans B : A = 3 personnes (120 €), C = 2 (200 €), « Non ventilé » = 0 personne et 12 € (6412) → non
    // vérifiable. Masqués : 0 personne < 2 → A, plus petit que C, masqué : 3 ≥ 2. Total 120 + 200 + 12 = 332 € ; 332 − 200 = 132 € =
    // A + Non ventilé.
    const lines = [...SANS_BRUT_A, ...C_LINES, ...dot("v1", "2026-01", "641200", undefined, [[null, 1200]])];
    const m = await model({ pay: pay({ ...JOURNAL_SANS_BRUT, lines }) });
    const t = table(m, ID.provisionServices);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "C", "Non ventilé"]);
    expect(raw(t, 2, "total")).toEqual({ nd: SEUIL_NON_VERIFIABLE });
    expect(raw(t, 0, "total")).toEqual({ nd: sousSeuil(2) });
    expect(raw(t, 1, "total")).toBe(20000);
    expect(raw(t, "foot", "total")).toBe(33200);
    expect(published(m).numbers).not.toContain(1200);
  });

  it("avec un service C de 2 personnes : C affiché (200 €), A et B masqués, « Non ventilé » (0 €) affiché ; total − C − Non ventilé = 170 € décrit 4 personnes", async () => {
    const m = await model({ pay: pay(JOURNAL_SEUIL_C) });
    const t = table(m, ID.provisionServices);
    expect(t.rows.map((r) => r.cells[0])).toEqual(["A", "B", "C", "Non ventilé"]);
    expect([0, 1, 3].map((r) => raw(t, r, "total"))).toEqual([{ nd: sousSeuil(2) }, { nd: sousSeuil(2) }, 0]);
    // C : 150 € + 50 € = 200 € ; N-1 : aucune ligne de C en janvier 2025, 0 € lu ; écart +200 €.
    expect(raw(t, 2, "total")).toBe(20000);
    expect(raw(t, 2, "conges")).toBe(15000);
    expect(raw(t, 2, "charges")).toBe(5000);
    expect(raw(t, 2, "total-n1")).toBe(0);
    expect(shown(t, 2, "ecart")).toBe("+200,00 €");
    // Pied : 370 € ; 370 − 200 − 0 = 170 € = A + B (3 + 1 = 4 personnes ≥ 2) ; aucune ligne seule ne s'en déduit.
    expect(raw(t, "foot", "total")).toBe(37000);
    expect((raw(t, "foot", "total") as number) - (raw(t, 2, "total") as number)).toBe(17000);
    expect(raw(t, "foot", "conges")).toBe(28000);
    expect(raw(t, "foot", "charges")).toBe(9000);
  });
});

describe("filtre de service : chiffres du service soumis au même seuil (carte, tableau mensuel, séries, passage)", () => {
  it("service A, seuil 1 : passage et provision du service ; comptabilité et DSN n.d. « non filtrables par service » avec retrait du filtre", async () => {
    const m = await model({ service: "A", seuil: SEUIL(1) });
    // A, 2026-01 : salaires 1 200 € + cotisations 400 € = 1 600 € ; provisions 80 − 50 + 30 = 60 € ; total 1 660 €.
    const t = table(m, ID.charges);
    expect(raw(t, 8, "n")).toBe(160000);
    expect(raw(t, "foot", "n")).toBe(166000);
    expect(sp(tile(m, "provision").value.text)).toBe("110,00 €");
    const href = croiseeHref(BASE, { chapitre: "paie-compta", annee: "2026", de: "01", a: "01" });
    expect(block(m, "comptabilite").nd[0]).toEqual({ reason: NON_FILTRABLE_COMPTA, action: { href, label: "Retirer le filtre Service" } });
    expect(block(m, "dsn").nd[0].reason).toBe(NON_FILTRABLE_DSN);
    expect(m.tables.some((x) => x.id === ID.provisionServices)).toBe(false);
    expect(block(m, "provision").nd).toEqual([]);
  });

  it("service B (1 contrat), seuil 2 : carte, tableau mensuel, séries et passage n.d. ; N-1 (2 contrats) affiché ; aucune valeur de B publiée", async () => {
    const m = await model({ pay: pay(JOURNAL_SEUIL), service: "B" });
    const why = sousSeuil(2);
    // Provision : carte, tableau mensuel et séries n.d. pour janvier 2026 ; N-1 (fin janvier 2025, B = 2 contrats) : 65 €.
    const k = tile(m, "provision");
    expect(k.value).toMatchObject({ kind: "nd", reason: why });
    expect(k.sub).toBeUndefined();
    expect(k.variations!.map((v) => v.text && sp(v.text))).toEqual(["65,00 €", null]);
    const t = table(m, ID.provisionMois);
    expect(raw(t, 0, "total")).toEqual({ nd: why });
    expect(raw(t, 0, "conges")).toEqual({ nd: why });
    expect(raw(t, 0, "charges")).toEqual({ nd: why });
    expect(raw(t, 0, "total-n1")).toBe(6500);
    expect(chart(m, ID.provisionParts).series.map((s) => [s.values, s.reasons])).toEqual([[[null], [why]], [[null], [why]]]);
    expect(chart(m, ID.provisionN1).series.map((s) => s.values)).toEqual([[null], [6500]]);
    // Passage de janvier 2026 n.d. (raison du mois), N-1 chiffré : salaires 1 400 € + cotisations 560 € + provisions 65 € = 2 025 €.
    const c = table(m, ID.charges);
    expect(raw(c, "foot", "n")).toEqual({ nd: `janv. 2026 : ${why}` });
    expect(raw(c, "foot", "n1")).toBe(202500);
    expect(tile(m, "charges").value).toMatchObject({ kind: "nd", reason: `janv. 2026 : ${why}` });
    // Aucune valeur de B en janvier 2026 (provision 50, 40, 10 € ; salaires 800 € ; cotisations 320 € ; masse 1 120 € ; total 1 170 €).
    const pub = published(m);
    for (const v of [5000, 4000, 1000, 80000, 32000, 112000, 117000]) expect(pub.numbers).not.toContain(v);
    for (const s of ["50,00 €", "1 120,00 €", "1 170,00 €", "800,00 €"]) expect(pub.texts.join(" | ")).not.toContain(s);
    expect(m.tables.some((x) => x.id === ID.provisionServices)).toBe(false);
  });

  it("service A (3 personnes) masqué en secondaire dans le tableau par service : masqué aussi sous le filtre (sinon B = total − A − Non ventilé)", async () => {
    const m = await model({ pay: pay(JOURNAL_SEUIL), service: "A" });
    expect(tile(m, "provision").value).toMatchObject({ kind: "nd", reason: sousSeuil(2) });
    expect(raw(table(m, ID.provisionMois), 0, "total")).toEqual({ nd: sousSeuil(2) });
    expect(raw(table(m, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${sousSeuil(2)}` });
    // « Non ventilé » : provision à 0 € pour personne, affichée ; passage de 60 € sans contrat, non vérifiable.
    const nv = await model({ pay: pay(JOURNAL_SEUIL), service: null });
    expect(sp(tile(nv, "provision").value.text)).toBe("0,00 €");
    expect(raw(table(nv, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${SEUIL_NON_VERIFIABLE}` });
  });

  it("une personne à deux contrats dans deux services compte une fois (lien du référentiel) ; un contrat non relié ne protège pas", async () => {
    // Journal avec C (c1, c2) : b1 et c1 portés par la MÊME personne. Provision fin janvier 2026, seuil 2 : B = {b1} masqué ; C = {c1, c2}
    // = 2 personnes affiché dans le tableau par service... sauf que la personne de b1 est aussi dans C : C reste affiché (2 personnes ≥
    // 2), B masqué ; masqués {B} = 1 personne < 2 → A (120 €), plus petit que C, masqué en second.
    const same: PersonLink = new Map([...LINK, ["contrat-fictif-c1", "personne-b1"]]);
    const t = table(await model({ pay: pay(JOURNAL_SEUIL_C), link: same }), ID.provisionServices);
    expect([0, 1, 2].map((r) => raw(t, r, "total"))).toEqual([{ nd: sousSeuil(2) }, { nd: sousSeuil(2) }, 20000]);
    // c2 non relié : C compte 1 personne reliée (c1) et 1 contrat non relié → non dénombré ; B masqué ; {B, C} = 1 personne < 2 → A
    // masqué en second. Aucune ligne de service affichée.
    const unlinked: PersonLink = new Map([...LINK].filter(([k]) => k !== "contrat-fictif-c2"));
    const u = table(await model({ pay: pay(JOURNAL_SEUIL_C), link: unlinked }), ID.provisionServices);
    expect([0, 1, 2].map((r) => raw(u, r, "total"))).toEqual([{ nd: sousSeuil(2) }, { nd: sousSeuil(2) }, { nd: SEUIL_NON_VERIFIABLE }]);
    expect(raw(u, "foot", "total")).toBe(37000);
  });

  it("service C : provision chiffrée comme sa ligne (200 €) ; passage n.d., car « Non ventilé » (60 € sans contrat) doit être protégé", async () => {
    const m = await model({ pay: pay(JOURNAL_SEUIL_C), service: "C" });
    // Provision fin janvier 2026 : C (2 contrats) affiché dans le tableau par service, donc sous le filtre : 150 + 50 = 200 €.
    expect(sp(tile(m, "provision").value.text)).toBe("200,00 €");
    expect(raw(table(m, ID.provisionMois), 0, "total")).toBe(20000);
    // Passage de janvier 2026 (taille : contrats de toute ligne de charges de personnel) : A = 3 (4 320 €), B = 1 (1 170 €) masqué,
    // C = 2 (3 000 €), « Non ventilé » = 0 contrat et 60 € → masqué. Masqués : {b1} = 1 < 2 → C, plus petit que A, masqué en
    // secondaire : {b1, c1, c2} = 3 ≥ 2. Sans cela, B + « Non ventilé » (1 contrat) se lirait comme total − A − C.
    expect(raw(table(m, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${sousSeuil(2)}` });
    // N-1 (janvier 2025) : aucune ligne de C, 0 € lu, affiché.
    expect(raw(table(m, ID.charges), "foot", "n1")).toBe(0);
  });

  it("service C, ligne de « Non ventilé » rattachée à un contrat sans service (n1) : masqués {b1, n1} = 2 ≥ 2, passage de C chiffré", async () => {
    const lines = JOURNAL_SEUIL_C.lines.map((l) => (l.key === "s11" ? { ...l, contractId: "contrat-fictif-n1" } : l));
    const m = await model({ pay: pay({ ...JOURNAL_SEUIL_C, lines }), service: "C" });
    // C, 2026-01 : salaires 2 000 € + cotisations 800 € + provisions 200 € = 3 000 €.
    expect(raw(table(m, ID.charges), "foot", "n")).toBe(300000);
    // La même ligne rattachée à b1 (contrat déjà masqué dans B) n'ajoute aucun contrat : {b1} = 1 < 2, C reste masqué.
    const same = JOURNAL_SEUIL_C.lines.map((l) => (l.key === "s11" ? { ...l, contractId: "contrat-fictif-b1" } : l));
    const ms = await model({ pay: pay({ ...JOURNAL_SEUIL_C, lines: same }), service: "C" });
    expect(raw(table(ms, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${sousSeuil(2)}` });
  });

  it("période de deux mois : B masqué en janvier (1 contrat), affiché en février (2) ; le passage de la période est n.d.", async () => {
    // 2026-01 : A = 3 contrats (provision 120 €), B = 1 (50 €). 2026-02 : A = 3 (provision 32 + 32 + 31 = 95 € et 11 + 10 + 10 =
    // 31 €, soit 126 €), B = 2 (b1, b2 ; salaires 800 € + 600 €, cotisations 560 €, provision 2 × 30 € + 2 × 9 € = 78 €). Aucun
    // « Non ventilé ». N-1 non lu.
    const feb: LedgerLine[] = [
      ln("f1", "2026-02", "641100", 100000, { contract: "contrat-fictif-a1", svc: "A" }),
      ln("f2", "2026-02", "641100", 100000, { contract: "contrat-fictif-a2", svc: "A" }),
      ln("f3", "2026-02", "641100", 100000, { contract: "contrat-fictif-a3", svc: "A" }),
      ln("f4", "2026-02", "645000", 120000, { svc: "A" }),
      ...dot("f5", "2026-02", "641200", "A", [["contrat-fictif-a1", 3200], ["contrat-fictif-a2", 3200], ["contrat-fictif-a3", 3100]]),
      ...dot("f6", "2026-02", "648500", "A", [["contrat-fictif-a1", 1100], ["contrat-fictif-a2", 1000], ["contrat-fictif-a3", 1000]]),
      ln("f7", "2026-02", "641100", 80000, { contract: "contrat-fictif-b1", svc: "B" }),
      ln("f8", "2026-02", "641100", 60000, { contract: "contrat-fictif-b2", svc: "B" }),
      ln("f9", "2026-02", "645000", 56000, { svc: "B" }),
      ...dot("f10", "2026-02", "641200", "B", [["contrat-fictif-b1", 3000], ["contrat-fictif-b2", 3000]]),
      ...dot("f11", "2026-02", "648500", "B", [["contrat-fictif-b1", 900], ["contrat-fictif-b2", 900]]),
    ];
    const jan = SEUIL_LINES.filter((l) => l.month === "2026-01" && l.key !== "s11");
    const journal: JournalInput = { lines: [...jan, ...feb], months: ["2026-01", "2026-02"], openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" };
    const per: Period = { months: ["2026-01", "2026-02"], prevMonths: ["2025-01", "2025-02"], from: "01", to: "02", period: "janvier → février 2026", prev: "janvier → février 2025" };
    const m = await model({ pay: pay(journal), service: "B", period: per });
    const t = table(m, ID.provisionMois);
    expect(raw(t, 0, "total")).toEqual({ nd: sousSeuil(2) });
    expect(raw(t, 1, "total")).toBe(7800);
    expect(raw(t, 1, "conges")).toBe(6000);
    expect(raw(t, 1, "charges")).toBe(1800);
    expect(chart(m, ID.provisionParts).series[0].values).toEqual([null, 6000]);
    expect(sp(tile(m, "provision").value.text)).toBe("78,00 €");
    // Le passage de janvier → février contient janvier : n.d. (sinon janvier se lirait comme « période − février »).
    expect(raw(table(m, ID.charges), "foot", "n")).toEqual({ nd: `janv. 2026 : ${sousSeuil(2)}` });
    // Sans filtre, fin février : A (3) et B (2) affichés, 126 € et 78 €.
    const all = table(await model({ pay: pay(journal), period: per }), ID.provisionServices);
    expect([0, 1].map((r) => raw(all, r, "total"))).toEqual([12600, 7800]);
  });

  it("seuil absent sous un filtre de service : passage et provision du service n.d. avec le lien vers Paramètres › Confidentialité, sans tableau ni graphique", async () => {
    const m = await model({ pay: pay(JOURNAL_SEUIL), service: "A", seuil: { kind: "absent" } });
    const action = { href: CONF_HREF, label: "Paramètres" };
    expect(block(m, "charges").nd).toEqual([{ reason: "seuil de confidentialité non défini (Paramètres)", action }]);
    expect(block(m, "provision").nd).toEqual([{ reason: "seuil de confidentialité non défini (Paramètres)", action }]);
    expect(block(m, "charges").tables).toEqual([]);
    expect(block(m, "provision").charts).toEqual([]);
    for (const id of [ID.charges, ID.provisionMois]) expect(m.tables.some((x) => x.id === id)).toBe(false);
    for (const id of [ID.chargesNature, ID.provisionParts, ID.provisionN1]) expect(m.charts.some((x) => x.id === id)).toBe(false);
    expect(tile(m, "charges").value).toMatchObject({ kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" });
    expect(tile(m, "provision").value).toMatchObject({ kind: "nd", reason: "seuil de confidentialité non défini (Paramètres)" });
    expect(published(m).numbers).toEqual([]);
  });
});

describe("chapitre non calculable, « Prévu », glossaire, modèle mémoïsé", () => {
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

  it("termes du chapitre : ceux de PAIE_CX_TERMS, tous présents au glossaire", async () => {
    const m = await model();
    expect(m.terms).toEqual(Object.values(PAIE_CX_TERMS));
    for (const id of m.terms) expect(glossaryEntry(id), id).toBeDefined();
    for (const p of PREVU_PAIE) expect(glossaryEntry(p.term), p.term).toBeDefined();
  });

  it("paieComptaModel : un seul calcul par contexte de requête (le journal est lu une fois), un autre contexte recalcule", async () => {
    let reads = 0;
    const ctx = fakeCtx({ onPayroll: () => (reads += 1) });
    const a = await paieComptaModel(ctx);
    const b = await paieComptaModel(ctx);
    expect(b).toBe(a);
    expect(reads).toBe(1);
    expect(sp(tile(a, "provision").value.text)).toBe("165,00 €");
    await paieComptaModel(fakeCtx({ onPayroll: () => (reads += 1) }));
    expect(reads).toBe(2);
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
    expect(t).toContain(`href="${CONF_HREF}"`);
    expect(render(m, "graphique")).not.toContain('data-testid="cx-paie-compta-provision-nd"');
    const nd = render(await model({ pay: pay({ ...JOURNAL, months: ["2026-01"] }) }), "tableau");
    expect(nd).toContain('<abbr class="nd" title="janv. 2025 : mois hors de la lecture PayFit appliquée">n.d.</abbr>');
  });

  it("filtre sur un service sous le seuil : la raison du seuil est écrite, en « Graphiques » comme en « Tableaux » quand le seuil manque", async () => {
    const html = render(await model({ pay: pay(JOURNAL_SEUIL), service: "B" }), "tableau");
    expect(html).toContain(`title="${sousSeuil(2)}">n.d.</abbr>`);
    expect(html).not.toContain("contrat-fictif");
    const noSeuil = await model({ pay: pay(JOURNAL_SEUIL), service: "B", seuil: { kind: "absent" } });
    for (const aff of ["graphique", "tableau"] as const) {
      const out = render(noSeuil, aff);
      expect(out).toContain('data-testid="cx-paie-compta-charges-nd"');
      expect(out).toContain('data-testid="cx-paie-compta-provision-nd"');
      expect(out).toContain(`href="${CONF_HREF}"`);
    }
  });

  it("chapitre n.d. : l'état n.d. et sa raison, rien d'autre", async () => {
    const html = render(await model({ period: false }));
    expect(html).toContain('data-testid="cx-paie-compta-nd"');
    expect(html).toContain("Aucun mois clos à la date de référence");
    expect(html).not.toContain("cx-tile-");
  });
});
