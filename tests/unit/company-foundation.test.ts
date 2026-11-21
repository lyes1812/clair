import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(), cookies: vi.fn(), transaction: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("@/db/client", () => ({ db: { transaction: mocks.transaction } }));

import { companyCookieName, readCompanyRequest } from "@/lib/company-request";
import { CompanySelectionError, currentCompanyId, selectCompanyId, withCompanyScope, withWorkspace } from "@/db/workspace-scope";
import { CompanyError, parseCompanyInput } from "@/lib/companies";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const FOREIGN = "20000000-0000-4000-8000-000000000001";
const active = [{ id: A, archivedAt: null }, { id: B, archivedAt: null }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.cookies.mockResolvedValue({ get: () => undefined });
});

describe("company selection", () => {
  it("uses a sole active company, including when historical companies are archived", () => {
    expect(selectCompanyId([{ ...active[0], archivedAt: new Date() }, active[1]], null)).toBe(B);
  });
  it("requires a choice when several active companies exist", () => {
    expect(() => selectCompanyId(active, null)).toThrow(CompanySelectionError);
  });
  it.each(["", "*", "not-an-id", FOREIGN])("never falls back from invalid explicit selection %s", (requested) => {
    expect(() => selectCompanyId([active[0]], requested)).toThrow(CompanySelectionError);
  });
  it("rejects archived choices even when another company is active", () => {
    expect(() => selectCompanyId([{ ...active[0], archivedAt: new Date() }, active[1]], A)).toThrow(/archivée/);
  });
  it("requires an active company when none exists", () => {
    expect(() => selectCompanyId([], null)).toThrow(/Aucune société active/);
  });
});

describe("request company context", () => {
  it("prioritises the current URL over a different tab's cookie and referer", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-clair-request-url": `/e/demo?societe=${A}`, "x-clair-company-query": A, "x-clair-request-method": "POST", referer: `https://example.test/e/demo?societe=${B}` }));
    mocks.cookies.mockResolvedValue({ get: () => ({ value: B }) });
    expect(await readCompanyRequest("ws")).toMatchObject({ requestedId: A, source: "query", method: "POST" });
  });
  it.each(["", "*"])("preserves an invalid URL choice instead of consulting a cookie", async (value) => {
    mocks.headers.mockResolvedValue(new Headers({ "x-clair-company-query": value }));
    mocks.cookies.mockResolvedValue({ get: () => ({ value: A }) });
    expect(await readCompanyRequest("ws")).toMatchObject({ requestedId: value, source: "query" });
  });
  it("keeps a same-workspace referer's company across existing navigation links", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-clair-request-url": "/e/demo/studio-rh", referer: `https://example.test/e/demo/donnees?societe=${A}` }));
    mocks.cookies.mockResolvedValue({ get: () => ({ value: B }) });
    expect(await readCompanyRequest("ws")).toMatchObject({ requestedId: A, source: "referer" });
  });
  it("ignores a referer from a different workspace and uses this workspace's cookie", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-clair-request-url": "/e/demo/studio-rh", referer: `https://example.test/e/other?societe=${B}` }));
    const get = vi.fn().mockReturnValue({ value: A });
    mocks.cookies.mockResolvedValue({ get });
    expect(await readCompanyRequest("ws")).toMatchObject({ requestedId: A, source: "cookie" });
    expect(get).toHaveBeenCalledWith(companyCookieName("ws"));
  });
  it("works outside an HTTP request for explicit background jobs", async () => {
    mocks.headers.mockRejectedValue(new Error("no request"));
    mocks.cookies.mockRejectedValue(new Error("no request"));
    expect(await readCompanyRequest("ws")).toEqual({ requestedId: null, url: null, method: null, source: null });
  });
});

