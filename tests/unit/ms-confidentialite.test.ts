import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FixeVariableView, PaieComptaView } from "@/app/e/[slug]/studio-rh/masse-salariale/Lot2Views";
import { servicesMonthsSheet, servicesSheet } from "@/app/e/[slug]/studio-rh/masse-salariale/export/sheets";
import { syntheseOf } from "@/app/e/[slug]/studio-rh/masse-salariale/synthese-data";
import { confidentialiteReason, linkFromReferential, SEUIL_NON_DEFINI, SEUIL_NON_VERIFIABLE, type ConfidentialiteSetting } from "@/lib/confidentialite";
import type { JournalInput, LedgerLine } from "@/lib/payroll/engine";
import { withService } from "@/lib/payroll/engine";
import { DEFAULT_PREFIXES } from "@/lib/payroll/grid";
import { labelContracts, labelKey, labelTotals, maskLabels, maskProvisionServices, provisionContracts } from "@/lib/payroll/lot2";
import { journalCell, maskServiceRows, serviceGuard, serviceRows } from "@/lib/payroll/service-rows";
import type { RhBuildData } from "@/lib/rh/referential/types";

// Seuil de confidentialité de la Masse salariale (Synthèse, Fixe & variable, Paie & comptabilité et export Excel), en PERSONNES
// DISTINCTES du référentiel Collaborateurs : cas écrits à la main sur un journal fictif. Le contexte (base) est remplacé par un contexte
// fictif ; le seuil est fourni par un double de getConfidentialite.
const state = vi.hoisted(() => ({ ctx: null as unknown, conf: { kind: "absent" } as unknown }));
vi.mock("@/lib/payroll/context", () => ({ loadPayrollContext: async () => state.ctx }));
vi.mock("@/lib/confidentialite", async (orig) => ({ ...(await orig<typeof import("@/lib/confidentialite")>()), getConfidentialite: async () => state.conf }));

// --- Référentiel fictif : contrats C1 à C13, personnes P1 à P10 ; C5 et C6 sont deux contrats de P5 ; C9 n'est relié à aucune personne.
const contract = (externalId: string, personKey: string | null) => ({ contractKey: `payfit:${externalId}`, externalId, personKey }) as RhBuildData["contracts"][number];
const DATA = {
  contracts: [contract("C1", "P1"), contract("C2", "P2"), contract("C3", "P3"), contract("C4", "P4"), contract("C5", "P5"), contract("C6", "P5"), contract("C7", "P6"), contract("C8", "P7"), contract("C10", "P8"), contract("C12", "P9"), contract("C13", "P10")],
};
const link = linkFromReferential(DATA);
const set = (value: number): ConfidentialiteSetting => ({ kind: "set", value, updatedAt: null, updatedBy: null });
const ABSENT: ConfidentialiteSetting = { kind: "absent" };
const R3 = confidentialiteReason(3); // « non affiché (seuil de confidentialité : 3 personnes) »
// Cellule masquée telle que l'écran la rend : « n.d. » avec la raison au survol (même balise que la croisée et KPI RH).
const ABBR3 = `<abbr class="nd" title="${R3}">n.d.</abbr>`;
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let n = 0;
const an = (code: string | null) => (code ? [{ type: "Service", code, value: code }] : []);
const line = (month: string, accountId: string, name: string, debit: number, contractId: string | null, svc: string | null): LedgerLine => ({
  key: `${month}#${String(n++).padStart(5, "0")}`,
  month,
  accountId,
  accountName: name,
  debitCents: debit,
  creditCents: null,
  contractId,
  analytic: an(svc),
});
// Un contrat rémunéré dans un service : salaire + cotisations = moitié du salaire.
const paid = (month: string, contractId: string, svc: string, salary: number): LedgerLine[] => [line(month, "641100", "Salaires", salary, contractId, svc), line(month, "645100", "Cotisations", salary / 2, contractId, svc)];
const journalOf = (lines: LedgerLine[], months: string[]): JournalInput => ({ lines, months, openMonths: [], grid: DEFAULT_PREFIXES, serviceAxis: "Service" });

// Journal de référence (janvier et février 2026 ; N-1 = janvier et février 2025 à 90 %), masse chargée par mois :
// A : C1, C2, C3 (3 personnes) × (2 000 + 1 000) = 9 000,00 € ; B : C4 (1 personne) 3 000 + 1 500 = 4 500,00 € ;
// C : C5 (1 000 + 500) + C6 (500 + 250), une seule personne P5 = 2 250,00 € ; E : C7, C8 (2 personnes) × (1 000 + 500) = 3 000,00 €.
// Total du mois 18 750,00 € ; période 37 500,00 € ; N-1 : A 8 100, B 4 050, C 2 025, E 2 700 → mois 16 875, période 33 750,00 €.
const ref: LedgerLine[] = [];
for (const [m, k] of [["2026-01", 1], ["2026-02", 1], ["2025-01", 0.9], ["2025-02", 0.9]] as [string, number][]) {
  for (const c of ["C1", "C2", "C3"]) ref.push(...paid(m, c, "A", 200000 * k));
  ref.push(...paid(m, "C4", "B", 300000 * k));
  ref.push(...paid(m, "C5", "C", 100000 * k), ...paid(m, "C6", "C", 50000 * k));
  ref.push(...paid(m, "C7", "E", 100000 * k), ...paid(m, "C8", "E", 100000 * k));
}
const REF = journalOf(ref, ["2025-01", "2025-02", "2026-01", "2026-02"]);
const MONTHS = ["2026-01", "2026-02"];
const PREV = ["2025-01", "2025-02"];
const rows = serviceRows(REF, MONTHS, PREV);

