import { describe, expect, it, vi } from "vitest";
import { ProviderError, type FetchLike } from "@/lib/connectors/http";
import { createPayFitClient, normalizeLedger, PAYFIT_API, PAYFIT_INTROSPECT, readPayFit } from "@/lib/connectors/payfit/client";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const noSleep = vi.fn(async () => {});
const client = (fetchImpl: FetchLike, key = "cle-fictive-123456") => createPayFitClient(key, { fetchImpl, sleep: noSleep, minIntervalMs: 0 });

describe("lecture PayFit complète sur le transport fictif (profil A, photographie 1)", async () => {
  const key = "fixture-A-1";
  const result = await readPayFit(createPayFitClient(key, { fetchImpl: createFixtureFetch(key), minIntervalMs: 0 }), ["2024-10", "2024-11"]);
  const of = (c: string) => result.records.filter((r) => r.collection === c);

  it("lit chaque collection, avec la société et ses droits", () => {
    expect(result.company.id).toBe("test-a-1");
    expect(result.scopes).toContain("time:read");
    expect(result.collections.every((c) => c.status === "read")).toBe(true);
    expect(of("collaborators")).toHaveLength(8);
    expect(of("contracts")).toHaveLength(8);
    expect(of("payroll_status")).toHaveLength(2);
  });

  it("cas de référence : contrat 001, octobre 2024 — brut 3 000,00 € et charges 1 200,00 € en centimes exacts", () => {
    const lines = of("ledger_lines").filter((r) => r.data.contractId === "TEST-A-CONTRACT-001" && r.period === "2024-10");
    expect(lines.find((l) => l.data.accountId === "641100")?.data.debitCents).toBe(300000);
    expect(lines.find((l) => l.data.accountId === "645100")?.data.debitCents).toBe(120000);
    expect(lines.find((l) => l.data.accountId === "421000")?.data.debitCents).toBeNull();
    expect(lines.find((l) => l.data.accountId === "421000")?.data.creditCents).toBe(300000);
  });

  it("cas de référence : temps payé 9 600 min = 160 h, travaillé 9 000 min = 150 h, sans calcul d'ETP", () => {
    const t = of("worked_time").find((r) => r.key === "TEST-A-CONTRACT-001@2024-10");
    expect(t?.data).toMatchObject({ paidWorkedTime: 160, effectiveWorkedTime: 150, unit: "hours" });
  });

  it("ne conserve pas le nom du salarié dans le journal (le contrat suffit)", () => {
    expect(of("ledger_lines").every((l) => !("employeeFullName" in l.data))).toBe(true);
  });

  it("une clé limitée à la comptabilité signale les collections RH comme indisponibles, avec la raison", async () => {
    const k = "fixture-A-1-compta";
    const r = await readPayFit(createPayFitClient(k, { fetchImpl: createFixtureFetch(k), minIntervalMs: 0 }), ["2024-10"]);
    expect(r.collections.find((c) => c.collection === "collaborators")).toMatchObject({ status: "unavailable", reason: expect.stringContaining("collaborators:read") });
    expect(r.collections.find((c) => c.collection === "ledger_lines")).toMatchObject({ status: "read" });
    expect(r.records.some((x) => x.collection === "collaborators")).toBe(false);
  });
});

