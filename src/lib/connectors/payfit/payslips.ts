import { ProviderError } from "../http";
import { isMonth } from "../months";
import type { PayFitClient } from "./client";

export type PayFitPayslip = { month: string; contractId: string; payslipId: string };
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const invalid = (): never => { throw new ProviderError("invalid_response", "références de bulletin"); };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** API non paginée documentée. Une liste incomplète ou ambiguë n’est jamais une liste vide. */
export async function listPayFitPayslips(client: PayFitClient, companyId: string, collaboratorId: string): Promise<PayFitPayslip[]> {
  if (!safeId(companyId) || !safeId(collaboratorId)) return invalid();
  const body = await client.get(`/companies/${companyId}/collaborators/${collaboratorId}/payslips`);
  if (!object(body) || !Array.isArray(body.payslips) || body.payslips.length > 500) return invalid();
  const seen = new Set<string>();
  return body.payslips.map((item): PayFitPayslip => {
    if (!object(item) || typeof item.year !== "string" || !/^2\d{3}$/.test(item.year) || typeof item.month !== "string"
      || !/^\d{2}$/.test(item.month) || !isMonth(`${item.year}-${item.month}`) || !safeId(item.contractId) || !safeId(item.payslipId)
      || typeof item.payslipUrl !== "string" || !item.payslipUrl || item.payslipUrl.length > 4096 || /[\u0000-\u001f]/.test(item.payslipUrl)) return invalid();
    // Le même document ne peut pas désigner deux périodes/contrats. Les URL reçues ne sont jamais suivies.
    if (seen.has(item.payslipId)) return invalid();
    seen.add(item.payslipId);
    return { month: `${item.year}-${item.month}`, contractId: item.contractId, payslipId: item.payslipId };
  });
}

export async function fetchPayFitPayslip(client: PayFitClient, companyId: string, collaboratorId: string, contractId: string, payslipId: string): Promise<Uint8Array> {
  if (![companyId, collaboratorId, contractId, payslipId].every(safeId)) return invalid();
  return client.pdf(`/companies/${companyId}/collaborators/${collaboratorId}/contracts/${contractId}/payslips/${payslipId}`);
}