describe("cellule de masquage d'un montant du journal (journalCell)", () => {
  it("personnes reliées ; non dénombrée quand un contrat non relié existe sous le seuil ; montant non nul sans contrat : non vérifiable", () => {
    expect(journalCell(["C1", "C2", "C3"], 900000, link, 3)).toEqual({ size: 3, value: 900000, members: ["P1", "P2", "P3"] });
    expect(journalCell(["C5", "C6"], 225000, link, 3)).toEqual({ size: 1, value: 225000, members: ["P5"] }); // deux contrats, une personne
    expect(journalCell(["C9", "C10"], 100, link, 3)).toEqual({ size: null, value: 100, members: ["P8"] }); // C9 non relié, P8 seule sous le seuil
    expect(journalCell(["C9", "C1", "C2", "C3"], 100, link, 3).size).toBe(3); // trois personnes reliées suffisent
    expect(journalCell([], 100, link, 1)).toEqual({ size: null, value: 100, members: [] }); // lignes sans contrat, quel que soit le seuil
    expect(journalCell([], 0, link, 3)).toEqual({ size: 0, value: 0, members: [] }); // groupe vide : ne désigne personne
    expect(journalCell(["C1"], null, link, 3)).toEqual({ size: 1, value: null, members: ["P1"] }); // déjà n.d. pour une autre raison
  });
});

