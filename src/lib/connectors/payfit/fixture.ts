import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike } from "../http";
import { monthBounds } from "../months";
import { PAYFIT_API, PAYFIT_INTROSPECT } from "./client";

// Transport PayFit fictif : répond au format PayFit à partir de ref/fixtures/clair-test-generic-v1.json.
// Il n'est utilisé que si CLAIR_ENABLE_FIXTURE_PROVIDERS=true ET la clé commence par « fixture- » ;
// aucune requête réseau n'est alors émise. Clé : fixture-<A|B|C>-<photographie 1|2>[-<société 1|2>][-compta].
const KEY = /^fixture-([ABC])-([12])(?:-([12]))?(-compta)?$/;

export function fixtureProvidersEnabled(): boolean {
  return process.env.CLAIR_ENABLE_FIXTURE_PROVIDERS === "true";
}

export function isFixtureKey(key: string): boolean {
  return KEY.test(key);
}

type Fixture = {
  profiles: {
    id: string;
    label: string;
    photographs: {
      people: { id: string; externalId: string; label: string }[];
      contracts: {
        id: string;
        personId: string;
        entityId: string;
        contractType: string;
        startDate: string;
        endDate: string | null;
        quotaBps: number;
        contractMinutesPerWeek: number;
      }[];
      periods: {
        contractId: string;
        entityId: string;
        month: string;
        grossMinor: number | null;
        employerChargesMinor: number | null;
        paidMinutes: number | null;
        workedMinutes: number | null;
      }[];
      absences: { id: string; contractId: string; type: string; startDate: string; endDate: string }[];
    }[];
  }[];
};