describe("transaction company isolation", () => {
  const dialect = new PgDialect();
  const transactions: Array<{ workspace?: string; company?: string }> = [];
  beforeEach(() => {
    transactions.length = 0;
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const context: { workspace?: string; company?: string } = {};
      transactions.push(context);
      const tx = {
        execute: async (statement: SQL) => {
          const query = dialect.sqlToQuery(statement);
          if (query.sql.includes("set_config('app.workspace_id'")) context.workspace = String(query.params[0]);
          if (query.sql.includes("set_config('app.company_id'")) context.company = query.params[0] === undefined ? "*" : String(query.params[0]);
          return { rows: [{ company_id: context.company }] };
        },
        select: () => ({ from: () => ({ where: () => ({ orderBy: async () => context.workspace === "other" ? [{ id: FOREIGN, archivedAt: null }] : active }) }) }),
      };
      return fn(tx);
    });
  });
  it("keeps overlapping asynchronous company scopes independent", async () => {
    let release!: () => void;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const one = withCompanyScope("ws", A, async () => { await pause; return currentCompanyId("ws"); });
    const two = withCompanyScope("ws", B, async () => { release(); await Promise.resolve(); return currentCompanyId("ws"); });
    expect(await Promise.all([one, two])).toEqual([A, B]);
    expect(transactions.map((tx) => tx.company).sort()).toEqual([A, B]);
  });
  it("restores a parent scope after nested failure and never retains it globally", async () => {
    await withCompanyScope("ws", A, async () => {
      await expect(withCompanyScope("ws", B, async () => {
        expect(await currentCompanyId("ws")).toBe(B);
        throw new Error("fixture failure");
      })).rejects.toThrow("fixture failure");
      expect(await currentCompanyId("ws")).toBe(A);
    });
    await expect(currentCompanyId("ws")).rejects.toThrow(CompanySelectionError);
  });
  it("does not propagate a company scope into a different workspace", async () => {
    expect(await withCompanyScope("ws", A, () => currentCompanyId("other"))).toBe(FOREIGN);
  });
  it("lets explicit transaction company override ALS and preserves PostgreSQL options", async () => {
    await withCompanyScope("ws", A, () => withWorkspace("ws", async () => undefined, { companyId: B, accessMode: "read only", isolationLevel: "repeatable read" }));
    expect(transactions[0].company).toBe(B);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ accessMode: "read only", isolationLevel: "repeatable read" });
    expect(mocks.headers).not.toHaveBeenCalled();
  });
  it("provides internal metadata scope without reading request context", async () => {
    await withWorkspace("ws", async () => undefined, { allCompanies: true });
    expect(transactions[0]).toEqual({ workspace: "ws", company: "*" });
    expect(mocks.headers).not.toHaveBeenCalled();
    await expect(withWorkspace("ws", async () => undefined, { allCompanies: true, companyId: A })).rejects.toThrow(CompanySelectionError);
  });
  it("rejects a foreign explicit company before calling business code", async () => {
    const business = vi.fn();
    await expect(withWorkspace("ws", business, { companyId: FOREIGN })).rejects.toThrow(CompanySelectionError);
    expect(business).not.toHaveBeenCalled();
  });
});

describe("company metadata", () => {
  it("normalises names and optional identifiers without inventing identifiers", () => {
    expect(parseCompanyInput({ name: "  Société démo  ", siren: "  " })).toEqual({ name: "Société démo", siren: null });
    expect(parseCompanyInput({ name: "Société démo", siren: "123456789" }).siren).toBe("123456789");
  });
  it.each([{ name: " " }, { name: "a".repeat(121) }, { name: "Demo", siren: "123" }])("rejects invalid metadata", (input) => {
    expect(() => parseCompanyInput(input)).toThrow(CompanyError);
  });
});

describe("trusted request headers", () => {
  it("replaces every client-supplied Clair header from the actual URL and method", async () => {
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    const request = new NextRequest(`https://example.test/e/demo/studio-rh?societe=${A}`, {
      method: "POST", headers: { "x-clair-company-query": B, "x-clair-request-url": "/e/foreign", "x-clair-request-method": "GET", "x-clair-forged-scope": "*" },
    });
    const response = middleware(request);
    expect(response.headers.get("x-middleware-request-x-clair-company-query")).toBe(A);
    expect(response.headers.get("x-middleware-request-x-clair-request-url")).toBe(`/e/demo/studio-rh?societe=${A}`);
    expect(response.headers.get("x-middleware-request-x-clair-request-method")).toBe("POST");
    expect(response.headers.get("x-middleware-request-x-clair-forged-scope")).toBeNull();
  });
  it("does not retain a client company header when no company query was sent", async () => {
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("@/middleware");
    const response = middleware(new NextRequest("https://example.test/e/demo", { headers: { "x-clair-company-query": "*" } }));
    expect(response.headers.get("x-middleware-request-x-clair-company-query")).toBeNull();
  });
});