describe("lignes par service après seuil (cas de référence écrit à la main)", () => {
  it("lignes du moteur : A 18 000 €, B 9 000 €, E 6 000 €, C 4 500 € ; N-1 à 90 %", () => {
    expect(rows.map((r) => [r.value, r.cur.kind === "value" ? r.cur.masse : null, r.prev.kind === "value" ? r.prev.masse : null])).toEqual([["A", 1800000, 1620000], ["B", 900000, 810000], ["E", 600000, 540000], ["C", 450000, 405000]]);
  });
  it("seuil 3 : B (1 personne), C (1 personne, 2 contrats) et E (2 personnes) sont n.d. ; ensemble 4 personnes ≥ 3 : A reste affiché, avec ses mois", () => {
    const m = maskServiceRows(rows, link, set(3));
    expect(m.map((r) => [r.value, r.cur.kind, r.prev.kind, r.evo.kind, r.hidden])).toEqual([["A", "value", "value", "value", false], ["B", "nd", "nd", "nd", true], ["E", "nd", "nd", "nd", true], ["C", "nd", "nd", "nd", true]]);
    const a = m[0];
    expect(a.reason).toBeNull();
    expect(a.cur.kind === "value" && a.cur.masse).toBe(1800000);
    expect(a.cur.months.map((x) => (x.kind === "value" ? x.masse : null))).toEqual([900000, 900000]);
    expect(a.evo).toEqual({ kind: "value", deltaCents: 180000, ratio: { num: 180000, den: 1620000 } });
    for (const r of m.slice(1)) {
      expect(r.reason).toBe(R3);
      expect(r.cur).toMatchObject({ kind: "nd", nd: { reason: R3 } });
      expect(r.prev).toMatchObject({ kind: "nd", nd: { reason: R3 } });
      expect(r.evo).toEqual({ kind: "nd", nd: { reason: R3 } });
      // Chaque mois de la période et de N-1 porte la même raison (masquage principal et secondaire : une seule formulation).
      expect(r.cur.months.map((x) => (x.kind === "nd" ? x.nd.reason : "valeur"))).toEqual([R3, R3]);
      expect(r.prev.months.map((x) => (x.kind === "nd" ? x.nd.reason : "valeur"))).toEqual([R3, R3]);
    }
  });
  it("seuil 2 : B et C (1 personne) masqués, ensemble 2 personnes ≥ 2 : A et E (2 personnes) affichés ; seuil 1 : rien n'est masqué", () => {
    expect(maskServiceRows(rows, link, set(2)).map((r) => [r.value, r.hidden])).toEqual([["A", false], ["B", true], ["E", false], ["C", true]]);
    const one = maskServiceRows(rows, link, set(1));
    expect(one.every((r) => !r.hidden && r.reason === null && r.cur.kind === "value")).toBe(true);
    expect(one[1].cur.kind === "value" && one[1].cur.masse).toBe(900000);
  });
  it("masquage secondaire : B seul sous le seuil (1 personne), la plus petite autre ligne (E, 3 personnes) est masquée à son tour, A reste", () => {
    // A : 3 personnes × 3 000 = 9 000 € ; B : C4 4 500 € ; E : C7, C8, C10 (3 personnes) × 750 = 2 250 € par mois.
    const lines = [...["C1", "C2", "C3"].flatMap((c) => paid("2026-01", c, "A", 200000)), ...paid("2026-01", "C4", "B", 300000), ...["C7", "C8", "C10"].flatMap((c) => paid("2026-01", c, "E", 50000))];
    const j = journalOf(lines, ["2026-01"]);
    const m = maskServiceRows(serviceRows(j, ["2026-01"], ["2025-01"]), link, set(3));
    expect(m.map((r) => [r.value, r.cur.kind, r.reason])).toEqual([["A", "value", null], ["B", "nd", R3], ["E", "nd", R3]]);
    // N-1 hors du journal : n.d. pour sa propre raison, jamais masqué (aucune personne décrite).
    expect(m[0].prev).toMatchObject({ kind: "nd", nd: { reason: expect.stringContaining("hors de la lecture") } });
    expect(m[0].hidden).toBe(false);
  });
  it("un mois sous le seuil : B compte 3 personnes sur la période (affichée) mais 1 en janvier ; les mois sont masqués, colonne et ligne comprises", () => {
    // A : 3 personnes × 3 000 = 9 000 € chaque mois. B : janvier C4 (4 500 €) ; février C4 + C12 + C13 (4 500 + 1 500 + 1 500 = 7 500 €) → 12 000 €.
    const lines = [...MONTHS.flatMap((m) => ["C1", "C2", "C3"].flatMap((c) => paid(m, c, "A", 200000))), ...paid("2026-01", "C4", "B", 300000), ...paid("2026-02", "C4", "B", 300000), ...paid("2026-02", "C12", "B", 100000), ...paid("2026-02", "C13", "B", 100000)];
    const m = maskServiceRows(serviceRows(journalOf(lines, MONTHS), MONTHS, PREV), link, set(3));
    const b = m.find((r) => r.value === "B")!;
    const a = m.find((r) => r.value === "A")!;
    expect(b.cur.kind === "value" && b.cur.masse).toBe(1200000);
    expect(a.cur.kind === "value" && a.cur.masse).toBe(1800000);
    // Janvier de B (1 personne) masqué ; le total de la ligne B étant affiché, février (3 personnes) l'est aussi ; dans la colonne de
    // janvier, A est masqué à son tour (ensemble 4 personnes), puis février de A pour sa propre ligne.
    expect(b.cur.months.map((x) => x.kind)).toEqual(["nd", "nd"]);
    expect(a.cur.months.map((x) => x.kind)).toEqual(["nd", "nd"]);
    expect(b.hidden).toBe(true);
    expect(a.hidden).toBe(true);
    expect(a.reason).toBe(R3);
  });
  it("effectif non dénombré : contrat non relié sous le seuil, ou montant sans contrat (« Non ventilé »), même avec un seuil de 1", () => {
    // D : C9 (non relié) + C10 (P8) 1 500 € chacun ; Non ventilé : une taxe de 100,00 € sans contrat ni service ; A : 3 personnes.
    const lines = [...["C1", "C2", "C3"].flatMap((c) => paid("2026-01", c, "A", 200000)), ...paid("2026-01", "C9", "D", 100000), ...paid("2026-01", "C10", "D", 100000), line("2026-01", "631100", "Taxe sur les salaires", 10000, null, null)];
    const j = journalOf(lines, ["2026-01"]);
    // Seuil 3 : D et Non ventilé non vérifiables ; ensemble ils ne comptent qu'une personne reliée (P8) < 3 : A (3 personnes) est masqué
    // à son tour, sinon leur somme se lirait par différence avec le total.
    const m3 = maskServiceRows(serviceRows(j, ["2026-01"], ["2025-01"]), link, set(3));
    expect(m3.map((r) => [r.value, r.cur.kind, r.reason])).toEqual([["A", "nd", R3], ["D", "nd", SEUIL_NON_VERIFIABLE], [null, "nd", SEUIL_NON_VERIFIABLE]]);
    expect(m3[1].cur).toMatchObject({ kind: "nd", nd: { reason: SEUIL_NON_VERIFIABLE } });
    // Seuil 1 : D compte une personne reliée (P8) ≥ 1 ; la ligne sans contrat reste non vérifiable et ne compte personne : la plus petite
    // ligne affichée (D, 3 000 € < 9 000 €) est masquée à son tour pour la protéger ; A reste.
    const m1 = maskServiceRows(serviceRows(j, ["2026-01"], ["2025-01"]), link, set(1));
    expect(m1.map((r) => [r.value, r.cur.kind, r.reason])).toEqual([["A", "value", null], ["D", "nd", confidentialiteReason(1)], [null, "nd", SEUIL_NON_VERIFIABLE]]);
    // Sans la ligne sans contrat, seuil 1 : rien n'est masqué.
    const m1b = maskServiceRows(serviceRows(journalOf(lines.slice(0, -1), ["2026-01"]), ["2026-01"], ["2025-01"]), link, set(1));
    expect(m1b.map((r) => [r.value, r.cur.kind, r.reason])).toEqual([["A", "value", null], ["D", "value", null]]);
  });
  it("sans référentiel (aucun lien) : aucun contrat n'est relié, tout service rémunéré est non vérifiable", () => {
    const m = maskServiceRows(rows, new Map(), set(3));
    expect(m.every((r) => r.hidden && r.reason === SEUIL_NON_VERIFIABLE)).toBe(true);
  });
  it("seuil absent ou illisible : toutes les lignes n.d. avec la raison du paramètre, jamais une valeur, y compris les mois", () => {
    const m = maskServiceRows(rows, link, ABSENT);
    expect(m.every((r) => r.hidden && r.reason === SEUIL_NON_DEFINI && r.cur.kind === "nd" && r.prev.kind === "nd" && r.evo.kind === "nd")).toBe(true);
    expect(m[0].cur.months.map((x) => (x.kind === "nd" ? x.nd.reason : "valeur"))).toEqual([SEUIL_NON_DEFINI, SEUIL_NON_DEFINI]);
    expect(maskServiceRows(rows, link, { kind: "invalid", raw: "5" })[0].reason).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
  });
  it("garde du filtre Service : service masqué (même secondaire) → n.d. ; service affiché → rien ; seuil absent → lien vers Paramètres", () => {
    const m = maskServiceRows(rows, link, set(3));
    expect(serviceGuard(m, "B", set(3))).toEqual({ cause: "seuil", reason: `${R3} — service retenu par le filtre` });
    expect(serviceGuard(m, "A", set(3))).toBeNull();
    expect(serviceGuard(m, "ZZ", set(3))).toBeNull();
    expect(serviceGuard(m, "A", ABSENT)).toEqual({ cause: "parametre", reason: SEUIL_NON_DEFINI });
  });
});

