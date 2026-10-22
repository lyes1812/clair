import type { FetchLike } from "@/lib/connectors/http";
import { PAYFIT_API, PAYFIT_INTROSPECT } from "@/lib/connectors/payfit/client";

// Cas limites absents des transports fictifs, construits à la main (inventaire de conception, section G).
// Tout est fictif : identifiants TEST, NIR à clé invalide, SIREN 000000000.

// ---------- PayFit : transport minimal paramétrable ----------
type Collab = { id: string; firstName?: string | null; lastName?: string | null; matricule?: string | null; teamName?: string | null };
type Contract = {
  contractId: string; collaboratorId: string | null; startDate: string | null; endDate: string | null;
  status?: "ACTIVE" | "ARCHIVED" | "PENDING" | null; natureContratDsn?: string | null; fullTimeEquivalent?: number | null;
  standardWeeklyHours?: number | null; isFullTime?: boolean | null; workingTimeModality?: string | null; estCadreDirigeant?: boolean | null;
};
export type PayFitEdgeCase = { companyId?: string; scopes?: string; collaborators: Collab[]; contracts: Contract[]; timeByMonth?: Record<string, { contractId: string; payed: number | null; effective: number | null }[]> };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function payfitEdgeFetch(apiKey: string, edge: PayFitEdgeCase): FetchLike {
  const companyId = edge.companyId ?? "test-edge";
  const scopes = edge.scopes ?? "accounting:read collaborators:read contracts:read contracts:time-information:read time:read";
  return async (url, init) => {
    if ((init.headers as Record<string, string>)?.authorization !== `Bearer ${apiKey}`) return json({}, 401);
    if (url === PAYFIT_INTROSPECT) return json({ active: true, scope: scopes, company_id: companyId });
    const u = new URL(url);
    const rest = u.pathname.replace(`/companies/${companyId}`, "").replace(/^\//, "");
    if (!url.startsWith(PAYFIT_API)) return json({}, 404);
    if (rest === "") return json({ id: companyId, name: "Société fictive cas limites", country: "FR", identificationNumber: "000000000", nbActiveContracts: edge.contracts.length });
    if (rest === "collaborators") return json({ collaborators: edge.collaborators.map((c) => ({ firstName: "TEST", lastName: `Fictif ${c.id}`, matricule: null, teamName: null, ...c })), meta: { nextPageToken: null } });
    if (rest === "contracts-fr") {
      return json({
        contracts: edge.contracts.map((c) => ({
          companyId, status: c.endDate && c.endDate < "2026-10-01" ? "ARCHIVED" : "ACTIVE", natureContratDsn: "01", fullTimeEquivalent: 1,
          standardWeeklyHours: 35, isFullTime: true, workingTimeModality: "standard", estCadreDirigeant: false, ...c,
        })),
        meta: { nextPageToken: null },
      });
    }
    const yyyymm = u.searchParams.get("date");
    const month = yyyymm ? `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}` : null;
    if (rest === "contracts/time" && month) {
      const rows = (edge.timeByMonth?.[month] ?? []).map((t) => ({ contractId: t.contractId, payedWorkedTime: t.payed, effectiveWorkedTime: t.effective, workTimeUnit: "hours" }));
      return json({ contracts: rows, meta: { nextPageToken: null } });
    }
    if (rest === "absences") return json({ absences: [], meta: { nextPageToken: null } });
    if (rest === "payroll-status" && month) return json({ status: "completed", executionEndDate: `${month}-28T18:00:00Z` });
    if (rest === "accounting-v2" && month) return json([]);
    return json({}, 404);
  };
}

export const PAYFIT_EDGES: Record<string, PayFitEdgeCase> = {
  // A1 : deux contrats simultanés pour une même personne.
  simultaneous: {
    collaborators: [{ id: "P-SIM" }],
    contracts: [
      { contractId: "C-SIM-1", collaboratorId: "P-SIM", startDate: "2025-01-01", endDate: null, fullTimeEquivalent: 0.5 },
      { contractId: "C-SIM-2", collaboratorId: "P-SIM", startDate: "2025-06-01", endDate: null, fullTimeEquivalent: 0.5 },
    ],
  },
  // A2 : réembauche (même personne, nouveau contrat après une fin) ; A3 : CDD → CDI continu.
  rehire: {
    collaborators: [{ id: "P-REH" }, { id: "P-CONT" }],
    contracts: [
      { contractId: "C-REH-1", collaboratorId: "P-REH", startDate: "2024-01-01", endDate: "2024-12-31", natureContratDsn: "02" },
      { contractId: "C-REH-2", collaboratorId: "P-REH", startDate: "2025-03-01", endDate: null },
      { contractId: "C-CONT-1", collaboratorId: "P-CONT", startDate: "2025-01-01", endDate: "2025-06-30", natureContratDsn: "02" },
      { contractId: "C-CONT-2", collaboratorId: "P-CONT", startDate: "2025-07-01", endDate: null },
    ],
  },
  // B2/B3/B5/B6/B7/B8 : PENDING à début futur, début nul, personne sans contrat, contrat sans personne, CDD à fin future, CDD sans fin.
  incomplete: {
    collaborators: [{ id: "P-PEND" }, { id: "P-NOSTART" }, { id: "P-ALONE" }, { id: "P-CDDFUT" }, { id: "P-CDDNULL" }],
    contracts: [
      { contractId: "C-PEND", collaboratorId: "P-PEND", startDate: "2026-12-01", endDate: null, status: "PENDING" },
      { contractId: "C-NOSTART", collaboratorId: "P-NOSTART", startDate: null, endDate: null },
      { contractId: "C-ORPHAN", collaboratorId: null, startDate: "2025-01-01", endDate: null },
      { contractId: "C-CDDFUT", collaboratorId: "P-CDDFUT", startDate: "2026-01-01", endDate: "2027-03-31", natureContratDsn: "02" },
      { contractId: "C-CDDNULL", collaboratorId: "P-CDDNULL", startDate: "2025-01-01", endDate: null, natureContratDsn: "02" },
    ],
  },
  // C11 : natures hors salariat.
  natures: {
    collaborators: [{ id: "P-STAGE" }, { id: "P-MANDAT" }, { id: "P-CDI" }],
    contracts: [
      { contractId: "C-STAGE", collaboratorId: "P-STAGE", startDate: "2025-01-01", endDate: null, natureContratDsn: "29" },
      { contractId: "C-MANDAT", collaboratorId: "P-MANDAT", startDate: "2025-01-01", endDate: null, natureContratDsn: "80" },
      { contractId: "C-CDI", collaboratorId: "P-CDI", startDate: "2025-01-01", endDate: null, natureContratDsn: "01" },
    ],
  },
};

// ---------- DSN : constructeur de déclarations fictives ----------
export type DsnPerson = {
  nir?: string; ntt?: string; family?: string; given?: string; employeeNumber?: string;
  contracts: {
    number: string; start: string; end?: string; endReason?: string; nature?: string; quota?: string; reference?: string; gross?: string;
    // Activités (S21.G00.53) émises après la rémunération ; type 01 = travail rémunéré, unité 10 = heures.
    activities?: { type?: string; unit?: string; measure: string }[];
  }[];
};
export type DsnDeclarationSpec = { month: string; siren?: string; nic?: string; type?: "01" | "03"; order?: string; fraction?: string; people: DsnPerson[] };

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export function dsnText(spec: DsnDeclarationSpec): string {
  const siren = spec.siren ?? "000000000";
  const lines: string[] = [];
  const r = (code: string, value: string | number) => lines.push(`${code},'${value}'`);
  r("S10.G00.00.001", "TEST-LOGICIEL-FICTIF");
  r("S10.G00.00.006", "P26V01");
  r("S20.G00.05.001", "01");
  r("S20.G00.05.002", spec.type ?? "01");
  r("S20.G00.05.003", spec.fraction ?? "11");
  r("S20.G00.05.004", spec.order ?? "1");
  r("S20.G00.05.005", `01${spec.month.slice(5, 7)}${spec.month.slice(0, 4)}`);
  r("S21.G00.06.001", siren);
  r("S21.G00.11.001", spec.nic ?? "00011");
  const monthEnd = lastDay(spec.month);
  for (const p of spec.people) {
    if (p.nir) r("S21.G00.30.001", p.nir);
    r("S21.G00.30.002", p.family ?? "FICTIF");
    r("S21.G00.30.004", p.given ?? "Test");
    if (p.employeeNumber) r("S21.G00.30.019", p.employeeNumber);
    if (!p.nir && p.ntt) r("S21.G00.30.020", p.ntt);
    for (const c of p.contracts) {
      r("S21.G00.40.001", ddmmyyyy(c.start));
      r("S21.G00.40.007", c.nature ?? "01");
      r("S21.G00.40.009", c.number);
      r("S21.G00.40.011", "10");
      r("S21.G00.40.012", c.reference ?? "151.67");
      r("S21.G00.40.013", c.quota ?? "151.67");
      if (c.end) {
        r("S21.G00.62.001", ddmmyyyy(c.end));
        if (c.endReason) r("S21.G00.62.002", c.endReason);
      }
    }
    const paid = p.contracts.filter((c) => c.gross !== undefined);
    if (paid.length) {
      r("S21.G00.50.001", ddmmyyyy(monthEnd));
      for (const c of paid) {
        r("S21.G00.51.001", ddmmyyyy(`${spec.month}-01`));
        r("S21.G00.51.002", ddmmyyyy(monthEnd));
        r("S21.G00.51.010", c.number);
        r("S21.G00.51.011", "001");
        r("S21.G00.51.013", c.gross!);
        for (const a of c.activities ?? []) {
          r("S21.G00.53.001", a.type ?? "01");
          r("S21.G00.53.002", a.measure);
          r("S21.G00.53.003", a.unit ?? "10");
        }
      }
    }
  }
  r("S90.G00.90.001", lines.length + 2);
  r("S90.G00.90.002", 1);
  return lines.join("\r\n") + "\r\n";
}

export const dsnBytes = (spec: DsnDeclarationSpec) => new TextEncoder().encode(dsnText(spec));

// NIR fictifs (clé de contrôle invalide) et NTT fictif conforme au format ^[12]<SIREN>…
export const NIR = { a: "2990175100010", b: "2990175100020", c: "2990175100030" };
export const NTT = "1000000000TEMP001";

export const DSN_EDGES = {
  // A1 : deux contrats simultanés sous la même personne.
  simultaneous: (month: string): DsnDeclarationSpec => ({
    month, people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", gross: "1000.00" }, { number: "K-2", start: "2025-06-01", gross: "500.00" }] }],
  }),
  // A4 : identifiant temporaire (NTT) un mois, NIR le mois suivant, même contrat.
  nttThenNir: (month: string, withNir: boolean): DsnDeclarationSpec => ({
    month, people: [{ ...(withNir ? { nir: NIR.b } : { ntt: NTT }), employeeNumber: "B", contracts: [{ number: "K-B", start: "2025-01-01", gross: "1500.00" }] }],
  }),
  // C8 : individu sans contrat (rémunération après départ, sans n° de contrat).
  personWithoutContract: (month: string): DsnDeclarationSpec => ({
    month, people: [{ nir: NIR.c, employeeNumber: "C", contracts: [] }],
  }),
  // A7 : libellé corrigé d'un mois à l'autre, même NIR.
  renamed: (month: string, family: string): DsnDeclarationSpec => ({
    month, people: [{ nir: NIR.a, family, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", gross: "1000.00" }] }],
  }),
  // C6 : fin de contrat portée par la déclaration du mois suivant (M+1), contrat encore présent.
  endInNextMonth: (month: string, end: string | undefined): DsnDeclarationSpec => ({
    month, people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", end, endReason: end ? "059" : undefined, gross: "1000.00" }] }],
  }),
  // C10 : renumérotation (même personne, nouveau numéro, même début).
  renumbered: (month: string, number: string): DsnDeclarationSpec => ({
    month, people: [{ nir: NIR.a, employeeNumber: "A", contracts: [{ number, start: "2025-01-01", gross: "1000.00" }] }],
  }),
  // C11 : natures hors salariat.
  natures: (month: string): DsnDeclarationSpec => ({
    month,
    people: [
      { nir: NIR.a, employeeNumber: "A", contracts: [{ number: "K-1", start: "2025-01-01", nature: "01", gross: "1000.00" }] },
      { nir: NIR.b, employeeNumber: "B", contracts: [{ number: "K-B", start: "2025-01-01", nature: "29", gross: "600.00" }] },
      { nir: NIR.c, employeeNumber: "C", contracts: [{ number: "K-C", start: "2025-01-01", nature: "80", gross: "2000.00" }] },
    ],
  }),
};
