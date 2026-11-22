import type { BankCategoryId } from "./categories";

// Jeu d'évaluation fictif du lot L4 : 500 flux étiquetés à la main par gabarit (libellé, sens, catégorie attendue). Aucun
// nom réel : les tiers sont inventés (« FICTIF »), les personnes sont des noms de test. Les gabarits sans motif reconnaissable
// (fournisseurs et clients nommés) forment le résidu laissé à l'IA ou à la revue.

type Template = { label: string; counterparty?: string; cents: number; expected: BankCategoryId };
export const FIXTURE_PERSONS = ["Camille Testard", "Dominique Exemplier"];

const TEMPLATES: Template[] = [
  { label: "PRLV SEPA URSSAF ILE DE FRANCE ECH {n}", cents: -1_250_000, expected: "social" },
  { label: "PRLV SEPA AGIRC ARRCO COTISATIONS {n}", cents: -380_000, expected: "social" },
  { label: "PRLV MUTUELLE FICTIVE PREVOYANCE {n}", cents: -45_000, expected: "social" },
  { label: "PRLV SEPA DGFIP TVA {n}", cents: -620_000, expected: "tax" },
  { label: "PRLV DGFIP IMPOT SOCIETES ACOMPTE {n}", cents: -150_000, expected: "tax" },
  { label: "VIR SEPA SALAIRE {m} CAMILLE TESTARD", cents: -260_000, expected: "payroll" },
  { label: "VIR PAIE {m} DOMINIQUE EXEMPLIER", cents: -310_000, expected: "payroll" },
  { label: "ECHEANCE PRET {n} BANQUE FICTIVE", cents: -210_000, expected: "loans" },
  { label: "ECH PRET PGE {n}", cents: -95_000, expected: "loans" },
  { label: "FRAIS BANCAIRES {m}", cents: -4_500, expected: "bank_fees" },
  { label: "COMMISSION D INTERVENTION {n}", cents: -800, expected: "bank_fees" },
  { label: "COTISATION CARTE BUSINESS", cents: -6_000, expected: "bank_fees" },
  { label: "PRLV LOYER {m} SCI FICTIVE DES TILLEULS", cents: -380_000, expected: "rent" },
  { label: "PRLV EDF ENTREPRISES {n}", cents: -62_000, expected: "suppliers" },
  { label: "PRLV ORANGE BUSINESS {n}", cents: -12_000, expected: "suppliers" },
  { label: "PRLV AXA ASSURANCE MULTIRISQUE {n}", cents: -41_000, expected: "suppliers" },
  { label: "REMISE CB {n}", cents: 184_000, expected: "customers" },
  { label: "REMISE CHEQUES {n}", cents: 92_000, expected: "customers" },
  { label: "VIR STRIPE PAYOUT {n}", cents: 356_000, expected: "customers" },
  { label: "VIR INTERNE COMPTE A COMPTE {n}", cents: -500_000, expected: "internal" },
  { label: "VIR INTERNE COMPTE A COMPTE {n}", cents: 500_000, expected: "internal" },
  { label: "VIR SUBVENTION REGION FICTIVE {n}", cents: 1_000_000, expected: "other_in" },
  // Résidu : aucun motif du référentiel (tiers nommés).
  { label: "VIR SEPA RECU CLIENT FICTIF ALPHA FACT {n}", counterparty: "CLIENT FICTIF ALPHA", cents: 720_000, expected: "customers" },
  { label: "VIR SEPA RECU BETA DISTRIBUTION FICTIVE {n}", counterparty: "BETA DISTRIBUTION FICTIVE", cents: 410_000, expected: "customers" },
  { label: "VIR SEPA EMIS GROSSISTE FICTIF {n}", counterparty: "GROSSISTE FICTIF", cents: -330_000, expected: "suppliers" },
  { label: "CB ACHAT MATERIEL FICTIF {n}", cents: -1_200_000, expected: "capex" },
  { label: "VIR SEPA EMIS TRANSPORTS FICTIFS {n}", counterparty: "TRANSPORTS FICTIFS", cents: -88_000, expected: "suppliers" },
];

export type FixtureFlow = { key: string; bookingDate: string; amountCents: number; label: string; counterparty: string | null; expected: BankCategoryId };

/** 500 flux sur 6 mois (janvier à juin 2026), répartis en tournant sur les gabarits, avec des montants qui varient. */
export function fixtureFlows(count = 500): FixtureFlow[] {
  const out: FixtureFlow[] = [];
  for (let i = 0; i < count; i++) {
    const t = TEMPLATES[i % TEMPLATES.length];
    const month = (i % 6) + 1;
    const day = (i % 27) + 1;
    const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const label = t.label.replace("{n}", String(100000 + i)).replace("{m}", `${String(month).padStart(2, "0")}/2026`);
    out.push({ key: `fx-${i}`, bookingDate: date, amountCents: t.cents + Math.sign(t.cents) * (i % 7) * 100, label, counterparty: t.counterparty ?? null, expected: t.expected });
  }
  return out;
}