// --- Fixe & variable : libellés de paie et familles de prime ------------------------------------------------------------------------
// Janvier 2026 : salaires C1, C2, C3 (3 personnes, 3 × 2 000 = 6 000 €) ; « Primes sur objectif » C1 seule 300,00 € ; « Primes de
// vacances » C1, C2, C3 100,00 € chacune = 300,00 €. Février : salaires idem ; « Primes sur objectif » C1 200,00 € ; aucune prime de vacances.
const fv: LedgerLine[] = [];
for (const m of MONTHS) for (const c of ["C1", "C2", "C3"]) fv.push(line(m, "641100", "Salaires", 200000, c, "A"));
fv.push(line("2026-01", "641300", "Primes sur objectif", 30000, "C1", "A"), line("2026-02", "641300", "Primes sur objectif", 20000, "C1", "A"));
for (const c of ["C1", "C2", "C3"]) fv.push(line("2026-01", "641300", "Primes de vacances", 10000, c, "A"));
const FV = journalOf(fv, MONTHS);
const K = { sal: labelKey("salaires", "Salaires"), obj: labelKey("primes", "Primes sur objectif"), vac: labelKey("primes", "Primes de vacances") };

describe("libellés de paie : contrats et seuil (cas écrits à la main)", () => {
  it("contrats par libellé : mêmes clés que labelTotals ; un contrat cité deux fois compte une fois ; sans ligne du libellé le mois : absent", () => {
    expect(labelContracts(FV, MONTHS)).toEqual(new Map([[K.sal, ["C1", "C2", "C3"]], [K.obj, ["C1"]], [K.vac, ["C1", "C2", "C3"]]]));
    expect([...labelContracts(FV, ["2026-02"]).keys()].sort()).toEqual([K.sal, K.obj].sort());
    expect(labelTotals(FV, MONTHS).map((t) => t.key).sort()).toEqual(Object.values(K).sort());
    expect(labelTotals(FV, MONTHS).find((t) => t.key === K.obj)?.cents).toBe(50000);
  });
  it("seuil 3 : « Primes sur objectif » (1 personne) masquée ; le brut étant publié, « Primes de vacances » (300 € < salaires) est masquée à son tour ; les salaires restent", () => {
    const m = maskLabels({ input: FV, months: MONTHS, prevMonths: PREV, keys: [K.sal, K.obj, K.vac], families: [K.obj, K.vac], link, conf: set(3), prevNd: true });
    expect(m.labels[K.sal]).toEqual({ cur: null, prev: null });
    expect(m.labels[K.obj]).toEqual({ cur: R3, prev: null });
    expect(m.labels[K.vac]).toEqual({ cur: R3, prev: null });
    // Familles par mois : objectif masquée les deux mois (1 personne) ; vacances : janvier masqué pour protéger sa cellule de période,
    // février (aucune prime, aucun contrat) masqué avec objectif dans la colonne de février (sans lui, objectif se lirait par différence).
    expect(m.families[K.obj]).toEqual([R3, R3]);
    expect(m.families[K.vac]).toEqual([R3, R3]);
  });
  it("seuil 1 : rien n'est masqué ; seuil absent : tout est n.d. avec la raison du paramètre", () => {
    const one = maskLabels({ input: FV, months: MONTHS, prevMonths: PREV, keys: [K.sal, K.obj, K.vac], families: [K.obj, K.vac], link, conf: set(1), prevNd: true });
    expect(Object.values(one.labels).every((l) => l.cur === null && l.prev === null)).toBe(true);
    expect(Object.values(one.families).flat().every((r) => r === null)).toBe(true);
    const none = maskLabels({ input: FV, months: MONTHS, prevMonths: PREV, keys: [K.sal, K.obj], families: [K.obj], link, conf: ABSENT, prevNd: false });
    expect(none).toEqual({ labels: { [K.sal]: { cur: SEUIL_NON_DEFINI, prev: SEUIL_NON_DEFINI }, [K.obj]: { cur: SEUIL_NON_DEFINI, prev: SEUIL_NON_DEFINI } }, families: { [K.obj]: [SEUIL_NON_DEFINI, SEUIL_NON_DEFINI] } });
  });
  it("écran Fixe & variable (seuil 3) : cellules n.d. avec la raison sous le tableau, ligne Confidentialité, total du brut conservé (12 800,00 €)", () => {
    const html = renderToStaticMarkup(h(FixeVariableView, { slug: "demo", input: FV, months: MONTHS, prevMonths: PREV, link, confidentialite: set(3) }));
    expect(html).toContain('data-testid="fv-labels-confidentialite"');
    expect(html).toContain("Confidentialité : seuil de 3 personnes");
    expect(html).toMatch(new RegExp(`data-label="Primes sur objectif"><th[^>]*>Primes sur objectif</th><td class="num" data-col="n">${rx(ABBR3)}</td>`));
    expect(html).toMatch(/data-label="Salaires"><th[^>]*>Salaires<\/th><td class="num" data-col="n"><span class="money-display" data-money-cents="1200000"/);
    expect(html).toMatch(/data-testid="fv-labels-total"><th scope="row">Brut<\/th><td class="num" data-col="n"><span class="money-display" data-money-cents="1280000"/);
    expect(html).toContain(R3);
    // Tableau des primes : chaque cellule de famille n.d. ; la colonne « Total primes » du mois (600,00 € en janvier, 200,00 € en février) reste.
    const primes = html.slice(html.indexOf('data-testid="fv-primes-months"'), html.indexOf("</table>", html.indexOf('data-testid="fv-primes-months"')));
    expect(primes).toContain('data-money-cents="60000"');
    expect(primes).toContain('data-money-cents="20000"');
    expect(primes).not.toContain('data-money-cents="30000"'); // les 300,00 € de « Primes sur objectif » (C1 seule) ne se lisent nulle part
    expect((primes.match(/title="non affiché \(seuil de confidentialité : 3 personnes\)"/g) ?? []).length).toBe(6); // 2 mois × 2 familles + 2 cellules de période
    for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  });
  it("écran Fixe & variable sous le filtre Service masqué : tout l'onglet n.d., avec l'action « Retirer le filtre Service »", () => {
    const html = renderToStaticMarkup(h(FixeVariableView, { slug: "demo", input: withService(FV, "A"), months: MONTHS, prevMonths: PREV, link, confidentialite: ABSENT, guard: { cause: "parametre", reason: SEUIL_NON_DEFINI }, unfilterHref: "/x" }));
    expect(html).toContain('data-testid="fv-nd"');
    expect(html).toContain("Retirer le filtre Service");
    expect(html).toContain('href="/e/demo/parametres#confidentialite"');
    expect(html).not.toContain('data-testid="fv-labels"');
    expect(html).not.toContain("data-money-cents");
  });
});

