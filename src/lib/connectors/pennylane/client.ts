import { toCents } from "@/lib/money";
import { type FetchLike, ProviderError, requestJson, withRateLimitRetry, defaultSleep } from "../http";
import { isIsoDate, isMonth, monthBounds } from "../months";
import type { CollectionOutcome, ProviderReadResult, SourceRecordInput } from "../types";

// Client Pennylane External API v2, lecture seule. Formats repris du lecteur Codex
// (pennylane.readme.io : getme, getledgeraccounts, getledgerentrylines, rate-limiting-1).
export const PENNYLANE_API = "https://app.pennylane.com/api/external/v2";

const MAX_PAGES = 500;
const ACCOUNT_PAGE = 1000;
const LINE_PAGE = 100;
const IDS_PER_FILTER = 50;
// Périmètre V1 : charges et produits (classes 6 et 7) et dettes sociales 421, 431, 437.
export const LINE_SCOPE = /^(?:[67]|421|431|437)/;
// Libellés conservés pour les classes 6 et 7 ; retirés sur les comptes de personnel (noms possibles).
const PERSONAL_ACCOUNTS = /^(?:421|431|437)/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function fail(where: string): never {
  throw new ProviderError("invalid_response", where);
}
function positiveId(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) fail(where);
  return v;
}
function text(v: unknown, where: string, max = 8192): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(v)) fail(where);
  return v;
}
// Montants Pennylane : chaînes décimales (« 123.45 »), converties exactement en centimes.
function decimal(v: unknown, where: string): number {
  if (typeof v !== "string" || !/^-?\d+(?:\.\d{1,2})?$/.test(v)) fail(where);
  const cents = toCents(v);
  if (cents === null) fail(where);
  return cents;
}

export type PennylaneClientOptions = { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void>; minIntervalMs?: number };

