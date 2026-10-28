import { describe, expect, it } from "vitest";
import { landing, project } from "@/lib/budget/engine";
import { retraite, sensitivities, type ActualNonRecurringInput } from "@/lib/budget/lot3";
import type { BaseSnapshot, Hypothesis, Projection } from "@/lib/budget/types";
import type { ActualEvent } from "@/lib/payroll/non-recurring";
import { estimateActualOverlap } from "@/lib/payroll/actual-overlap";

const SYNC = "00000000-0000-4000-8000-000000000001";
const OTHER_SYNC = "00000000-0000-4000-8000-000000000002";
const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const conv = { prorata: "calendaire" as const };
const base = (): BaseSnapshot => ({
  currency: "EUR", refMonth: "2026-09", syncId: SYNC, readAt: "2026-10-01",
  contracts: [{ contractKey: "contrat-fictif", externalId: "fictif", label: "Poste fictif", service: null, serviceNd: null,
    startDate: "2024-01-01", endDate: null, counted: true, etp4: 10_000, etpNd: null,
    base: { salaryCents: 10_000, refBrutCents: 10_000, refCotisationsCents: 0 }, baseNd: null }],
  actuals: Array.from({ length: 9 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, kind: "value", brut: 10_000, cotisations: 0, masse: 10_000, headcount: 1, etp4: 10_000, etpNd: null })),
  refMasse: 10_000, refBaseCost: 10_000, etpNote: null,
});
const event = (index = 1, over: Partial<ActualEvent> = {}): ActualEvent => ({
  id: id(index), syncId: SYNC, month: "2026-01", kind: "rupture-conventionnelle", chargedCents: 1_000,
  contractKeys: ["contrat-fictif"], note: "Justificatif entièrement fictif", ...over,
});
const actual = (events: ActualEvent[]): ActualNonRecurringInput => ({ kind: "value", events });
const events = () => [event(), event(2, { kind: "tuilage", month: "2026-06", chargedCents: 2_000, contractKeys: ["contrat-fictif", "contrat-fictif-2"] }), event(3, { kind: "tuilage", month: "2026-09", chargedCents: 3_000, contractKeys: ["contrat-fictif-3", "contrat-fictif-4"] })];
const projection = (snapshot: BaseSnapshot, hyps: Hypothesis[] = []) => project(snapshot, "2026-10", "2026-12", hyps, conv);