// --- Paie & comptabilité : provision par service ------------------------------------------------------------------------------------
// Fin janvier 2026, dotations « Mois courant » : A (C1, C2, C3) congés 100,00 € + charges 40,00 € chacun = 420,00 € ; B (C4) 100 + 40 =
// 140,00 € ; E (C7, C8, C10) 50 + 20 chacun = 210,00 €. Entreprise : 770,00 €.
const prov: LedgerLine[] = [];
const dot = (m: string, c: string, svc: string, conges: number) => prov.push(line(m, "641200", "Provisions pour conges payes - Mois courant", conges, c, svc), line(m, "648500", "Provisions pour charges sociales - Mois courant", conges * 0.4, c, svc));
for (const m of ["2026-01", "2025-01"]) {
  for (const c of ["C1", "C2", "C3"]) dot(m, c, "A", 10000);
  dot(m, "C4", "B", 10000);
  for (const c of ["C7", "C8", "C10"]) dot(m, c, "E", 5000);
  for (const c of ["C1", "C2", "C3", "C4", "C7", "C8", "C10"]) prov.push(...paid(m, c, c === "C4" ? "B" : ["C1", "C2", "C3"].includes(c) ? "A" : "E", 100000));
}
const PROV = journalOf(prov, ["2025-01", "2026-01"]);

