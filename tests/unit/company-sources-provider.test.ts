import { describe, expect, it, vi } from "vitest";
import { readPayFit, type PayFitClient } from "@/lib/connectors/payfit/client";
import { createPennylaneClient, readPennylane } from "@/lib/connectors/pennylane/client";
import { sourceSiren } from "@/lib/connectors/company-identity";

describe("identité de société avant la lecture des données", () => {
  it("compare un SIREN ou SIRET explicite sans interpréter un nom ou un numéro de TVA", () => {
    expect(sourceSiren("123 456 789")).toBe("123456789");
    expect(sourceSiren("123 456 789 00012")).toBe("123456789");
    expect(sourceSiren("123.456.789-00012")).toBe("123456789");
    expect(sourceSiren("FR 12 123456789")).toBeNull();
    expect(sourceSiren("Société 123456789")).toBeNull();
    expect(sourceSiren(null)).toBeNull();
  });
  it("PayFit refuse une identité différente avant de lire la société ou ses collections", async () => {
    const company = vi.fn();
    const paginate = vi.fn();
    const client = { introspect: vi.fn().mockResolvedValue({ companyId: "fictive-b", scopes: [] }), company, paginate } as unknown as PayFitClient;
    await expect(readPayFit(client, ["2025-01"], "fictive-a")).rejects.toThrow(/autre société/);
    expect(company).not.toHaveBeenCalled();
    expect(paginate).not.toHaveBeenCalled();
  });

  it("Pennylane refuse une identité différente avant toute lecture comptable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ company: { id: 9002, name: "Société fictive B" } }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createPennylaneClient("fictive-api-key", "9001", { fetchImpl, minIntervalMs: 0 });
    await expect(readPennylane(client, ["2025-01"])).rejects.toThrow(/autre société/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/me$/);
  });
});
