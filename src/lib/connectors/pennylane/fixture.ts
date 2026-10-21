import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike } from "../http";
import { monthBounds } from "../months";
import { PENNYLANE_API } from "./client";

// Transport Pennylane fictif, alimenté par ref/fixtures/clair-test-generic-v1.json ; activé comme celui de PayFit
// (CLAIR_ENABLE_FIXTURE_PROVIDERS=true et clé « fixture-pl-… »). Clé : fixture-pl-<A|B|C>-<photographie 1|2>.
const KEY = /^fixture-pl-([ABC])-([12])$/;
export const isPennylaneFixtureKey = (key: string) => KEY.test(key);

type Period = { contractId: string; entityId: string; month: string; grossMinor: number | null; employerChargesMinor: number | null };
type Fixture = { profiles: { id: string; label: string; photographs: { periods: Period[] }[] }[] };
let cache: Fixture | null = null;
const fixture = () => (cache ??= JSON.parse(readFileSync(join(process.cwd(), "ref/fixtures/clair-test-generic-v1.json"), "utf8")) as Fixture);

const ACCOUNTS = [
  { id: 101, number: "411000", label: "Clients" },
  { id: 102, number: "421000", label: "Personnel - rémunérations dues" },
  { id: 103, number: "431000", label: "Sécurité sociale" },
  { id: 104, number: "437000", label: "Autres organismes sociaux" },
  { id: 105, number: "512000", label: "Banque" },
  { id: 106, number: "606100", label: "Fournitures non stockables" },
  { id: 107, number: "641100", label: "Salaires et appointements" },
  { id: 108, number: "645100", label: "Cotisations URSSAF" },
  { id: 109, number: "706000", label: "Prestations de services" },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const euros = (minor: number) => (minor / 100).toFixed(2);
const page = <T,>(items: T[], cursor: string | null, limit: number) => {
  const start = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0;
  const slice = items.slice(start, start + limit);
  const more = start + limit < items.length;
  return json({ items: slice, has_more: more, next_cursor: more ? Buffer.from(String(start + limit)).toString("base64url") : null });
};

export function createPennylaneFixtureFetch(apiKey: string): FetchLike {
  const m = KEY.exec(apiKey);
  if (!m) throw new Error("Clé fictive invalide");
  const [, letter, photo] = m;
  const profile = fixture().profiles.find((p) => p.id === `TEST-PROFILE-${letter}`)!;
  const periods = profile.photographs[Number(photo) - 1].periods;
  const companyId = String({ A: 9001, B: 9002, C: 9003 }[letter]);
  // Écritures de paie par contrat et par mois, au dernier jour du mois.
  let next = 1;
  const lines = periods.flatMap((p) => {
    const date = monthBounds(p.month).end;
    const out: Record<string, unknown>[] = [];
    const add = (acc: number, debit: string, credit: string, label: string) =>
      out.push({ id: next++, date, debit, credit, label, currency: "EUR", ledger_account: { id: acc, number: ACCOUNTS.find((a) => a.id === acc)!.number } });
    if (p.grossMinor !== null) {
      add(107, euros(p.grossMinor), "0.00", `Paie ${p.month}`);
      add(102, "0.00", euros(p.grossMinor), `Paie ${p.month} ${p.contractId}`);
    }
    if (p.employerChargesMinor !== null) {
      add(108, euros(p.employerChargesMinor), "0.00", `Charges ${p.month}`);
      add(103, "0.00", euros(p.employerChargesMinor), `Charges ${p.month}`);
    }
    return out;
  });

  return async (url, init) => {
    const headers = init.headers as Record<string, string> | undefined;
    if (headers?.authorization !== `Bearer ${apiKey}`) return json({}, 401);
    if (headers?.["x-company-id"] && headers["x-company-id"] !== companyId) return json({}, 403);
    if (!url.startsWith(PENNYLANE_API)) return json({}, 404);
    const u = new URL(url);
    const path = u.pathname.replace("/api/external/v2", "");
    const limit = Number(u.searchParams.get("limit") ?? 100);
    const cursor = u.searchParams.get("cursor");
    if (path === "/me") return json({ company: { id: Number(companyId), name: `${profile.label} (comptabilité)` } });
    if (path === "/ledger_accounts") return page(ACCOUNTS, cursor, limit);
    if (path === "/ledger_entry_lines") {
      const filter = JSON.parse(u.searchParams.get("filter") ?? "[]") as { field: string; operator: string; value: unknown }[];
      const gteq = filter.find((f) => f.field === "date" && f.operator === "gteq")?.value as string | undefined;
      const lteq = filter.find((f) => f.field === "date" && f.operator === "lteq")?.value as string | undefined;
      const ids = filter.find((f) => f.field === "ledger_account_id" && f.operator === "in")?.value as string[] | undefined;
      const selected = lines.filter(
        (l) =>
          (!gteq || (l.date as string) >= gteq) &&
          (!lteq || (l.date as string) <= lteq) &&
          (!ids || ids.includes(String((l.ledger_account as { id: number }).id))),
      );
      return page(selected, cursor, limit);
    }
    return json({}, 404);
  };
}