describe("provision par service : contrats et seuil (cas écrits à la main)", () => {
  it("contrats qui portent une ligne de dotation du mois, dans le service filtré", () => {
    expect(provisionContracts(withService(PROV, "A"), "2026-01")).toEqual(["C1", "C2", "C3"]);
    expect(provisionContracts(withService(PROV, "B"), "2026-01")).toEqual(["C4"]);
    expect(provisionContracts(PROV, "2026-01")).toEqual(["C1", "C10", "C2", "C3", "C4", "C7", "C8"]);
    expect(provisionContracts(PROV, "2026-02")).toEqual([]);
  });
  it("seuil 3 : B (1 personne) masqué ; la provision de l'entreprise étant publiée, E (210 € < 420 €) est masqué à son tour ; A reste", () => {
    const inputs = ["A", "B", "E"].map((s) => ({ value: s, input: withService(PROV, s) }));
    const m = maskProvisionServices({ inputs, months: ["2026-01", "2025-01"], link, conf: set(3) });
    expect(m).toEqual({ A: { "2026-01": null, "2025-01": null }, B: { "2026-01": R3, "2025-01": R3 }, E: { "2026-01": R3, "2025-01": R3 } });
    expect(maskProvisionServices({ inputs, months: ["2026-01"], link, conf: set(1) })).toEqual({ A: { "2026-01": null }, B: { "2026-01": null }, E: { "2026-01": null } });
    expect(maskProvisionServices({ inputs, months: ["2026-01"], link, conf: ABSENT })).toEqual({ A: { "2026-01": SEUIL_NON_DEFINI }, B: { "2026-01": SEUIL_NON_DEFINI }, E: { "2026-01": SEUIL_NON_DEFINI } });
  });
  it("écran Paie & comptabilité (seuil 3) : tuile de l'entreprise 770,00 € conservée ; lignes B et E n.d. avec la raison ; A 420,00 €", () => {
    const compta = { source: null, reason: "aucune", lines: [], months: [], nd: {}, error: false };
    const html = renderToStaticMarkup(h(PaieComptaView, { slug: "demo", input: PROV, fullInput: PROV, months: ["2026-01"], serviceFiltered: false, compta, link, confidentialite: set(3) }));
    expect(html).toMatch(/data-testid="pc-tile-provision"[^]*?<dd[^>]*><span class="money-display" data-money-cents="77000"/);
    expect(html).toContain('data-testid="pc-provision-services-confidentialite"');
    const table = html.slice(html.indexOf('data-testid="pc-provision-services"'), html.indexOf("</table>", html.indexOf('data-testid="pc-provision-services"')));
    expect(table).toMatch(/data-service="A"><th scope="row">A<\/th><td class="num" data-col="total"><span class="money-display" data-money-cents="42000"/);
    expect(table).toContain(`data-service="B"><th scope="row">B</th><td class="num" data-col="total">${ABBR3}</td><td class="num n1">${ABBR3}</td><td class="num">${ABBR3}</td><td class="num">${ABBR3}</td><td class="num">${ABBR3}</td>`);
    expect(table).not.toContain('data-money-cents="14000"');
    expect(html).toContain(`B 2026-01 : ${R3}`);
    // Sous le filtre Service B : toute la provision du service est n.d. (tuile et tableau mensuel), avec l'action pour retirer le filtre.
    const filtered = renderToStaticMarkup(h(PaieComptaView, { slug: "demo", input: withService(PROV, "B"), fullInput: PROV, months: ["2026-01"], serviceFiltered: true, serviceValue: "B", compta, link, confidentialite: set(3), unfilterHref: "/x" }));
    expect(filtered).toContain('data-testid="pc-provision-nd"');
    expect(filtered).toContain(`Non affiché (seuil de confidentialité : 3 personnes) — service retenu par le filtre`);
    expect(filtered).not.toContain('data-testid="pc-tile-provision"');
    expect(filtered).not.toContain('data-testid="pc-provision-months"');
    // Service A (3 personnes) : affiché sous le filtre.
    const shown = renderToStaticMarkup(h(PaieComptaView, { slug: "demo", input: withService(PROV, "A"), fullInput: PROV, months: ["2026-01"], serviceFiltered: true, serviceValue: "A", compta, link, confidentialite: set(3) }));
    expect(shown).not.toContain('data-testid="pc-provision-nd"');
    expect(shown).toContain('data-money-cents="42000"');
  });
});

