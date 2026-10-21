import { readFileSync } from "node:fs";
import { join } from "node:path";

// Générateur de DSN fictives (P26V01) à partir de ref/fixtures/clair-test-generic-v1.json : identifiants, NIR et SIREN
// fictifs (clés de contrôle invalides), matricules et numéros de contrat identiques au transport PayFit fictif.
type Fixture = {
  profiles: {
    id: string;
    photographs: {
      people: { id: string; label: string }[];
      contracts: { id: string; personId: string; entityId: string; contractType: string; startDate: string; endDate: string | null; quotaBps: number; contractMinutesPerWeek: number; referenceMinutesPerWeek: number }[];
      periods: { contractId: string; personId: string; month: string; grossMinor: number | null; paidMinutes: number | null }[];
    }[];
  }[];
};
let cache: Fixture | null = null;
const fixture = () => (cache ??= JSON.parse(readFileSync(join(process.cwd(), "ref/fixtures/clair-test-generic-v1.json"), "utf8")) as Fixture);

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const euros = (minor: number) => `${minor < 0 ? "-" : ""}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, "0")}`;

export type FixtureDsnOptions = {
  profile?: "A" | "B" | "C";
  photograph?: 1 | 2;
  month: string;
  type?: "01" | "03";
  order?: string;
  fraction?: string;
  norm?: string;
  encoding?: "utf-8" | "windows-1252";
};

export const FIXTURE_SIREN = "000000000";

export function fixtureDsnText(o: FixtureDsnOptions): string {
  const letter = o.profile ?? "A";
  const profile = fixture().profiles.find((p) => p.id === `TEST-PROFILE-${letter}`)!;
  const ph = profile.photographs[(o.photograph ?? 1) - 1];
  const monthEnd = lastDay(o.month);
  const lines: string[] = [];
  const r = (code: string, value: string | number) => lines.push(`${code},'${value}'`);
  r("S10.G00.00.001", "TEST-LOGICIEL-FICTIF");
  r("S10.G00.00.006", o.norm ?? "P26V01");
  r("S20.G00.05.001", "01");
  r("S20.G00.05.002", o.type ?? "01");
  r("S20.G00.05.003", o.fraction ?? "11");
  r("S20.G00.05.004", o.order ?? "1");
  r("S20.G00.05.005", `01${o.month.slice(5, 7)}${o.month.slice(0, 4)}`);
  r("S21.G00.06.001", FIXTURE_SIREN);
  r("S21.G00.11.001", "00011");
  const contracts = ph.contracts.filter((c) => c.entityId === `TEST-${letter}-ENTITY-1` && c.startDate <= monthEnd && (!c.endDate || c.endDate >= `${o.month}-01`));
  for (const c of contracts) {
    const person = ph.people.find((p) => p.id === c.personId)!;
    const index = person.id.split("-").pop()!;
    r("S21.G00.30.001", `2990175${letter === "A" ? "1" : letter === "B" ? "2" : "3"}00${index}0`.slice(0, 13));
    r("S21.G00.30.002", "FICTIF");
    r("S21.G00.30.004", `${letter}-${index}`);
    r("S21.G00.30.019", index);
    r("S21.G00.40.001", ddmmyyyy(c.startDate));
    r("S21.G00.40.007", c.contractType === "TEST-FIXED-TERM" ? "02" : "01");
    r("S21.G00.40.009", c.id);
    r("S21.G00.40.011", "10");
    const reference = (c.referenceMinutesPerWeek / 60) * 52 / 12;
    r("S21.G00.40.012", reference.toFixed(2));
    r("S21.G00.40.013", (reference * c.quotaBps / 10000).toFixed(2));
    if (c.endDate && c.endDate <= monthEnd) r("S21.G00.62.001", ddmmyyyy(c.endDate));
    const period = ph.periods.find((p) => p.contractId === c.id && p.month === o.month);
    if (period && period.grossMinor !== null) {
      r("S21.G00.50.001", ddmmyyyy(monthEnd));
      r("S21.G00.51.001", ddmmyyyy(`${o.month}-01`));
      r("S21.G00.51.002", ddmmyyyy(monthEnd));
      r("S21.G00.51.010", c.id);
      r("S21.G00.51.011", "001");
      r("S21.G00.51.013", euros(period.grossMinor));
      if (period.paidMinutes !== null) {
        r("S21.G00.53.001", "01");
        r("S21.G00.53.002", (period.paidMinutes / 60).toFixed(2));
        r("S21.G00.53.003", "10");
      }
    }
  }
  r("S90.G00.90.001", lines.length + 2);
  r("S90.G00.90.002", 1);
  return lines.join("\r\n") + "\r\n";
}

export function fixtureDsnBytes(o: FixtureDsnOptions): Uint8Array {
  const text = fixtureDsnText(o);
  if (o.encoding === "windows-1252") return Uint8Array.from([...text].map((ch) => ch.charCodeAt(0) & 0xff));
  return new TextEncoder().encode(text);
}
