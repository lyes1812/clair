import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEC_FIELDS } from "./parser";

// Générateur de FEC fictifs à partir de ref/fixtures/clair-test-generic-v1.json : écritures de paie mensuelles
// (641100 / 421000, 645100 / 431000) et règlement des salaires (421000 / 512000), un exercice de 12 mois.
// Mêmes montants que les transports PayFit et Pennylane fictifs ; SIREN fictif 000000000.
type Period = { contractId: string; entityId: string; month: string; grossMinor: number | null; employerChargesMinor: number | null };
type Fixture = { profiles: { id: string; photographs: { periods: Period[] }[] }[] };
let cache: Fixture | null = null;
const fixture = () => (cache ??= JSON.parse(readFileSync(join(process.cwd(), "ref/fixtures/clair-test-generic-v1.json"), "utf8")) as Fixture);

export const FIXTURE_FEC_SIREN = "000000000";

const ACCOUNTS: Record<string, string> = {
  "421000": "Personnel - rémunérations dues",
  "431000": "Sécurité sociale",
  "512000": "Banque",
  "641100": "Salaires et appointements",
  "645100": "Cotisations URSSAF",
};

const yyyymmdd = (iso: string) => iso.replace(/-/g, "");
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const euros = (minor: number) => `${minor < 0 ? "-" : ""}${Math.floor(Math.abs(minor) / 100)},${String(Math.abs(minor) % 100).padStart(2, "0")}`;

export type FixtureFecOptions = {
  profile?: "A" | "B" | "C";
  photograph?: 1 | 2;
  // Dernier mois de l'exercice (AAAA-MM) ; l'exercice couvre les 12 mois qui s'y terminent.
  exerciseEnd: string;
  delimiter?: "tab" | "pipe";
  amountFormat?: "debit-credit" | "montant-sens";
  encoding?: "utf-8" | "iso-8859-15";
  bom?: boolean;
};

function exerciseMonths(end: string): string[] {
  const [y, m] = end.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function fixtureFecFilename(o: FixtureFecOptions): string {
  return `${FIXTURE_FEC_SIREN}FEC${yyyymmdd(lastDay(o.exerciseEnd))}.txt`;
}

export function fixtureFecText(o: FixtureFecOptions): string {
  const letter = o.profile ?? "A";
  const profile = fixture().profiles.find((p) => p.id === `TEST-PROFILE-${letter}`)!;
  const periods = profile.photographs[(o.photograph ?? 1) - 1].periods.filter((p) => p.entityId === `TEST-${letter}-ENTITY-1`);
  const sep = o.delimiter === "pipe" ? "|" : "\t";
  const montantSens = o.amountFormat === "montant-sens";
  const headers = FEC_FIELDS.map((f, i) => (montantSens && i === 11 ? "Montant" : montantSens && i === 12 ? "Sens" : f));
  const rows: string[] = [headers.join(sep)];
  let entry = 0;
  const line = (journal: [string, string], date: string, account: string, piece: string, label: string, debitMinor: number, creditMinor: number) => {
    const amount = montantSens ? [euros(debitMinor || creditMinor), debitMinor ? "D" : "C"] : [euros(debitMinor), euros(creditMinor)];
    rows.push([journal[0], journal[1], String(entry), yyyymmdd(date), account, ACCOUNTS[account], "", "", piece, yyyymmdd(date), label, ...amount, "", "", yyyymmdd(date), "", ""].join(sep));
  };
  for (const month of exerciseMonths(o.exerciseEnd)) {
    const date = lastDay(month);
    const inMonth = periods.filter((p) => p.month === month);
    let gross = 0;
    let charges = 0;
    for (const p of inMonth) {
      gross += p.grossMinor ?? 0;
      charges += p.employerChargesMinor ?? 0;
    }
    if (inMonth.some((p) => p.grossMinor !== null)) {
      entry += 1;
      line(["PAI", "Paie"], date, "641100", `OD-PAIE-${month}`, `Salaires ${month}`, gross, 0);
      line(["PAI", "Paie"], date, "421000", `OD-PAIE-${month}`, `Salaires ${month}`, 0, gross);
    }
    if (inMonth.some((p) => p.employerChargesMinor !== null)) {
      entry += 1;
      line(["PAI", "Paie"], date, "645100", `OD-CHG-${month}`, `Cotisations ${month}`, charges, 0);
      line(["PAI", "Paie"], date, "431000", `OD-CHG-${month}`, `Cotisations ${month}`, 0, charges);
    }
    if (gross > 0) {
      entry += 1;
      line(["BQ", "Banque"], date, "421000", `VIR-${month}`, `Virement salaires ${month}`, gross, 0);
      line(["BQ", "Banque"], date, "512000", `VIR-${month}`, `Virement salaires ${month}`, 0, gross);
    }
  }
  return rows.join("\r\n") + "\r\n";
}

export function fixtureFecBytes(o: FixtureFecOptions): Uint8Array {
  const text = (o.bom ? "﻿" : "") + fixtureFecText(o);
  if (o.encoding === "iso-8859-15") return Uint8Array.from([...text].map((ch) => ch.charCodeAt(0) & 0xff));
  return new TextEncoder().encode(text);
}
