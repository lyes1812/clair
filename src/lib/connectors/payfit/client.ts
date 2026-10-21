import { toCents } from "@/lib/money";
import { type FetchLike, ProviderError, requestJson, withRateLimitRetry, defaultSleep } from "../http";
import { isIsoDate, isMonth, monthBounds } from "../months";
import type { CollectionOutcome, ProviderReadResult, SourceRecordInput } from "../types";

// Client PayFit Partner API, lecture seule. Formats repris des lecteurs Codex vérifiés sur un compte réel
// (developers.payfit.io : authentication-via-api-key, get_collaborators, get_contracts_fr,
// get_contracts_worked_time, get_absences, get_companypayrollstatus, get_companyaccountingv2).
export const PAYFIT_API = "https://partner-api.payfit.com";
export const PAYFIT_INTROSPECT = "https://oauth.payfit.com/introspect";

const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const MAX_LEDGER_LINES = 50_000;

export const PAYFIT_SCOPES = {
  collaborators: "collaborators:read",
  contracts: "contracts:read",
  contractTime: "contracts:time-information:read",
  time: "time:read",
  accounting: "accounting:read",
} as const;

const WORKING_TIME_MODALITIES = new Set([
  "standard",
  "forfait_heures",
  "forfait_jours",
  "forfait_annuel_en_heures",
  "forfait_sans_reference_horaire",
]);
const CONTRACT_STATUSES = new Set(["ACTIVE", "ARCHIVED", "PENDING"]);
const ABSENCE_STATUSES = new Set(["approved", "pending_approval", "declined", "cancelled", "pending_cancellation"]);
const ABSENCE_MOMENTS = new Set(["beginning-of-day", "middle-of-day", "end-of-day"]);

export type PayFitIdentity = { companyId: string; scopes: string[] };
export type PayFitCompany = { id: string; name: string; country: string | null; identificationNumber: string | null };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function fail(where: string): never {
  throw new ProviderError("invalid_response", where);
}
function str(v: unknown, where: string, { max = 300, nullable = true } = {}): string | null {
  if (v === null || v === undefined) {
    if (nullable) return null;
    fail(where);
  }
  if (typeof v !== "string" || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) fail(where);
  return v;
}
function id(v: unknown, where: string): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) fail(where);
  return v;
}
function num(v: unknown, where: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(where);
  return v;
}
// Temps signé : PayFit renvoie des temps payés négatifs (régularisations) ; conservés tels quels.
function signedNum(v: unknown, where: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(where);
  return v;
}
function bool(v: unknown, where: string): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "boolean") fail(where);
  return v;
}
function date(v: unknown, where: string): string | null {
  if (v === null || v === undefined) return null;
  if (!isIsoDate(v)) fail(where);
  return v;
}
function oneOf(v: unknown, allowed: Set<string>, where: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !allowed.has(v)) fail(where);
  return v;
}

export type PayFitClientOptions = {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  apiBase?: string;
  introspectUrl?: string;
};