// --- Synthèse (page) et export Excel ---------------------------------------------------------------------------------------------
const ctxOf = (input: JournalInput) => ({
  kpi: { collab: { workspace: { id: "w1" } }, input: { data: DATA } },
  source: "payfit",
  grid: { grid: DEFAULT_PREFIXES, origin: "default", updatedAt: null },
  read: { syncId: "s1", startedAt: new Date("2026-03-03T10:00:00Z"), months: input.months },
  unavailable: null,
  input,
  etp: (months: string[]) => months.map((m) => ({ month: m, etp4: 30000, reason: null })),
  axes: ["Service"],
  service: { axis: "Service", origin: "single-axis", updatedAt: null },
  dsn: new Map(),
  etpQualifiers: [],
  compta: async () => ({ source: null, reason: "aucune", lines: [], months: [], nd: {}, error: false }),
  axisMissing: false,
});
const page = async (sp: Record<string, string>, conf: ConfidentialiteSetting) => {
  state.ctx = ctxOf(REF);
  state.conf = conf;
  const { default: Page } = await import("@/app/e/[slug]/studio-rh/masse-salariale/page");
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "demo" }), searchParams: Promise.resolve({ annee: "2026", de: "01", a: "02", ...sp }) }));
  for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  return html;
};
const tableOf = (html: string, testid: string) => html.slice(html.indexOf(`data-testid="${testid}"`), html.indexOf("</table>", html.indexOf(`data-testid="${testid}"`)));