export function createPennylaneClient(apiKey: string, companyId: string | null, opts: PennylaneClientOptions = {}) {
  if (typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 8192 || /[^\x21-\x7e]/.test(apiKey)) {
    throw new ProviderError("key_rejected", "format de clé");
  }
  if (companyId !== null && !/^[1-9]\d{0,29}$/.test(companyId)) throw new ProviderError("key_rejected", "identifiant de société");
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? defaultSleep;
  // 25 GET par 5 secondes et par jeton : un appel toutes les 220 ms au plus.
  const minInterval = opts.minIntervalMs ?? 220;
  let last = 0;

  async function get(path: string, params: Record<string, string> = {}) {
    const url = new URL(`${PENNYLANE_API}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return withRateLimitRetry(
      async () => {
        const wait = last + minInterval - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        return requestJson(fetchImpl, url.toString(), {
          headers: { authorization: `Bearer ${apiKey}`, ...(companyId ? { "x-company-id": companyId } : {}) },
        });
      },
      { sleep },
    );
  }

  async function me(): Promise<{ companyId: string; companyName: string }> {
    const body = await get("/me");
    const company = isObj(body) && isObj(body.company) ? body.company : fail("me.company");
    const id = String(positiveId(company.id, "me.company.id"));
    if (companyId !== null && id !== companyId) fail("me: autre société");
    const name = text(company.name, "me.company.name", 300) ?? `Société ${id}`;
    return { companyId: id, companyName: name };
  }

  async function paginate(path: string, limit: number, params: Record<string, string>) {
    const items: Obj[] = [];
    const seen = new Set<number>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) fail(`${path}: trop de pages`);
      const body = await get(path, { ...params, limit: String(limit), ...(cursor ? { cursor } : {}) });
      if (!isObj(body) || !Array.isArray(body.items) || typeof body.has_more !== "boolean") fail(`${path}: enveloppe`);
      const next = body.next_cursor ?? null;
      if (body.has_more !== (next !== null)) fail(`${path}: pagination incohérente`);
      const rows = body.items as unknown[];
      if (rows.length > limit) fail(`${path}: page trop longue`);
      for (const row of rows) {
        if (!isObj(row)) fail(`${path}: élément`);
        if (row.company_id !== undefined && row.company_id !== null && companyId !== null && String(row.company_id) !== companyId) fail(`${path}: autre société`);
        const id = positiveId(row.id, `${path}.id`);
        if (seen.has(id)) fail(`${path}: identifiant en double`);
        seen.add(id);
        items.push(row);
      }
      if (next === null) break;
      if (typeof next !== "string" || next.length === 0 || next.length > 4096 || /[\u0000-\u001f]/.test(next)) fail(`${path}: curseur`);
      if (cursors.has(next)) fail(`${path}: boucle de pagination`);
      if (rows.length === 0) fail(`${path}: page vide avec suite`);
      cursors.add(next);
      cursor = next;
    }
    return items;
  }

  return { me, paginate };
}

export type PennylaneClient = ReturnType<typeof createPennylaneClient>;

export async function readPennylane(client: PennylaneClient, months: string[]): Promise<ProviderReadResult & { company: { id: string; name: string; identificationNumber: null }; scopes: string[] }> {
  if (!months.every(isMonth)) throw new ProviderError("invalid_response", "périmètre de mois");
  const identity = await client.me();
  const records: SourceRecordInput[] = [
    { collection: "company", key: identity.companyId, period: null, data: { id: identity.companyId, name: identity.companyName } },
  ];
  const collections: CollectionOutcome[] = [];
  const warnings: string[] = [];

  // Plan comptable complet (sans donnée personnelle), puis lignes d'écritures des seuls comptes du périmètre.
  const accounts = (await client.paginate("/ledger_accounts", ACCOUNT_PAGE, { sort: "id" })).map((row) => {
    const id = positiveId(row.id, "ledger_accounts.id");
    const number = text(row.number, "ledger_accounts.number", 128);
    if (!number || !/^\d/.test(number)) fail("ledger_accounts.number");
    return { id, number, label: text(row.label, "ledger_accounts.label") };
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const a of accounts) records.push({ collection: "accounts", key: String(a.id), period: null, data: { ...a } });
  collections.push({ collection: "accounts", status: "read", count: accounts.length });

  const scoped = accounts.filter((a) => LINE_SCOPE.test(a.number)).map((a) => String(a.id));
  // Un seul filtre de dates couvrant toute la période, par bloc de comptes ; chaque ligne est rattachée
  // à son mois d'après sa date (12 fois moins d'appels qu'une lecture mois par mois).
  const wanted = new Set(months);
  const begin = monthBounds([...months].sort()[0]).begin;
  const end = monthBounds([...months].sort()[months.length - 1]).end;
  let lineCount = 0;
  for (let i = 0; i < scoped.length; i += IDS_PER_FILTER) {
    const block = scoped.slice(i, i + IDS_PER_FILTER);
    const filter = JSON.stringify([
      { field: "date", operator: "gteq", value: begin },
      { field: "date", operator: "lteq", value: end },
      { field: "ledger_account_id", operator: "in", value: block },
    ]);
    const rows = await client.paginate("/ledger_entry_lines", LINE_PAGE, { sort: "id", filter });
    for (const row of rows) {
      const id = positiveId(row.id, "ledger_entry_lines.id");
      const date = row.date;
      if (!isIsoDate(date) || date < begin || date > end) fail("ledger_entry_lines.date");
      const month = date.slice(0, 7);
      // Période non contiguë : seuls les mois demandés sont conservés.
      if (!wanted.has(month)) continue;
      const nested = isObj(row.ledger_account) ? row.ledger_account : null;
      const accountRef = nested ? positiveId(nested.id, "ledger_entry_lines.ledger_account.id") : positiveId(row.ledger_account_id, "ledger_entry_lines.ledger_account_id");
      if (nested && row.ledger_account_id !== undefined && row.ledger_account_id !== accountRef) fail("ledger_entry_lines: compte incohérent");
      if (!block.includes(String(accountRef))) fail("ledger_entry_lines: compte hors périmètre");
      const account = byId.get(accountRef)!;
      if (nested && nested.number !== undefined && nested.number !== account.number) fail("ledger_entry_lines.ledger_account.number");
      if (row.currency !== undefined && row.currency !== null && row.currency !== "EUR") fail("ledger_entry_lines.currency");
      records.push({
        collection: "ledger_lines",
        key: String(id),
        period: month,
        data: {
          id,
          month,
          operationDate: date,
          accountId: account.number,
          accountName: account.label,
          ledgerAccountId: account.id,
          debitCents: decimal(row.debit, "ledger_entry_lines.debit"),
          creditCents: decimal(row.credit, "ledger_entry_lines.credit"),
          currency: "EUR",
          label: PERSONAL_ACCOUNTS.test(account.number) ? null : text(row.label, "ledger_entry_lines.label", 1000),
        },
      });
      lineCount += 1;
    }
  }
  collections.push({ collection: "ledger_lines", status: "read", count: lineCount });
  if (scoped.length === 0) warnings.push("Aucun compte des classes 6 et 7 ni 421, 431, 437 dans le plan comptable.");
  return { records, collections, warnings, company: { id: identity.companyId, name: identity.companyName, identificationNumber: null }, scopes: [] };
}