export function createPayFitClient(apiKey: string, opts: PayFitClientOptions = {}) {
  if (typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 8192 || /[^\x21-\x7e]/.test(apiKey)) {
    throw new ProviderError("key_rejected", "format de clé");
  }
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? defaultSleep;
  const apiBase = opts.apiBase ?? PAYFIT_API;
  const minInterval = opts.minIntervalMs ?? 150;
  const auth = { authorization: `Bearer ${apiKey}` };
  let last = 0;
  let calls = 0;

  async function call(url: string, init: { method?: "GET" | "POST"; body?: string; headers?: Record<string, string> } = {}) {
    return withRateLimitRetry(
      async () => {
        const wait = last + minInterval - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        calls += 1;
        return requestJson(fetchImpl, url, { ...init, headers: { ...auth, ...init.headers } });
      },
      { sleep },
    );
  }

  async function introspect(): Promise<PayFitIdentity> {
    const body = await call(opts.introspectUrl ?? PAYFIT_INTROSPECT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: apiKey }),
    });
    if (!isObj(body) || body.active !== true) throw new ProviderError("key_rejected", "clé inactive");
    const scope = typeof body.scope === "string" && body.scope.length <= 4096 ? body.scope : fail("introspection.scope");
    const scopes = [...new Set(scope.split(/\s+/).filter((s) => /^[a-z0-9-]+(?::[a-z0-9-]+)*:read$/.test(s)))].sort();
    return { companyId: id(body.company_id, "introspection.company_id"), scopes };
  }

  async function company(companyId: string): Promise<PayFitCompany> {
    const body = await call(`${apiBase}/companies/${encodeURIComponent(companyId)}`);
    if (!isObj(body) || body.id !== companyId) fail("company.id");
    return {
      id: companyId,
      name: str(body.name, "company.name", { nullable: false }) as string,
      country: str(body.country, "company.country", { max: 8 }),
      identificationNumber: str(body.identificationNumber, "company.identificationNumber", { max: 80 }),
    };
  }

  // Parcourt toutes les pages ; une page manquante ou une boucle de jetons est une erreur, jamais une liste vide.
  async function paginate(companyId: string, path: string, listKey: string, idOf: (item: Obj) => string, params: Record<string, string> = {}) {
    const items: Obj[] = [];
    const seenIds = new Set<string>();
    const seenTokens = new Set<string>();
    let token: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) fail(`${path}: trop de pages`);
      const url = new URL(`${apiBase}/companies/${encodeURIComponent(companyId)}/${path}`);
      url.searchParams.set("maxResults", String(PAGE_SIZE));
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (token) url.searchParams.set("nextPageToken", token);
      const body = await call(url.toString());
      if (!isObj(body) || !Array.isArray(body[listKey])) fail(`${path}.${listKey}`);
      const rows = body[listKey] as unknown[];
      if (rows.length > PAGE_SIZE) fail(`${path}: page trop longue`);
      for (const row of rows) {
        if (!isObj(row)) fail(`${path}: élément`);
        if (row.companyId !== undefined && row.companyId !== companyId) fail(`${path}: autre société`);
        const key = idOf(row);
        if (seenIds.has(key)) fail(`${path}: identifiant en double`);
        seenIds.add(key);
        items.push(row);
      }
      const meta = isObj(body.meta) ? body.meta : null;
      const next = meta?.nextPageToken;
      if (next === null || next === "" || next === undefined) break;
      if (typeof next !== "string" || next.length > 4096 || /[\u0000-\u001f]/.test(next)) fail(`${path}: jeton de page`);
      if (seenTokens.has(next)) fail(`${path}: boucle de pagination`);
      if (rows.length === 0) fail(`${path}: page vide avec suite`);
      seenTokens.add(next);
      token = next;
    }
    return items;
  }

  // GET d'un chemin de l'API, construit côté serveur (jamais depuis une donnée reçue).
  const get = (path: string) => call(`${apiBase}${path}`);

  return { introspect, company, paginate, get, callCount: () => calls };
}

export type PayFitClient = ReturnType<typeof createPayFitClient>;

// --- Normalisation : seuls les champs utiles sont conservés (minimisation), avec leur type vérifié.

export function normalizeCollaborator(row: Obj): SourceRecordInput {
  const key = id(row.id, "collaborator.id");
  return {
    collection: "collaborators",
    key,
    period: null,
    data: {
      id: key,
      firstName: str(row.firstName, "collaborator.firstName"),
      lastName: str(row.lastName, "collaborator.lastName"),
      employeeNumber: str(row.matricule, "collaborator.matricule", { max: 128 }),
      teamName: str(row.teamName, "collaborator.teamName"),
    },
  };
}

export function normalizeContract(row: Obj, withTimeInformation: boolean): SourceRecordInput {
  const key = id(row.contractId, "contract.contractId");
  const startDate = date(row.startDate, "contract.startDate");
  const endDate = date(row.endDate, "contract.endDate");
  if (startDate && endDate && startDate > endDate) fail("contract: fin avant début");
  const nature = row.natureContratDsn;
  if (nature !== null && nature !== undefined && (typeof nature !== "string" || !/^\d{2}$/.test(nature))) fail("contract.natureContratDsn");
  return {
    collection: "contracts",
    key,
    period: null,
    data: {
      contractId: key,
      collaboratorId: row.collaboratorId === null || row.collaboratorId === undefined ? null : id(row.collaboratorId, "contract.collaboratorId"),
      startDate,
      endDate,
      status: oneOf(row.status, CONTRACT_STATUSES, "contract.status"),
      natureContratDsn: (nature as string | null | undefined) ?? null,
      fullTimeEquivalent: withTimeInformation ? num(row.fullTimeEquivalent, "contract.fullTimeEquivalent") : null,
      standardWeeklyHours: withTimeInformation ? num(row.standardWeeklyHours, "contract.standardWeeklyHours") : null,
      isFullTime: withTimeInformation ? bool(row.isFullTime, "contract.isFullTime") : null,
      workingTimeModality: withTimeInformation ? oneOf(row.workingTimeModality, WORKING_TIME_MODALITIES, "contract.workingTimeModality") : null,
      executive: bool(row.estCadreDirigeant, "contract.estCadreDirigeant"),
      timeInformation: withTimeInformation ? "read" : "scope-missing",
    },
  };
}

