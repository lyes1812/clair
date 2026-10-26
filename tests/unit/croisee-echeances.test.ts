import { describe, expect, it } from "vitest";
import { contractEcheances, type EcheanceContract } from "@/lib/croisee/echeances";

// Échéances de contrat (chapitre 02) : cas de référence écrit à la main, valeurs fictives. Lecture RH du 30/09/2026, horizon de 90 jours :
// 30/09 + 30 j = 30/10, + 60 j = 29/11, + 90 j = 29/12 ; fenêtre retenue : du 01/10/2026 au 29/12/2026 inclus. Natures comptées : 01, 02.
//   a  CDD  fin 15/10/2026                    → fin de contrat, octobre, 02
//   b  CDI  début 02/11/2026                  → entrée, novembre, 01
//   c  CDD  début 01/10/2026, fin 29/12/2026  → entrée en octobre et fin en décembre (dernier jour inclus), 02
//   d  CDD  fin 30/09/2026 (jour de la lecture) → hors fenêtre (déjà connu de la lecture)
//   e  CDD  fin 30/12/2026                    → au-delà de l'horizon
//   f  stage (29) fin 20/10/2026              → nature non comptée
//   g  CDI sans date de début                 → non daté (compté à part)
//   h  nature absente, fin 10/10/2026         → non comptée
//   i  CDD  début 30/09/2026                  → hors fenêtre
// Attendu : octobre 02 (1 fin, 1 entrée) ; novembre 01 (0 fin, 1 entrée) ; décembre 02 (1 fin, 0 entrée) ; 2 fins, 2 entrées, 1 non daté.
const CONTRATS: EcheanceContract[] = [
  { startDate: "2026-03-01", endDate: "2026-10-15", nature: "02" },
  { startDate: "2026-11-02", endDate: null, nature: "01" },
  { startDate: "2026-10-01", endDate: "2026-12-29", nature: "02" },
  { startDate: "2026-01-05", endDate: "2026-09-30", nature: "02" },
  { startDate: "2026-02-01", endDate: "2026-12-30", nature: "02" },
  { startDate: "2026-04-01", endDate: "2026-10-20", nature: "29" },
  { startDate: null, endDate: null, nature: "01" },
  { startDate: "2026-05-01", endDate: "2026-10-10", nature: null },
  { startDate: "2026-09-30", endDate: null, nature: "02" },
];

describe("contractEcheances : cas de référence", () => {
  it("fins de contrat et entrées dans l'horizon, par mois et par nature, depuis la date de lecture", () => {
    expect(contractEcheances({ referenceDate: "2026-09-30", horizonDays: 90, natures: ["01", "02"], contracts: CONTRATS })).toEqual({
      kind: "value",
      from: "2026-10-01",
      to: "2026-12-29",
      horizon: 90,
      lines: [
        { month: "2026-10", nature: "02", fins: 1, entrees: 1 },
        { month: "2026-11", nature: "01", fins: 0, entrees: 1 },
        { month: "2026-12", nature: "02", fins: 1, entrees: 0 },
      ],
      fins: 2,
      entrees: 2,
      undated: 1,
    });
  });

  it("horizon plus court : seules les échéances jusqu'au 15/10/2026 (15 jours) restent", () => {
    const e = contractEcheances({ referenceDate: "2026-09-30", horizonDays: 15, natures: ["01", "02"], contracts: CONTRATS });
    expect(e.kind === "value" && e.lines).toEqual([{ month: "2026-10", nature: "02", fins: 1, entrees: 1 }]);
  });

  it("aucune échéance : liste vide, totaux à 0 (connus), jamais n.d.", () => {
    const e = contractEcheances({ referenceDate: "2026-09-30", horizonDays: 30, natures: ["01"], contracts: CONTRATS });
    expect(e).toEqual({ kind: "value", from: "2026-10-01", to: "2026-10-30", horizon: 30, lines: [], fins: 0, entrees: 0, undated: 1 });
  });

  it("sans date de lecture ou avec un horizon illisible : n.d. avec la raison", () => {
    expect(contractEcheances({ referenceDate: null, horizonDays: 90, natures: ["01"], contracts: CONTRATS })).toEqual({ kind: "nd", reason: "date de lecture de la source RH absente" });
    expect(contractEcheances({ referenceDate: "2026-09-30", horizonDays: 0, natures: ["01"], contracts: CONTRATS }).kind).toBe("nd");
    expect(contractEcheances({ referenceDate: "2026-09-30", horizonDays: 2.5, natures: ["01"], contracts: CONTRATS }).kind).toBe("nd");
  });
});
