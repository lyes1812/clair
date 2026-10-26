import { describe, expect, it } from "vitest";
import { contractEcheances, type EcheanceContract } from "@/lib/croisee/echeances";

// Échéances de contrat (chapitre 02) : cas de référence écrit à la main, valeurs fictives. Lecture RH du 30/09/2026, horizon de 90 jours :
// 30/09 + 30 j = 30/10, + 60 j = 29/11, + 90 j = 29/12 ; fenêtre retenue : du 01/10/2026 au 29/12/2026 inclus (octobre, novembre,
// décembre). Natures comptées : 01, 02.
//   a  CDD  fin 15/10/2026                         → fin de contrat, octobre, 02
//   b  CDI  début 02/11/2026                       → entrée, novembre, 01
//   c  CDD  début 01/10/2026, fin 29/12/2026       → entrée en octobre et fin en décembre (dernier jour inclus), 02
//   d  CDD  fin 30/09/2026 (jour de la lecture)    → hors fenêtre (déjà connu de la lecture)
//   e  CDD  fin 30/12/2026                         → au-delà de l'horizon
//   f  stage (29) fin 20/10/2026                   → nature non comptée
//   g  CDI sans date de début                      → sans date de début (compté à part)
//   h  nature absente, fin 10/10/2026              → non comptée
//   i  CDD  début 30/09/2026                       → hors fenêtre
//   j  CDD sans date de début, fin 10/10/2026      → sans date de début, jamais dans les fins
//   k  CDD  début 01/06/2026, fin non renseignée   → fin non datée (en cours à la lecture)
//   l  CDI  début 01/01/2026, sans fin (par nature) → rien
//   m  CDD  début 15/11/2026, fin non renseignée   → entrée en novembre, 02 ; fin non datée (entre dans l'horizon)
//   n  CDD  début 01/02/2027, fin non renseignée   → hors de l'horizon : rien
// Chaque contrat a sa propre personne (pa…pn), sauf k et m, deux CDD successifs de la même personne pk.
// Attendu : octobre 02 (1 fin, 1 entrée) ; novembre 01 (0, 1) ; novembre 02 (0, 1) ; décembre 02 (1, 0), chaque fois une personne ;
// 2 fins, 3 entrées ; 2 sans date de début (2 personnes) ; 2 fins non datées, mais une seule personne (pk).
const CONTRATS: EcheanceContract[] = [
  { person: "pa", startDate: "2026-03-01", endDate: "2026-10-15", nature: "02" },
  { person: "pb", startDate: "2026-11-02", endDate: null, nature: "01" },
  { person: "pc", startDate: "2026-10-01", endDate: "2026-12-29", nature: "02" },
  { person: "pd", startDate: "2026-01-05", endDate: "2026-09-30", nature: "02" },
  { person: "pe", startDate: "2026-02-01", endDate: "2026-12-30", nature: "02" },
  { person: "pf", startDate: "2026-04-01", endDate: "2026-10-20", nature: "29" },
  { person: "pg", startDate: null, endDate: null, nature: "01" },
  { person: "ph", startDate: "2026-05-01", endDate: "2026-10-10", nature: null },
  { person: "pi", startDate: "2026-09-30", endDate: null, nature: "02" },
  { person: "pj", startDate: null, endDate: "2026-10-10", nature: "02" },
  { person: "pk", startDate: "2026-06-01", endDate: null, nature: "02", endUnknown: true },
  { person: "pl", startDate: "2026-01-01", endDate: null, nature: "01", endUnknown: false },
  { person: "pk", startDate: "2026-11-15", endDate: null, nature: "02", endUnknown: true },
  { person: "pn", startDate: "2027-02-01", endDate: null, nature: "02", endUnknown: true },
];
const L = (month: string, nature: string, fins: number, entrees: number, finsPersons: number, entreesPersons: number, finsMembers: string[] = [], entreesMembers: string[] = []) => ({ month, nature, fins, entrees, finsPersons, entreesPersons, finsMembers, entreesMembers });

