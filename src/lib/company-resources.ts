import { and, eq, sql } from "drizzle-orm";
import { budgetBase, budgetReference, budgetScenario, reconciliationRun, rhBuild, rhContract, rhPerson, sourceRecord, sourceSync, workspaceSetting } from "@/db/schema";
import { withWorkspace } from "@/db/workspace-scope";
import { FINANCE_SETTINGS_KEY } from "./finance/plans";
import { CASH_PLAN_KEY } from "./restructuring/crisis/cashplan";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Anciennes adresses : retrouver uniquement le périmètre d'une ressource déjà
// autorisée dans cet espace. Aucun montant ni identité ne quitte cette lecture.
export async function resourceCompanyId(workspaceId: string, relative: string): Promise<string | "ambiguous" | null> {
  const url = new URL(relative, "https://clair.invalid");
  if (url.searchParams.has("societe")) return null;
  const scenario = url.searchParams.get("scenario");
  const cashScenario = scenario && uuid.test(scenario) && url.pathname.includes("/studio-restructuring") && url.searchParams.get("vue") === "cash" ? scenario : null;
  const plan = url.pathname.includes("/studio-finance") ? url.searchParams.get("plan") : null;
  const budget = url.searchParams.get("budget");
  const run = url.searchParams.get("run");
  const restructuring = [url.searchParams.get("reference"), url.searchParams.get("projet")].filter((id): id is string => Boolean(id && uuid.test(id)));
  const sync = /\/donnees\/synchro\/([^/]+)$/.exec(url.pathname)?.[1];
  const payslip = /\/masse-salariale\/bulletins\/([^/]+)$/.exec(url.pathname)?.[1];
  const person = /\/collaborateurs\/p\/([^/]+)$/.exec(url.pathname)?.[1];
  const contract = /\/collaborateurs\/c\/([^/]+)$/.exec(url.pathname)?.[1];
  if (![scenario, plan, budget, run, sync, payslip, person, contract, ...restructuring].some(Boolean)) return null;
  return withWorkspace(workspaceId, async (tx) => {
    let rows: { companyId: string }[] = [];
    if (cashScenario) rows = await tx.select({ companyId: workspaceSetting.companyId }).from(workspaceSetting).where(and(eq(workspaceSetting.key, CASH_PLAN_KEY), sql`${workspaceSetting.value}->'scenarios' @> ${JSON.stringify([{ id: cashScenario }])}::jsonb`));
    else if (plan && uuid.test(plan)) rows = await tx.select({ companyId: workspaceSetting.companyId }).from(workspaceSetting).where(and(eq(workspaceSetting.key, FINANCE_SETTINGS_KEY), sql`${workspaceSetting.value}->'plans' @> ${JSON.stringify([{ id: plan }])}::jsonb`));
    else if (scenario && uuid.test(scenario)) rows = await tx.select({ companyId: budgetBase.companyId }).from(budgetScenario).innerJoin(budgetBase, eq(budgetBase.id, budgetScenario.baseId)).where(eq(budgetScenario.id, scenario));
    else if (budget && uuid.test(budget)) rows = await tx.select({ companyId: budgetReference.companyId }).from(budgetReference).where(eq(budgetReference.id, budget));
    else if (run && uuid.test(run)) rows = await tx.select({ companyId: reconciliationRun.companyId }).from(reconciliationRun).where(eq(reconciliationRun.id, run));
    else if (restructuring.length) {
      for (const id of restructuring) rows.push(...await tx.select({ companyId: budgetBase.companyId }).from(budgetScenario).innerJoin(budgetBase, eq(budgetBase.id, budgetScenario.baseId)).where(eq(budgetScenario.id, id)));
    }
    else if (sync && uuid.test(sync)) rows = await tx.select({ companyId: sourceSync.companyId }).from(sourceSync).where(eq(sourceSync.id, sync));
    else if (payslip && uuid.test(payslip)) rows = await tx.select({ companyId: sourceSync.companyId }).from(sourceRecord).innerJoin(sourceSync, eq(sourceSync.id, sourceRecord.syncId)).where(eq(sourceRecord.id, payslip));
    else if (person || contract) {
      let key: string;
      try { key = decodeURIComponent((person ?? contract)!); } catch { return null; }
      if (!/^(payfit|dsn):[A-Za-z0-9_-]{1,128}$/.test(key)) return null;
      rows = person
        ? await tx.select({ companyId: rhBuild.companyId }).from(rhPerson).innerJoin(rhBuild, eq(rhBuild.id, rhPerson.buildId)).where(and(eq(rhPerson.personKey, key), eq(rhBuild.status, "current")))
        : await tx.select({ companyId: rhBuild.companyId }).from(rhContract).innerJoin(rhBuild, eq(rhBuild.id, rhContract.buildId)).where(and(eq(rhContract.contractKey, key), eq(rhBuild.status, "current")));
    }
    const ids = [...new Set(rows.map((row) => row.companyId))];
    return ids.length === 1 ? ids[0] : ids.length > 1 ? "ambiguous" : null;
  }, { allCompanies: true, accessMode: "read only" });
}