export function normalizeWorkedTime(row: Obj, month: string): SourceRecordInput {
  const contractId = id(row.contractId, "time.contractId");
  const unit = row.workTimeUnit;
  if (unit !== null && unit !== undefined && unit !== "hours" && unit !== "days") fail("time.workTimeUnit");
  return {
    collection: "worked_time",
    key: `${contractId}@${month}`,
    period: month,
    data: {
      contractId,
      month,
      effectiveWorkedTime: signedNum(row.effectiveWorkedTime, "time.effectiveWorkedTime"),
      paidWorkedTime: signedNum(row.payedWorkedTime, "time.payedWorkedTime"),
      unit: (unit as string | null | undefined) ?? null,
    },
  };
}

function absenceBound(v: unknown, where: string) {
  if (!isObj(v)) fail(where);
  return { date: date(v.date, `${where}.date`), moment: oneOf(v.moment, ABSENCE_MOMENTS, `${where}.moment`) };
}

export function normalizeAbsence(row: Obj): SourceRecordInput {
  const key = id(row.id, "absence.id");
  const start = absenceBound(row.startDate, "absence.startDate");
  const end = absenceBound(row.endDate, "absence.endDate");
  if (start.date && end.date && start.date > end.date) fail("absence: fin avant début");
  const type = row.type;
  if (typeof type !== "string" || type.length > 128 || /\s/.test(type)) fail("absence.type");
  return {
    collection: "absences",
    key,
    period: null,
    data: {
      id: key,
      contractId: id(row.contractId, "absence.contractId"),
      start,
      end,
      status: oneOf(row.status, ABSENCE_STATUSES, "absence.status"),
      type,
    },
  };
}

export function normalizePayrollStatus(body: unknown, month: string): SourceRecordInput {
  if (!isObj(body)) fail("payroll-status");
  const status = body.status;
  if (status !== "completed" && status !== "not_completed") fail("payroll-status.status");
  const end = body.executionEndDate;
  if (end !== null && end !== undefined && (typeof end !== "string" || end.length > 64 || Number.isNaN(Date.parse(end)))) fail("payroll-status.executionEndDate");
  return { collection: "payroll_status", key: month, period: month, data: { month, status, executionEndDate: end ?? null } };
}

function amount(v: unknown, where: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number") fail(where);
  const cents = toCents(v);
  if (cents === null) fail(where);
  return cents;
}

// Journal comptable v2 : montants en euros (nombre JSON) convertis exactement en centimes ;
// une ligne sans montant reste « inconnue », jamais zéro. Le nom du salarié n'est pas conservé (le contrat suffit).
export function normalizeLedger(body: unknown, month: string): { records: SourceRecordInput[]; offPeriod: number } {
  if (!Array.isArray(body)) fail("accounting-v2");
  if (body.length > MAX_LEDGER_LINES) fail("accounting-v2: trop de lignes");
  let offPeriod = 0;
  const records = body.map((row, index): SourceRecordInput => {
    if (!isObj(row)) fail("accounting-v2: ligne");
    const operationDate = date(row.operationDate, "accounting-v2.operationDate");
    if (operationDate && operationDate.slice(0, 7) !== month) offPeriod += 1;
    const accountId = str(row.accountId, "accounting-v2.accountId", { max: 80, nullable: false }) as string;
    if (!accountId.trim()) fail("accounting-v2.accountId");
    if (!Array.isArray(row.analyticCodes)) fail("accounting-v2.analyticCodes");
    const analyticCodes = (row.analyticCodes as unknown[]).slice(0, 100).map((c) => {
      if (!isObj(c)) fail("accounting-v2.analyticCodes");
      return { type: str(c.type, "analytic.type", { max: 200 }), code: str(c.code, "analytic.code", { max: 200 }), value: str(c.value, "analytic.value") };
    });
    return {
      collection: "ledger_lines",
      key: `${month}#${String(index).padStart(5, "0")}`,
      period: month,
      data: {
        month,
        line: index,
        operationDate,
        accountId,
        accountName: str(row.accountName, "accounting-v2.accountName"),
        debitCents: amount(row.debit, "accounting-v2.debit"),
        creditCents: amount(row.credit, "accounting-v2.credit"),
        currency: "EUR",
        contractId: row.contractId === null || row.contractId === undefined ? null : str(row.contractId, "accounting-v2.contractId", { max: 128 }),
        analyticCodes,
      },
    };
  });
  return { records, offPeriod };
}