let cache: Fixture | null = null;
function fixture(): Fixture {
  cache ??= JSON.parse(readFileSync(join(process.cwd(), "ref/fixtures/clair-test-generic-v1.json"), "utf8")) as Fixture;
  return cache;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const euros = (minor: number) => Math.round(minor) / 100;
const page = <T,>(items: T[], token: string | null, size: number) => {
  const start = token ? Number(Buffer.from(token, "base64url").toString()) : 0;
  const slice = items.slice(start, start + size);
  const next = start + size < items.length ? Buffer.from(String(start + size)).toString("base64url") : null;
  return { slice, next };
};

export function createFixtureFetch(apiKey: string): FetchLike {
  const m = KEY.exec(apiKey);
  if (!m) throw new Error("Clé fictive invalide");
  const [, letter, photo, entityIndex = "1", comptaOnly] = m;
  const profile = fixture().profiles.find((p) => p.id === `TEST-PROFILE-${letter}`)!;
  const ph = profile.photographs[Number(photo) - 1];
  const entityId = `TEST-${letter}-ENTITY-${entityIndex}`;
  const companyId = `test-${letter.toLowerCase()}-${entityIndex}`;
  const scopes = comptaOnly
    ? "accounting:read"
    : "accounting:read collaborators:read contracts:read contracts:time-information:read time:read";
  const contracts = ph.contracts.filter((c) => c.entityId === entityId);
  const personIds = new Set(contracts.map((c) => c.personId));
  const people = ph.people.filter((p) => personIds.has(p.id));
  const contractIds = new Set(contracts.map((c) => c.id));

  return async (url, init) => {
    const auth = (init.headers as Record<string, string> | undefined)?.authorization;
    if (auth !== `Bearer ${apiKey}`) return json({}, 401);
    if (url === PAYFIT_INTROSPECT) return json({ active: true, scope: scopes, company_id: companyId });
    const u = new URL(url);
    if (!url.startsWith(PAYFIT_API)) return json({}, 404);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] !== "companies" || parts[1] !== companyId) return json({}, 404);
    const rest = parts.slice(2).join("/");
    const size = Number(u.searchParams.get("maxResults") ?? 50);
    const token = u.searchParams.get("nextPageToken");
    const yyyymm = u.searchParams.get("date");
    const month = yyyymm ? `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}` : null;
    const needs = (scope: string) => scopes.split(" ").includes(scope);

    if (rest === "") {
      return json({ id: companyId, name: `${profile.label} — société ${entityIndex}`, country: "FR", identificationNumber: "000000000", nbActiveContracts: contracts.length });
    }
    if (rest === "collaborators") {
      if (!needs("collaborators:read")) return json({}, 403);
      const items = people.map((p) => ({
        id: p.externalId,
        firstName: "TEST",
        lastName: p.label.replace(/^TEST personne fictive\s*/, "Fictif "),
        matricule: p.id.split("-").pop(),
        teamName: null,
      }));
      const { slice, next } = page(items, token, size);
      return json({ collaborators: slice, meta: { nextPageToken: next } });
    }
    if (rest === "contracts-fr") {
      if (!needs("contracts:read")) return json({}, 403);
      const items = contracts.map((c) => ({
        contractId: c.id,
        companyId,
        collaboratorId: ph.people.find((p) => p.id === c.personId)?.externalId ?? null,
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.endDate && c.endDate < "2026-10-01" ? "ARCHIVED" : "ACTIVE",
        natureContratDsn: c.contractType === "TEST-FIXED-TERM" ? "02" : "01",
        fullTimeEquivalent: c.quotaBps / 10000,
        standardWeeklyHours: c.contractMinutesPerWeek / 60,
        isFullTime: c.quotaBps === 10000,
        workingTimeModality: "standard",
        estCadreDirigeant: false,
      }));
      const { slice, next } = page(items, token, size);
      return json({ contracts: slice, meta: { nextPageToken: next } });
    }
    if (rest === "contracts/time" && month) {
      if (!needs("time:read")) return json({}, 403);
      const items = ph.periods
        .filter((p) => p.month === month && contractIds.has(p.contractId))
        .map((p) => ({
          contractId: p.contractId,
          effectiveWorkedTime: p.workedMinutes === null ? null : p.workedMinutes / 60,
          payedWorkedTime: p.paidMinutes === null ? null : p.paidMinutes / 60,
          workTimeUnit: "hours",
        }));
      const { slice, next } = page(items, token, size);
      return json({ contracts: slice, meta: { nextPageToken: next } });
    }
    if (rest === "absences") {
      const begin = u.searchParams.get("beginDate") ?? "";
      const end = u.searchParams.get("endDate") ?? "";
      const items = ph.absences
        .filter((a) => contractIds.has(a.contractId) && a.startDate <= end && a.endDate >= begin)
        .map((a) => ({
          id: a.id,
          contractId: a.contractId,
          startDate: { date: a.startDate, moment: "beginning-of-day" },
          endDate: { date: a.endDate, moment: "end-of-day" },
          status: "approved",
          type: a.type.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        }));
      const { slice, next } = page(items, token, size);
      return json({ absences: slice, meta: { nextPageToken: next } });
    }
    if (rest === "payroll-status" && month) {
      return json({ status: "completed", executionEndDate: `${monthBounds(month).end}T18:00:00Z` });
    }
    if (rest === "accounting-v2" && month) {
      // Écritures équilibrées par contrat : brut 641100 / net à payer 421000, charges 645100 / organismes 431000.
      const date = monthBounds(month).end;
      const lines = ph.periods
        .filter((p) => p.month === month && contractIds.has(p.contractId))
        .flatMap((p) => {
          const base = { operationDate: date, analyticCodes: [], employeeFullName: null, contractId: p.contractId };
          const out = [];
          if (p.grossMinor !== null) {
            out.push({ ...base, accountId: "641100", accountName: "Salaires et appointements", debit: euros(p.grossMinor), credit: null });
            out.push({ ...base, accountId: "421000", accountName: "Personnel - rémunérations dues", debit: null, credit: euros(p.grossMinor) });
          }
          if (p.employerChargesMinor !== null) {
            out.push({ ...base, accountId: "645100", accountName: "Cotisations patronales", debit: euros(p.employerChargesMinor), credit: null });
            out.push({ ...base, accountId: "431000", accountName: "Sécurité sociale", debit: null, credit: euros(p.employerChargesMinor) });
          }
          return out;
        });
      return json(lines);
    }
    return json({}, 404);
  };
}
