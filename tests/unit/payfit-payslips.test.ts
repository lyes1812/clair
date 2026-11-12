import { describe, expect, it, vi } from "vitest";
import { ProviderError, requestPdf, type FetchLike } from "@/lib/connectors/http";
import { createPayFitClient } from "@/lib/connectors/payfit/client";
import { fetchPayFitPayslip, listPayFitPayslips } from "@/lib/connectors/payfit/payslips";
import { createFixtureFetch } from "@/lib/connectors/payfit/fixture";
import { extractRcPayslip } from "@/lib/payroll/rc-payslip-parser";

const meta = (patch: Record<string, unknown> = {}) => ({ year: "2026", month: "02", contractId: "CONTRACT-FICTIF", payslipId: "BULLETIN-FICTIF", payslipUrl: "https://fictif.invalid/not-followed", ...patch });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pdf = () => new Response("%PDF-1.7\nFICTIF", { headers: { "content-type": "application/pdf" } });
const client = (fetchImpl: FetchLike) => createPayFitClient("cle-fictive-pdf-123456", { fetchImpl, minIntervalMs: 0, sleep: async () => {} });

describe("bulletins PayFit : transport fictif en lecture seule", () => {
  it("normalise la période exacte et ne conserve ni ne suit l’URL du bulletin", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({ payslips: [meta()] }));
    expect(await listPayFitPayslips(client(fetchImpl), "COMPANY-FICTIVE", "PERSON-FICTIVE")).toEqual([{ month: "2026-02", contractId: "CONTRACT-FICTIF", payslipId: "BULLETIN-FICTIF" }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe("https://partner-api.payfit.com/companies/COMPANY-FICTIVE/collaborators/PERSON-FICTIVE/payslips");
  });
  it.each([{ month: "2" }, { month: "13" }, { year: 2026 }, { payslipId: "../secret" }, { contractId: "" }, { payslipUrl: null }])("refuse une référence mal formée : %j", async (patch) => {
    await expect(listPayFitPayslips(client(async () => json({ payslips: [meta(patch)] })), "co", "person")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("refuse les réponses tronquées, les documents en double et le dépassement de liste", async () => {
    for (const body of [{}, { payslips: null }, { payslips: [meta(), meta()] }, { payslips: Array.from({ length: 501 }, (_, i) => meta({ payslipId: `fake-${i}` })) }]) {
      await expect(listPayFitPayslips(client(async () => json(body)), "co", "person")).rejects.toBeInstanceOf(ProviderError);
    }
  });
  it("construit le chemin PDF à partir des identifiants validés, sans redirection ni cache", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => pdf());
    const bytes = await fetchPayFitPayslip(client(fetchImpl), "co", "person", "contract", "payslip");
    expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.7\nFICTIF");
    expect(fetchImpl).toHaveBeenCalledWith("https://partner-api.payfit.com/companies/co/collaborators/person/contracts/contract/payslips/payslip", expect.objectContaining({ method: "GET", redirect: "manual", cache: "no-store", headers: { accept: "application/pdf", authorization: "Bearer cle-fictive-pdf-123456" } }));
    await expect(client(fetchImpl).pdf("https://evil.invalid")).rejects.toMatchObject({ code: "invalid_response" });
    await expect(fetchPayFitPayslip(client(fetchImpl), "co", "person", "contract", "../../evil")).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([[401, "key_rejected"], [403, "scope_denied"], [404, "not_found"], [302, "unavailable"], [500, "unavailable"]])("statut %s : erreur sans corps ni donnée client", async (status, code) => {
    const error = await requestPdf(async () => new Response("DONNEE_FICTIVE_PRIVEE", { status: Number(status), headers: { location: "https://evil.invalid", "content-type": "application/pdf" } }), "https://api.invalid").catch(e => e);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("DONNEE_FICTIVE_PRIVEE");
  });
  it("relance une limitation 429 avec le même transport sécurisé", async () => {
    let n = 0;
    const fetchImpl = vi.fn<FetchLike>(async () => n++ ? pdf() : new Response("", { status: 429, headers: { "retry-after": "1" } }));
    await fetchPayFitPayslip(client(fetchImpl), "co", "person", "contract", "doc");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("refuse JSON, faux PDF et taille excessive déclarée ou reçue en flux", async () => {
    for (const response of [json({ error: "fictif" }), new Response("Faux PDF", { headers: { "content-type": "application/pdf" } }), new Response("%PDF-x", { headers: { "content-type": "application/pdf", "content-length": "999999" } }), new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("%PDF-1234567890")); controller.close(); } }), { headers: { "content-type": "application/pdf" } })]) {
      await expect(requestPdf(async () => response, "https://api.invalid", { maxBytes: 10 })).rejects.toBeInstanceOf(ProviderError);
    }
  });
});

describe("bulletins PayFit : fournisseur de recette fictif complet", () => {
  const fictitious = (key = "fixture-A-1") => createPayFitClient(key, { fetchImpl: createFixtureFetch(key), minIntervalMs: 0, sleep: async () => {} });
  it("déclare le droit bulletins seulement sur la clé complète", async () => {
    expect((await fictitious().introspect()).scopes).toContain("contracts:payslips:read");
    expect((await fictitious("fixture-A-1-compta").introspect()).scopes).toEqual(["accounting:read"]);
  });
  it("lit deux indemnités de RC fictives sur2025 et2026, sans altérer les montants de paie", async () => {
    const client = fictitious();
    for (const sample of [{ person: "TEST-A-PERSON-001", month: "2025-12", amount: 123456 }, { person: "TEST-A-PERSON-002", month: "2026-02", amount: 234567 }]) {
      const docs = await listPayFitPayslips(client, "test-a-1", sample.person);
      const doc = docs.find(doc => doc.month === sample.month)!;
      expect(doc).toBeDefined();
      const bytes = await fetchPayFitPayslip(client, "test-a-1", sample.person, doc.contractId, doc.payslipId);
      expect(await extractRcPayslip(bytes)).toMatchObject({ status: "identified", indemnityCents: sample.amount });
    }
    const docs = await listPayFitPayslips(client, "test-a-1", "TEST-A-PERSON-001");
    const other = docs.find(doc => doc.month === "2026-01")!;
    expect(await extractRcPayslip(await fetchPayFitPayslip(client, "test-a-1", "TEST-A-PERSON-001", other.contractId, other.payslipId))).toMatchObject({ status: "none", indemnityCents: null });
  });
  it("refuse une clé comptable, une autre société, un autre collaborateur et un autre contrat", async () => {
    await expect(listPayFitPayslips(fictitious("fixture-A-1-compta"), "test-a-1", "TEST-A-PERSON-001")).rejects.toMatchObject({ code: "scope_denied" });
    await expect(listPayFitPayslips(fictitious(), "test-b-1", "TEST-A-PERSON-001")).rejects.toMatchObject({ code: "not_found" });
    await expect(listPayFitPayslips(fictitious(), "test-a-1", "PERSON-UNKNOWN")).rejects.toMatchObject({ code: "not_found" });
    const [doc] = await listPayFitPayslips(fictitious(), "test-a-1", "TEST-A-PERSON-001");
    await expect(fetchPayFitPayslip(fictitious(), "test-a-1", "TEST-A-PERSON-002", doc.contractId, doc.payslipId)).rejects.toMatchObject({ code: "not_found" });
  });
});
