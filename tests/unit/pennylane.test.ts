import { describe, expect, it } from "vitest";
import type { FetchLike } from "@/lib/connectors/http";
import { createPennylaneClient, PENNYLANE_API, readPennylane } from "@/lib/connectors/pennylane/client";
import { createPennylaneFixtureFetch } from "@/lib/connectors/pennylane/fixture";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const client = (f: FetchLike, companyId: string | null = null) => createPennylaneClient("jeton-fictif-123456", companyId, { fetchImpl: f, minIntervalMs: 0 });

describe("lecture Pennylane sur le transport fictif (profil A, photographie 1)", async () => {
  const key = "fixture-pl-A-1";
  const r = await readPennylane(createPennylaneClient(key, null, { fetchImpl: createPennylaneFixtureFetch(key), minIntervalMs: 0 }), ["2024-10", "2024-11"]);
  const lines = r.records.filter((x) => x.collection === "ledger_lines");

  it("lit la société, le plan comptable complet et les lignes du périmètre", () => {
    expect(r.company).toMatchObject({ id: "9001" });
    expect(r.records.filter((x) => x.collection === "accounts")).toHaveLength(9);
    expect(new Set(lines.map((l) => l.data.accountId))).toEqual(new Set(["641100", "421000", "645100", "431000"]));
  });

  it("cas de référence : octobre 2024, 641100 = somme des bruts fictifs du mois (6 contrats, 13 840,00 €)", () => {
    const total = lines.filter((l) => l.period === "2024-10" && l.data.accountId === "641100").reduce((s, l) => s + (l.data.debitCents as number), 0);
    expect(total).toBe(1384000);
  });

  it("retire les libellés des comptes de personnel (421, 431, 437), garde ceux des classes 6 et 7", () => {
    expect(lines.filter((l) => String(l.data.accountId).startsWith("421")).every((l) => l.data.label === null)).toBe(true);
    expect(lines.find((l) => l.data.accountId === "641100")?.data.label).toBe("Paie 2024-10");
  });

  it("chaque ligne est datée dans son mois", () => {
    expect(lines.every((l) => String(l.data.operationDate).startsWith(String(l.period)))).toBe(true);
  });
});

describe("contrôles Pennylane", () => {
  const me = json({ company: { id: 42, name: "Société" } });
  it("refuse une autre société que celle configurée", async () => {
    await expect(client(async () => json({ company: { id: 7, name: "X" } }), "42").me()).rejects.toMatchObject({ code: "invalid_response" });
    await expect(client(async () => me, "42").me()).resolves.toEqual({ companyId: "42", companyName: "Société" });
  });
  it("envoie le jeton et l'identifiant de société, n'appelle que l'API Pennylane", async () => {
    const f: FetchLike = async (url, init) => {
      expect(url.startsWith(PENNYLANE_API)).toBe(true);
      expect((init.headers as Record<string, string>)["x-company-id"]).toBe("42");
      expect(init.redirect).toBe("manual");
      return json({ company: { id: 42 } });
    };
    await client(f, "42").me();
  });
  it("parcourt les curseurs ; refuse une pagination incohérente ou une boucle", async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, number: "606100", label: "x" }));
    const paged: FetchLike = async (url) => {
      const c = Number(new URL(url).searchParams.get("cursor") ?? 0);
      const more = c + 100 < items.length;
      return json({ items: items.slice(c, c + 100), has_more: more, next_cursor: more ? String(c + 100) : null });
    };
    expect(await client(paged).paginate("/ledger_accounts", 100, {})).toHaveLength(250);
    await expect(client(async () => json({ items: [{ id: 1 }], has_more: true, next_cursor: null })).paginate("/x", 100, {})).rejects.toThrow(/incohérente/);
    let n = 0;
    await expect(client(async () => json({ items: [{ id: ++n }], has_more: true, next_cursor: "même" })).paginate("/x", 100, {})).rejects.toThrow(/boucle/);
  });

  function readWith(line: Record<string, unknown>) {
    const f: FetchLike = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/me")) return json({ company: { id: 42, name: "S" } });
      if (path.endsWith("/ledger_accounts")) return json({ items: [{ id: 5, number: "641100", label: "Salaires" }, { id: 6, number: "512000", label: "Banque" }], has_more: false, next_cursor: null });
      return json({ items: [{ id: 1, date: "2026-09-30", debit: "1234.50", credit: "0.00", ledger_account: { id: 5, number: "641100" }, ...line }], has_more: false, next_cursor: null });
    };
    return readPennylane(client(f), ["2026-09"]);
  }
  it("convertit les montants décimaux en centimes exacts", async () => {
    const r = await readWith({});
    expect(r.records.find((x) => x.collection === "ledger_lines")?.data).toMatchObject({ debitCents: 123450, creditCents: 0, accountId: "641100" });
  });
  it.each([
    [{ debit: 12.5 }, "montant numérique au lieu de chaîne"],
    [{ debit: "1.234" }, "plus de deux décimales"],
    [{ currency: "USD" }, "autre devise"],
    [{ date: "2026-08-31" }, "date hors de la période"],
    [{ ledger_account: { id: 6, number: "512000" } }, "compte hors périmètre"],
    [{ ledger_account: { id: 5, number: "641200" } }, "numéro de compte incohérent"],
  ])("refuse %o (%s)", async (line, _why) => {
    await expect(readWith(line)).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("lecture Pennylane sur plusieurs mois", () => {
  it("un appel par bloc de comptes pour toute la période, lignes rattachées à leur mois", async () => {
    const key = "fixture-pl-A-1";
    const inner = createPennylaneFixtureFetch(key);
    let lineCalls = 0;
    const f: FetchLike = (u, i) => (u.includes("/ledger_entry_lines") && lineCalls++, inner(u, i));
    const r = await readPennylane(createPennylaneClient(key, null, { fetchImpl: f, minIntervalMs: 0 }), ["2024-10", "2024-11", "2024-12"]);
    const lines = r.records.filter((x) => x.collection === "ledger_lines");
    expect(lineCalls).toBe(1);
    expect(new Set(lines.map((l) => l.period))).toEqual(new Set(["2024-10", "2024-11", "2024-12"]));
    expect(lines.every((l) => String(l.data.operationDate).startsWith(String(l.period)))).toBe(true);
  });
  it("ignore les mois non demandés d'une période non contiguë", async () => {
    const key = "fixture-pl-A-1";
    const r = await readPennylane(createPennylaneClient(key, null, { fetchImpl: createPennylaneFixtureFetch(key), minIntervalMs: 0 }), ["2024-10", "2024-12"]);
    expect(new Set(r.records.filter((x) => x.collection === "ledger_lines").map((l) => l.period))).toEqual(new Set(["2024-10", "2024-12"]));
  });
});