describe("pagination", () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, firstName: null, lastName: null }));
  const paged: FetchLike = async (url) => {
    const u = new URL(url);
    const start = Number(u.searchParams.get("nextPageToken") ?? 0);
    const next = start + 50 < items.length ? String(start + 50) : null;
    return json({ collaborators: items.slice(start, start + 50), meta: { nextPageToken: next } });
  };

  it("parcourt toutes les pages jusqu'au jeton nul", async () => {
    expect(await client(paged).paginate("co", "collaborators", "collaborators", (r) => String(r.id))).toHaveLength(120);
  });
  it("refuse une boucle de jetons", async () => {
    const loop: FetchLike = async () => json({ collaborators: [{ id: `x${Math.random()}` }], meta: { nextPageToken: "same" } });
    await expect(client(loop).paginate("co", "collaborators", "collaborators", (r) => String(r.id))).rejects.toThrow(/boucle/);
  });
  it("refuse un identifiant en double entre pages", async () => {
    let n = 0;
    const dup: FetchLike = async () => json({ collaborators: [{ id: "a" }], meta: { nextPageToken: n++ === 0 ? "t1" : null } });
    await expect(client(dup).paginate("co", "collaborators", "collaborators", (r) => String(r.id))).rejects.toThrow(/double/);
  });
  it("refuse une page vide annonçant une suite (jamais une liste vide « réussie »)", async () => {
    const empty: FetchLike = async () => json({ collaborators: [], meta: { nextPageToken: "t" } });
    await expect(client(empty).paginate("co", "collaborators", "collaborators", (r) => String(r.id))).rejects.toThrow(/vide/);
  });
  it("refuse un élément d'une autre société", async () => {
    const other: FetchLike = async () => json({ contracts: [{ contractId: "k", companyId: "autre" }], meta: { nextPageToken: null } });
    await expect(client(other).paginate("co", "contracts-fr", "contracts", (r) => String(r.contractId))).rejects.toThrow(/autre société/);
  });
});

