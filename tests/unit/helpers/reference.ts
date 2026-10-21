// Cas de référence écrits à la main sur ref/fixtures/clair-test-generic-v1.json, profil TEST-PROFILE-A, photographie 1,
// entité TEST-A-ENTITY-1 (8 personnes, 8 contrats, un contrat par personne). Règle : présent à D ⇔ début ≤ D et (fin nulle ou fin ≥ D).
//
//   001 CDI 2024-10-01 → ouvert        005 CDI 2024-10-01 → ouvert
//   002 CDI 2025-04-01 → ouvert        006 CDI 2024-10-01 → ouvert
//   003 CDD 2024-10-01 → 2025-12-31    007 CDI 2024-10-01 → ouvert
//   004 CDI 2026-02-15 → ouvert        008 CDI 2024-10-01 → ouvert
export const PROFILE_A = {
  contracts: {
    "TEST-A-CONTRACT-001": { person: "TEST-A-PERSON-001", nature: "01", start: "2024-10-01", end: null },
    "TEST-A-CONTRACT-002": { person: "TEST-A-PERSON-002", nature: "01", start: "2025-04-01", end: null },
    "TEST-A-CONTRACT-003": { person: "TEST-A-PERSON-003", nature: "02", start: "2024-10-01", end: "2025-12-31" },
    "TEST-A-CONTRACT-004": { person: "TEST-A-PERSON-004", nature: "01", start: "2026-02-15", end: null },
    "TEST-A-CONTRACT-005": { person: "TEST-A-PERSON-005", nature: "01", start: "2024-10-01", end: null },
    "TEST-A-CONTRACT-006": { person: "TEST-A-PERSON-006", nature: "01", start: "2024-10-01", end: null },
    "TEST-A-CONTRACT-007": { person: "TEST-A-PERSON-007", nature: "01", start: "2024-10-01", end: null },
    "TEST-A-CONTRACT-008": { person: "TEST-A-PERSON-008", nature: "01", start: "2024-10-01", end: null },
  },
  // Effectif personnes = effectif contrats (un contrat par personne) ; ventilation par nature.
  headcount: {
    "2024-10-15": { persons: 6, contracts: 6, byNature: { "01": 5, "02": 1 }, present: ["001", "003", "005", "006", "007", "008"] },
    "2025-04-10": { persons: 7, contracts: 7, byNature: { "01": 6, "02": 1 }, present: ["001", "002", "003", "005", "006", "007", "008"] },
    "2025-12-31": { persons: 7, contracts: 7, byNature: { "01": 6, "02": 1 }, present: ["001", "002", "003", "005", "006", "007", "008"] },
    "2026-01-01": { persons: 6, contracts: 6, byNature: { "01": 6 }, present: ["001", "002", "005", "006", "007", "008"] },
    "2026-03-01": { persons: 7, contracts: 7, byNature: { "01": 7 }, present: ["001", "002", "004", "005", "006", "007", "008"] },
  },
  // Entrées = contrats dont le début est dans le mois ; sorties = contrats dont la fin est dans le mois.
  movements: {
    "2025-04": { entries: ["002"], exits: [], presentAnyDay: 7 },
    "2025-12": { entries: [], exits: ["003"], presentAnyDay: 7 },
    "2026-01": { entries: [], exits: [], presentAnyDay: 6 },
    "2026-02": { entries: ["004"], exits: [], presentAnyDay: 7 },
  },
  // Effectif CDI + CDD (défaut validé) = toutes natures ici, puisque seules 01 et 02 existent dans la fixture.
  headcountNaturesDefault: ["01", "02"],
} as const;

export const short = (id: string) => id.split("-").pop()!;