// Lecture complète d'un périmètre : chaque collection est lue en entier ou signalée indisponible avec sa raison.
export async function readPayFit(client: PayFitClient, months: string[]): Promise<ProviderReadResult & { company: PayFitCompany; scopes: string[] }> {
  if (!months.every(isMonth)) throw new ProviderError("invalid_response", "périmètre de mois");
  const identity = await client.introspect();
  const company = await client.company(identity.companyId);
  const has = (s: string) => identity.scopes.includes(s);
  const records: SourceRecordInput[] = [
    { collection: "company", key: company.id, period: null, data: { ...company, scopes: identity.scopes } },
  ];
  const collections: CollectionOutcome[] = [];
  const warnings: string[] = [];
  const cid = identity.companyId;

  async function collection(name: string, scope: string | null, read: () => Promise<SourceRecordInput[]>) {
    if (scope && !has(scope)) {
      collections.push({ collection: name, status: "unavailable", reason: `droit ${scope} non accordé à la clé` });
      return;
    }
    try {
      const rows = await read();
      records.push(...rows);
      collections.push({ collection: name, status: "read", count: rows.length });
    } catch (e) {
      if (e instanceof ProviderError && e.code === "scope_denied") {
        collections.push({ collection: name, status: "unavailable", reason: "accès refusé par le fournisseur pour cette clé" });
        return;
      }
      throw e;
    }
  }

  await collection("collaborators", PAYFIT_SCOPES.collaborators, async () =>
    (await client.paginate(cid, "collaborators", "collaborators", (r) => id(r.id, "collaborator.id"))).map(normalizeCollaborator),
  );
  const withTime = has(PAYFIT_SCOPES.contractTime);
  await collection("contracts", PAYFIT_SCOPES.contracts, async () =>
    (await client.paginate(cid, "contracts-fr", "contracts", (r) => id(r.contractId, "contract.contractId"), { includeInProgressContracts: "true" })).map((r) =>
      normalizeContract(r, withTime),
    ),
  );
  if (has(PAYFIT_SCOPES.contracts) && !withTime) warnings.push("Quotités et horaires contractuels non lus : droit contracts:time-information:read non accordé.");
  await collection("worked_time", PAYFIT_SCOPES.time, async () => {
    const out: SourceRecordInput[] = [];
    for (const month of months) {
      const rows = await client.paginate(cid, "contracts/time", "contracts", (r) => id(r.contractId, "time.contractId"), { date: month.replace("-", "") });
      out.push(...rows.map((r) => normalizeWorkedTime(r, month)));
    }
    return out;
  });
  // Absences : une absence qui chevauche plusieurs mois n'est conservée qu'une fois.
  await collection("absences", null, async () => {
    const byId = new Map<string, SourceRecordInput>();
    for (const month of months) {
      const { begin, end } = monthBounds(month);
      const rows = await client.paginate(cid, "absences", "absences", (r) => id(r.id, "absence.id"), { status: "all", beginDate: begin, endDate: end });
      for (const r of rows) {
        const rec = normalizeAbsence(r);
        byId.set(rec.key, rec);
      }
    }
    return [...byId.values()];
  });
  await collection("payroll_status", PAYFIT_SCOPES.accounting, async () => {
    const out: SourceRecordInput[] = [];
    for (const month of months) out.push(normalizePayrollStatus(await client.get(`/companies/${cid}/payroll-status?date=${month.replace("-", "")}`), month));
    return out;
  });
  await collection("ledger_lines", PAYFIT_SCOPES.accounting, async () => {
    const out: SourceRecordInput[] = [];
    for (const month of months) {
      const { records: lines, offPeriod } = normalizeLedger(await client.get(`/companies/${cid}/accounting-v2?date=${month.replace("-", "")}`), month);
      if (offPeriod > 0) warnings.push(`Journal ${month} : ${offPeriod} ligne(s) datée(s) hors du mois demandé.`);
      out.push(...lines);
    }
    return out;
  });
  const negativeTimes = new Map<string, number>();
  for (const r of records) {
    if (r.collection === "worked_time" && ((r.data.paidWorkedTime as number) < 0 || (r.data.effectiveWorkedTime as number) < 0)) {
      negativeTimes.set(r.period!, (negativeTimes.get(r.period!) ?? 0) + 1);
    }
  }
  for (const [month, n] of [...negativeTimes].sort()) {
    warnings.push(`Temps ${month} : ${n} contrat(s) avec un temps négatif (régularisation probable), conservé(s) tel(s) quel(s).`);
  }
  for (const r of records) {
    if (r.collection === "payroll_status" && r.data.status === "not_completed") warnings.push(`Paie ${r.period} non clôturée : journal provisoire.`);
  }
  return { records, collections, warnings, company, scopes: identity.scopes };
}