describe("erreurs et limitation", () => {
  it("relance après 429 en respectant Retry-After, puis réussit", async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const f: FetchLike = async () => (n++ < 2 ? json({}, 429, { "retry-after": "2" }) : json({ id: "co", name: "Société" }));
    const c = createPayFitClient("cle-fictive-123456", { fetchImpl: f, sleep, minIntervalMs: 0 });
    await expect(c.company("co")).resolves.toMatchObject({ id: "co" });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("abandonne si le délai demandé dépasse une minute", async () => {
    const f: FetchLike = async () => json({}, 429, { "retry-after": "120" });
    await expect(client(f).company("co")).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 120 });
  });
  it.each([
    [401, "key_rejected"],
    [403, "scope_denied"],
    [404, "not_found"],
    [500, "unavailable"],
    [302, "unavailable"],
  ])("HTTP %s → %s", async (status, code) => {
    const f: FetchLike = async () => new Response(null, { status, headers: status === 302 ? { location: "https://ailleurs.example" } : {} });
    await expect(client(f).company("co")).rejects.toMatchObject({ code });
  });
  it("refuse une réponse qui n'est pas du JSON", async () => {
    const f: FetchLike = async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(client(f).company("co")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("refuse une société différente de celle de la clé", async () => {
    const f: FetchLike = async () => json({ id: "autre", name: "X" });
    await expect(client(f).company("co")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("introspection : clé inactive refusée ; seuls les droits en lecture sont retenus", async () => {
    await expect(client(async () => json({ active: false })).introspect()).rejects.toMatchObject({ code: "key_rejected" });
    const f: FetchLike = async (url, init) => {
      expect(url).toBe(PAYFIT_INTROSPECT);
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("manual");
      return json({ active: true, scope: "accounting:read collaborators:write time:read accounting:read", company_id: "co" });
    };
    await expect(client(f).introspect()).resolves.toEqual({ companyId: "co", scopes: ["accounting:read", "time:read"] });
  });
  it("le message d'erreur ne contient jamais la clé", async () => {
    const key = "cle-secrete-ne-pas-afficher";
    const f: FetchLike = async () => json({}, 401);
    const err = await createPayFitClient(key, { fetchImpl: f, minIntervalMs: 0 }).company("co").catch((e: ProviderError) => e);
    expect(String((err as ProviderError).message)).not.toContain(key);
  });
  it("n'appelle que les hôtes PayFit attendus", async () => {
    const urls: string[] = [];
    const key = "fixture-B-1";
    const inner = createFixtureFetch(key);
    await readPayFit(createPayFitClient(key, { fetchImpl: (u, i) => (urls.push(u), inner(u, i)), minIntervalMs: 0 }), ["2025-01"]);
    expect(urls.every((u) => u === PAYFIT_INTROSPECT || u.startsWith(`${PAYFIT_API}/companies/test-b-1`))).toBe(true);
  });
});

describe("journal comptable : montants", () => {
  const line = (debit: unknown, credit: unknown) => ({ operationDate: "2026-09-30", accountId: "641100", accountName: "x", analyticCodes: [], debit, credit, contractId: null });
  it("convertit les euros en centimes exacts ; un montant absent reste inconnu", () => {
    const { records } = normalizeLedger([line(1234.56, null), line(0.1, 0), line(null, null)], "2026-09");
    expect(records.map((r) => [r.data.debitCents, r.data.creditCents])).toEqual([[123456, null], [10, 0], [null, null]]);
  });
  it("refuse plus de deux décimales et les montants en chaîne", () => {
    expect(() => normalizeLedger([line(1.234, null)], "2026-09")).toThrow();
    expect(() => normalizeLedger([line("12.30", null)], "2026-09")).toThrow();
  });
  it("compte les lignes datées hors du mois demandé", () => {
    expect(normalizeLedger([{ ...line(1, null), operationDate: "2026-08-31" }], "2026-09").offPeriod).toBe(1);
  });
});

describe("temps par contrat", async () => {
  const { normalizeWorkedTime } = await import("@/lib/connectors/payfit/client");
  it("conserve un temps payé négatif (régularisation) sans le corriger", () => {
    expect(normalizeWorkedTime({ contractId: "k1", payedWorkedTime: -7.5, effectiveWorkedTime: 0, workTimeUnit: "hours" }, "2026-01").data).toMatchObject({
      paidWorkedTime: -7.5,
      effectiveWorkedTime: 0,
    });
  });
  it("refuse toujours un temps en texte ou une unité inconnue", () => {
    expect(() => normalizeWorkedTime({ contractId: "k1", payedWorkedTime: "7.5" }, "2026-01")).toThrow();
    expect(() => normalizeWorkedTime({ contractId: "k1", payedWorkedTime: 1, workTimeUnit: "minutes" }, "2026-01")).toThrow();
  });
  it("signale les temps négatifs dans les avertissements de la lecture", async () => {
    const base = createFixtureFetch("fixture-A-1");
    const f: FetchLike = async (url, init) => {
      if (url.includes("/contracts/time")) return json({ contracts: [{ contractId: "TEST-A-CONTRACT-001", payedWorkedTime: -3, effectiveWorkedTime: 0, workTimeUnit: "hours" }], meta: { nextPageToken: null } });
      return base(url, init);
    };
    const r = await readPayFit(createPayFitClient("fixture-A-1", { fetchImpl: f, minIntervalMs: 0 }), ["2025-01"]);
    expect(r.warnings.some((w) => w.includes("2025-01") && w.includes("négatif"))).toBe(true);
  });
});

describe("mois daté absent chez PayFit (404)", () => {
  it("signale le mois indisponible et conserve les autres : jamais une lecture en échec ni un mois à zéro", async () => {
    const base = createFixtureFetch("fixture-A-1");
    const f: FetchLike = async (url, init) => {
      if (url.includes("/accounting-v2?date=202610") || url.includes("/contracts/time?") && url.includes("date=202610")) return json({ message: "not found" }, 404);
      return base(url, init);
    };
    const r = await readPayFit(createPayFitClient("fixture-A-1", { fetchImpl: f, minIntervalMs: 0 }), ["2026-09", "2026-10"]);
    expect(r.collections.find((c) => c.collection === "ledger_lines")?.status).toBe("read");
    expect(r.records.some((x) => x.collection === "ledger_lines" && x.period === "2026-09")).toBe(true);
    expect(r.records.some((x) => x.collection === "ledger_lines" && x.period === "2026-10")).toBe(false);
    expect(r.records.some((x) => x.collection === "worked_time" && x.period === "2026-10")).toBe(false);
    expect(r.warnings.filter((w) => w.includes("2026-10") && w.includes("indisponible chez PayFit"))).toHaveLength(2);
    // Un 404 sur une collection non datée reste une erreur.
    const g: FetchLike = async (url, init) => (url.includes("/collaborators") ? json({}, 404) : base(url, init));
    await expect(readPayFit(createPayFitClient("fixture-A-1", { fetchImpl: g, minIntervalMs: 0 }), ["2026-09"])).rejects.toThrow();
  });
});