describe("contractEcheances : cas de référence", () => {
  it("fins de contrat et entrées dans l'horizon, par mois et par nature, depuis la date de lecture ; fins non datées à part", () => {
    expect(contractEcheances({ referenceDate: "2026-09-30", horizonDays: 90, natures: ["01", "02"], contracts: CONTRATS })).toEqual({
      kind: "value",
      from: "2026-10-01",
      to: "2026-12-29",
      horizon: 90,
      months: ["2026-10", "2026-11", "2026-12"],
      lines: [L("2026-10", "02", 1, 1, 1, 1, ["pa"], ["pc"]), L("2026-11", "01", 0, 1, 0, 1, [], ["pb"]), L("2026-11", "02", 0, 1, 0, 1, [], ["pk"]), L("2026-12", "02", 1, 0, 1, 0, ["pc"], [])],
      fins: 2,
      entrees: 3,
      undated: 2,
      undatedPersons: 2,
      endUndated: 2,
      endUndatedPersons: 1,
    });
  });

  it("un contrat sans date de début n'est jamais compté dans les fins, même si sa fin tombe dans l'horizon", () => {
    const e = contractEcheances({ referenceDate: "2026-09-30", horizonDays: 90, natures: ["02"], contracts: [{ person: "pz", startDate: null, endDate: "2026-10-10", nature: "02" }] });
    expect(e).toMatchObject({ kind: "value", lines: [], fins: 0, undated: 1, undatedPersons: 1, endUndated: 0, endUndatedPersons: 0 });
  });

  it("horizon plus court : seules les échéances jusqu'au 15/10/2026 (15 jours) restent ; le CDD qui entre le 15/11 est hors horizon", () => {
    const e = contractEcheances({ referenceDate: "2026-09-30", horizonDays: 15, natures: ["01", "02"], contracts: CONTRATS });
    expect(e.kind === "value" && [e.months, e.lines, e.endUndated, e.endUndatedPersons]).toEqual([["2026-10"], [L("2026-10", "02", 1, 1, 1, 1, ["pa"], ["pc"])], 1, 1]);
  });

  it("aucune échéance : liste vide, totaux à 0 (connus), jamais n.d.", () => {
    const e = contractEcheances({ referenceDate: "2026-09-30", horizonDays: 30, natures: ["01"], contracts: CONTRATS });
    expect(e).toEqual({ kind: "value", from: "2026-10-01", to: "2026-10-30", horizon: 30, months: ["2026-10"], lines: [], fins: 0, entrees: 0, undated: 1, undatedPersons: 1, endUndated: 0, endUndatedPersons: 0 });
  });

  it("personnes distinctes : une personne qui a deux contrats dans le même mois et la même nature reste une personne", () => {
    // Personne x : deux CDD qui finissent les 10/10 et 20/10/2026 ; personne y : un CDD qui finit le 25/10/2026 ; personne z : deux
    // contrats sans date de début ; personne w : deux CDD en cours dont la fin n'est pas renseignée.
    const e = contractEcheances({
      referenceDate: "2026-09-30",
      horizonDays: 90,
      natures: ["02"],
      contracts: [
        { person: "x", startDate: "2026-01-01", endDate: "2026-10-10", nature: "02" },
        { person: "x", startDate: "2026-02-01", endDate: "2026-10-20", nature: "02" },
        { person: "y", startDate: "2026-03-01", endDate: "2026-10-25", nature: "02" },
        { person: "z", startDate: null, endDate: null, nature: "02" },
        { person: "z", startDate: null, endDate: "2026-11-30", nature: "02" },
        { person: "w", startDate: "2026-04-01", endDate: null, nature: "02", endUnknown: true },
        { person: "w", startDate: "2026-05-01", endDate: null, nature: "02", endUnknown: true },
      ],
    });
    expect(e).toMatchObject({ kind: "value", lines: [L("2026-10", "02", 3, 0, 2, 0, ["x", "y"], [])], fins: 3, undated: 2, undatedPersons: 1, endUndated: 2, endUndatedPersons: 1 });
  });

  it("sans date de lecture ou avec un horizon illisible : n.d. avec la raison", () => {
    expect(contractEcheances({ referenceDate: null, horizonDays: 90, natures: ["01"], contracts: CONTRATS })).toEqual({ kind: "nd", reason: "date de lecture de la source RH absente" });
    expect(contractEcheances({ referenceDate: "2026-09-30", horizonDays: 0, natures: ["01"], contracts: CONTRATS }).kind).toBe("nd");
    expect(contractEcheances({ referenceDate: "2026-09-30", horizonDays: 2.5, natures: ["01"], contracts: CONTRATS }).kind).toBe("nd");
  });
});