describe("Atterrissage retraité — événements du réel rattachés à la base figée", () => {
  it("retire une estimation une seule fois et conserve sa qualification sans toucher au brut", () => {
    const calc = estimateActualOverlap({ month: "2026-06", syncId: SYNC,
      incoming: { contractKey: "entrant-fictif", syncId: SYNC, startDate: "2026-06-11", endDate: null },
      outgoing: { contractKey: "sortant-fictif", syncId: SYNC, startDate: "2020-01-01", endDate: "2026-06-20" },
      payroll: { syncId: SYNC, month: "2026-06", contractKey: "entrant-fictif", chargedCents: 4_000, lineKeys: ["LIGNE_FICTIVE_PRIVEE"] } });
    if (calc.kind !== "value") throw new Error("Fixture refusée");
    const calculated = event(1, { month: "2026-06", kind: "tuilage", chargedCents: calc.amountCents, contractKeys: ["entrant-fictif", "sortant-fictif"], calculation: calc.calculation });
    const snapshot = base(), proj = projection(snapshot), gross = landing(snapshot, proj, "2026");
    const result = retraite(snapshot, proj, [], "2026", actual([calculated]));
    expect(result).toMatchObject({ kind: "value", atterrissage: 120_000, realised: 2_000, total: 2_000, retraite: 118_000, qualification: expect.stringContaining("estimation calendaire"), rows: [{ label: "Tuilages réalisés — estimation calendaire", realised: 2_000, projected: 0 }] });
    expect(landing(snapshot, proj, "2026")).toEqual(gross);
    expect(JSON.stringify(result)).not.toMatch(/LIGNE_FICTIVE_PRIVEE|entrant-fictif|sortant-fictif/);
    expect(retraite(snapshot, proj, [], "2026", actual([calculated, { ...calculated, id: id(2) }]))).toMatchObject({ kind: "nd", reason: expect.stringContaining("doublon") });
  });
  it("retire la RC passée et les deux tuilages une fois, sans les ajouter au brut ni à la projection", () => {
    const snapshot = base(), proj = projection(snapshot), input = actual(events());
    const before = JSON.stringify([snapshot, proj, input]);
    const gross = landing(snapshot, proj, "2026");
    expect(gross).toMatchObject({ kind: "value", actual: 90_000, projected: 30_000, total: 120_000 });
    const result = retraite(snapshot, proj, [], "2026", input);
    expect(result).toEqual({ kind: "value", year: "2026", atterrissage: 120_000,
      rows: [{ label: "Ruptures conventionnelles réalisées", realised: 1_000, projected: 0 }, { label: "Tuilages réalisés", realised: 5_000, projected: 0 }],
      realised: 6_000, projected: 0, total: 6_000, retraite: 114_000 });
    expect(landing(snapshot, proj, "2026")).toEqual(gross);
    expect(JSON.stringify([snapshot, proj, input])).toBe(before);
  });

  it("conserve les coûts de sortie futurs dans le brut et les retire une seule fois avec les coûts passés", () => {
    const snapshot = base();
    const hyps: Hypothesis[] = [{ id: "depart-fictif", kind: "depart", label: "Départ fictif", contractKey: "contrat-fictif", lastPaidDate: "2026-11-30", exitCost: { mode: "charge", costCents: 5_000 } }];
    const proj = projection(snapshot, hyps);
    expect(landing(snapshot, proj, "2026")).toMatchObject({ kind: "value", total: 115_000 });
    const result = retraite(snapshot, proj, hyps, "2026", actual(events()));
    expect(result).toMatchObject({ kind: "value", atterrissage: 115_000, realised: 6_000, projected: 5_000, total: 11_000, retraite: 104_000 });
    expect(result.kind === "value" && result.rows.find((row) => row.label === "Coûts de sortie (hypothèses de départ)")).toEqual({ label: "Coûts de sortie (hypothèses de départ)", realised: 0, projected: 5_000 });
  });

  it("sans option garde les calculs historiques et ne change pas la sémantique du moteur pour un départ sans coût saisi", () => {
    const snapshot = base();
    const hyps: Hypothesis[] = [{ id: "depart-fictif", kind: "depart", label: "Départ fictif", contractKey: "contrat-fictif", lastPaidDate: "2026-11-30", exitCost: null }];
    const proj = projection(snapshot, hyps), before = JSON.stringify(proj);
    expect(retraite(snapshot, proj, hyps, "2026")).toEqual(retraite(snapshot, proj, hyps, "2026", actual([])));
    retraite(snapshot, proj, hyps, "2026", actual(events()));
    expect(JSON.stringify(proj)).toBe(before);
  });

  it("distingue montant absent et zéro explicite, sans exposer note ni identifiant dans la raison", () => {
    const snapshot = base(), proj = projection(snapshot);
    const missing = event(1, { chargedCents: null, note: "MARQUEUR_NOTE_FICTIVE_PRIVE", contractKeys: ["MARQUEUR_CONTRAT_FICTIF_PRIVE"] });
    const result = retraite(snapshot, proj, [], "2026", actual([event(2, { month: "2026-02" }), missing]));
    expect(result).toMatchObject({ kind: "nd", reason: expect.stringContaining("Ruptures conventionnelles réalisées — 2026-01") });
    expect(result.kind === "nd" && result.reason).toContain("montant chargé non saisi");
    expect(JSON.stringify(result)).not.toContain("MARQUEUR_"); expect(JSON.stringify(result)).not.toContain(missing.id);
    expect(retraite(snapshot, proj, [], "2026", actual([event(1, { chargedCents: 0 })]))).toMatchObject({ kind: "value", realised: 0, retraite: 120_000 });
  });

  it("se rattache à la lecture figée et ne reprend pas une déclaration d’une autre lecture", () => {
    const snapshot = base(), proj = projection(snapshot);
    const result = retraite(snapshot, proj, [], "2026", actual([event(1, { syncId: OTHER_SYNC })]));
    expect(result).toMatchObject({ kind: "nd", reason: expect.stringContaining("autre lecture") });
    expect(JSON.stringify(result)).not.toContain(OTHER_SYNC);
    expect(retraite(snapshot, proj, [], "2026", actual([event()]))).toMatchObject({ kind: "value", realised: 1_000 });
  });

  it("écarte hors année et après refMonth, sans promouvoir un événement futur au réel figé", () => {
    const snapshot = base(), proj = projection(snapshot);
    const result = retraite(snapshot, proj, [], "2026", actual([event(1, { month: "2025-01", syncId: OTHER_SYNC }), event(2, { month: "2026-11", chargedCents: null }), event(3)]));
    expect(result).toMatchObject({ kind: "value", realised: 1_000, total: 1_000, retraite: 119_000 });
  });

  it("un mois projeté par le parent n’est pas traité comme du réel connu", () => {
    const snapshot = base(); snapshot.actuals = snapshot.actuals.filter((month) => month.month !== "2026-01");
    snapshot.prior = [{ month: "2026-01", kind: "value", cost: 10_000, brut: 10_000, charges: 0, headcount: 1, etp4: 10_000, etpNd: null, source: "Parent fictif" }];
    const proj = projection(snapshot);
    expect(landing(snapshot, proj, "2026").kind).toBe("value");
    expect(retraite(snapshot, proj, [], "2026", actual([event()]))).toMatchObject({ kind: "nd", reason: expect.stringContaining("mois absent du réel connu") });
  });

  it("refuse les doublons d’identifiant ou de catégorie/mois/binôme même si les montants sont différents", () => {
    const snapshot = base(), proj = projection(snapshot), overlap = events()[1];
    const duplicates = [[event(), event(1, { month: "2026-02" })], [overlap, { ...overlap, id: id(5), chargedCents: 9_999, contractKeys: [...overlap.contractKeys].reverse() }]];
    for (const duplicate of duplicates) expect(retraite(snapshot, proj, [], "2026", actual(duplicate))).toMatchObject({ kind: "nd", reason: expect.stringContaining("doublon") });
  });

  it("combine les anciennes saisies des autres mois, mais refuse un ancien réalisé sur le mois d’un événement du Réel", () => {
    const snapshot = base();
    const legacy: Hypothesis = { id: "ancienne-saisie-fictive", kind: "realise", label: "LIBELLE_FICTIF_PRIVE", category: "Prime fictive", month: "2026-03", costCents: 5_000 };
    const result = retraite(snapshot, projection(snapshot, [legacy]), [legacy], "2026", actual(events()));
    expect(result).toMatchObject({ kind: "value", realised: 11_000, retraite: 109_000 });
    const sameMonth: Hypothesis = { ...legacy, month: "2026-06" };
    const blocked = retraite(snapshot, projection(snapshot, [sameMonth]), [sameMonth], "2026", actual(events()));
    expect(blocked).toMatchObject({ kind: "nd", reason: expect.stringContaining("ancienne saisie réalisée") });
    expect(JSON.stringify(blocked)).not.toContain(legacy.id); expect(JSON.stringify(blocked)).not.toContain(legacy.label);
  });

  it("une lecture en erreur ou une déclaration illisible n’est jamais remplacée par une liste vide", () => {
    const snapshot = base(), proj = projection(snapshot);
    const result = retraite(snapshot, proj, [], "2026", { kind: "nd", reason: "MARQUEUR_ERREUR_FICTIVE_PRIVE" });
    expect(result).toMatchObject({ kind: "nd", reason: expect.stringContaining("Lecture") });
    expect(JSON.stringify(result)).not.toContain("MARQUEUR_");
    expect(retraite(snapshot, proj, [], "2026", actual([event(1, { chargedCents: 0.5 })]))).toMatchObject({ kind: "nd", reason: expect.stringContaining("invalide") });
  });

  it("borne les groupes, totaux, retraits et contributions en centimes entiers sûrs", () => {
    const snapshot = base(), proj = projection(snapshot);
    const many = Array.from({ length: 91 }, (_, i) => event(i + 1, { kind: "autre", chargedCents: 100_000_000_000_000, contractKeys: [`contrat-fictif-${i}`] }));
    expect(retraite(snapshot, proj, [], "2026", actual(many))).toMatchObject({ kind: "nd", reason: expect.stringContaining("entiers sûrs") });
    const legacy: Hypothesis = { id: "fraction-fictive", kind: "realise", label: "Fraction fictive", category: "Autre", month: "2026-03", costCents: 0.5 };
    expect(retraite(snapshot, projection(snapshot, [legacy]), [legacy], "2026")).toMatchObject({ kind: "nd", reason: expect.stringContaining("entiers sûrs") });
    const unsafe: Projection = { kind: "value", months: ["2026-10", "2026-11", "2026-12"].map((month) => ({ month, kind: "value", cost: Number.MAX_SAFE_INTEGER, brut: Number.MAX_SAFE_INTEGER, charges: 0, headcount: 1, etp4: 10_000, etpNd: null, contributions: [] })) };
    expect(retraite(snapshot, unsafe, [], "2026")).toMatchObject({ kind: "nd", reason: expect.stringContaining("entiers sûrs") });
  });

  it("transmet les mêmes événements à la référence et à chaque variante, sans faire varier le passé", () => {
    const snapshot = base();
    const hyps: Hypothesis[] = [{ id: "ponctuel-fictif", kind: "ponctuel", label: "Prime fictive", month: "2026-12", amount: { mode: "charge", costCents: 2_000 }, service: null, nonRecurring: true }];
    const variants = [{ hypothesisId: "ponctuel-fictif", kind: "pct" as const, delta: 5_000 }];
    const result = sensitivities(snapshot, "2026-10", "2026-12", hyps, conv, "2026", variants, actual(events()));
    expect(result.reference).toMatchObject({ kind: "value", realised: 6_000, projected: 2_000, retraite: 114_000 });
    expect(result.rows[0].effect).toEqual({ kind: "value", atterrissage: 1_000, retraite: 0, total: 123_000 });
    const absent = sensitivities(snapshot, "2026-10", "2026-12", hyps, conv, "2026", variants, actual([event(1, { chargedCents: null })]));
    expect(absent.reference.kind).toBe("nd"); expect(absent.rows[0].effect).toMatchObject({ kind: "value", atterrissage: 1_000, retraite: null });
  });
});