describe("Synthèse : tableau par service, graphiques, filtre Service, export (seuil 3)", () => {
  it("tableau Services : B, E, C n.d. (raison sous le tableau), A et le total de l'entreprise (37 500,00 €) affichés ; ligne Confidentialité", async () => {
    const html = await page({}, set(3));
    expect(html).toContain("Confidentialité : seuil de 3 personnes");
    expect(html).toContain('data-testid="ms-services-confidentialite"');
    expect(html).toContain('data-testid="ms-services-months-confidentialite"');
    const t = tableOf(html, "ms-services-table");
    expect(t).toMatch(/data-service="A"[^]*?data-col="n"><span class="money-display" data-money-cents="1800000"/);
    // Chaque cellule de la ligne masquée est « n.d. » avec la raison au survol (abbr.nd, ce que la spec e2e compte dans la colonne N).
    expect(t).toMatch(new RegExp(`data-service="B"[^]*?<td class="num" data-col="n">${rx(ABBR3)}</td><td class="num n1" data-col="n1">${rx(ABBR3)}</td><td class="num" data-col="ecart">${rx(ABBR3)}</td><td class="num" data-col="ecart-pct">${rx(ABBR3)}</td><td class="num" data-col="part">${rx(ABBR3)}</td><td class="num" data-col="hors-primes">${rx(ABBR3)}</td><td class="num" data-col="primes">${rx(ABBR3)}</td><td class="num" data-col="cotisations">${rx(ABBR3)}</td><td class="num" data-col="cout-pm">${rx(ABBR3)}</td>`));
    expect((t.match(/<td class="num" data-col="n"><abbr class="nd"/g) ?? []).length).toBe(3); // B, E, C : trois lignes masquées dans la colonne N
    expect(t).toMatch(/data-testid="ms-services-total">[^]*?data-col="n"><span class="money-display" data-money-cents="3750000"/);
    // Aucun montant dans les lignes masquées (B, E, C), ni leur N-1 (810 000, 540 000, 405 000 centimes).
    for (const svc of ["B", "E", "C"]) expect(t.slice(t.indexOf(`data-service="${svc}"`), t.indexOf("</tr>", t.indexOf(`data-service="${svc}"`)))).not.toContain("data-money-cents");
    for (const cents of ['"810000"', '"540000"', '"405000"']) expect(t).not.toContain(`data-money-cents=${cents}`);
    expect(html).toMatch(/data-testid="ms-services-nd-reasons"[^]*?B, B \(N-1\), E, E \(N-1\), C, C \(N-1\) : non affiché \(seuil de confidentialité : 3 personnes\)/);
    // Service × mois : les mois de B, E, C n.d. ; le total du mois (18 750,00 €) reste ; les parts de l'anneau n.d. sont listées avec la raison.
    const m = tableOf(html, "ms-services-months");
    expect(m).toContain(`data-service="B"><th scope="row">B</th><td class="num" data-col="2026-01">${ABBR3}</td><td class="num" data-col="2026-02">${ABBR3}</td><td class="num" data-col="periode">${ABBR3}</td>`);
    expect(m).toMatch(/data-testid="ms-services-months-total">[^]*?data-col="2026-01"><span class="money-display" data-money-cents="1875000"/);
    expect(html).toContain('data-testid="ms-services-months-nd"');
    expect((html.match(/non affiché \(seuil de confidentialité : 3 personnes\)/g) ?? []).length).toBeGreaterThan(0);
  });
  it("filtre Service A (3 personnes) : affiché ; filtre Service B : tuiles, tableau mensuel et détail n.d., action « Retirer le filtre Service »", async () => {
    const a = await page({ service: "A" }, set(3));
    expect(a).not.toContain('data-testid="ms-service-guard"');
    expect(a).toMatch(/data-testid="ms-tile-masse"[^]*?<dd><span class="money-display" data-money-cents="1800000"/);
    const b = await page({ service: "B", mois: "2026-01" }, set(3));
    expect(b).toContain('data-testid="ms-service-guard"');
    expect(b).toContain("Retirer le filtre Service");
    expect(b).toContain(`${R3} — service retenu par le filtre`); // raison listée sous les tuiles
    expect(b).toContain(`Non affiché (seuil de confidentialité : 3 personnes) — service retenu par le filtre`); // état vide
    expect(b).toMatch(/data-testid="ms-tile-masse"[^]*?<dd class="nd">n\.d\.<\/dd>/);
    expect(b).toContain('data-testid="ms-detail-nd"');
    expect(b).not.toContain('data-testid="ms-composition"');
    const monthly = tableOf(b, "ms-monthly-table");
    expect(monthly).not.toContain("data-money-cents");
    expect(monthly).toContain('data-col="etp"><span class="nd"');
    // Le tableau Services (tous les services) reste : A affiché, la ligne B sélectionnée et n.d.
    expect(tableOf(b, "ms-services-table")).toContain('data-money-cents="1800000"');
    expect(tableOf(b, "ms-services-table")).toMatch(/data-service="B" class="selected"/);
  });
  it("seuil non défini : lignes n.d. « non défini » avec le lien vers Paramètres, totaux et tuiles de l'entreprise conservés ; sous le filtre, service n.d. avec le lien", async () => {
    const html = await page({}, ABSENT);
    expect(html).toContain("Confidentialité : seuil non défini (<a href=\"/e/demo/parametres#confidentialite\">Paramètres</a>)");
    expect(html).toMatch(/data-testid="ms-tile-masse"[^]*?<dd><span class="money-display" data-money-cents="3750000"/);
    const t = tableOf(html, "ms-services-table");
    expect(t).not.toContain('data-money-cents="1800000"');
    expect(t).toContain('data-money-cents="3750000"');
    expect(html).toContain(SEUIL_NON_DEFINI);
    const b = await page({ service: "A" }, ABSENT);
    expect(b).toContain('data-testid="ms-service-guard"');
    expect(b).toContain("Définir le seuil de confidentialité dans Paramètres");
    expect(b).toMatch(/data-testid="ms-tile-masse"[^]*?<dd class="nd">n\.d\.<\/dd>/);
  });
  it("export Excel : feuilles Services et Services par mois portent les mêmes n.d. (raison en commentaire), total conservé ; sous le filtre masqué, « Mois par mois » n.d.", () => {
    const s = syntheseOf(ctxOf(REF) as never, { annee: "2026", de: "01", a: "02" }, set(3));
    if (s.kind !== "ready") throw new Error("contexte fictif incomplet");
    const sv = servicesSheet({ rows: s.services, totalCur: s.totalCur, totalPrev: s.totalPrev, totalEvo: s.totalEvo, year: s.year });
    expect(sv.rows.map((r) => r[0])).toEqual(["A", "B", "E", "C", "Total"]);
    expect(sv.rows[0].slice(1, 4)).toEqual([1800000, 1620000, 180000]);
    expect(sv.rows[1].slice(1, 10)).toEqual(Array(9).fill({ nd: R3 }));
    expect(sv.rows[4].slice(1, 3)).toEqual([3750000, 3375000]);
    const sm = servicesMonthsSheet({ rows: s.services, totalCur: s.totalCur, months: s.months });
    expect(sm.rows[1]).toEqual(["B", { nd: R3 }, { nd: R3 }, { nd: R3 }, ""]);
    expect(sm.rows[4]).toEqual(["Total", 1875000, 1875000, 3750000, ""]);
    // Filtre Service B : la période, N-1, les mois, l'ETP et le coût par ETP portent la raison de la garde (lus par « Mois par mois »).
    const g = syntheseOf(ctxOf(REF) as never, { annee: "2026", de: "01", a: "02", service: "B" }, set(3));
    if (g.kind !== "ready") throw new Error("contexte fictif incomplet");
    expect(g.guard).toEqual({ cause: "seuil", reason: `${R3} — service retenu par le filtre` });
    expect(g.cur.kind).toBe("nd");
    expect(g.cur.months.every((m) => m.kind === "nd" && m.nd.reason === g.guard!.reason)).toBe(true);
    expect(g.etpCur.every((e) => e.etp4 === null && e.reason === g.guard!.reason)).toBe(true);
    expect(g.cost.kind).toBe("nd");
    // Sans seuil fourni à syntheseOf : traité comme non défini (jamais un masquage par défaut plus faible).
    const d = syntheseOf(ctxOf(REF) as never, { annee: "2026", de: "01", a: "02" });
    expect(d.kind === "ready" && d.services.every((r) => r.reason === SEUIL_NON_DEFINI)).toBe(true);
  });
});
