import { randomUUID } from "node:crypto";
import { toCents } from "@/lib/money";
import { defaultFinanceRow } from "./actuals";
import { FinanceError, parseFinanceSettings } from "./plans";
import { FINANCE_ROWS, type FinanceMapping, type FinancePlan, type FinanceSettings } from "./types";

const value = (f: FormData, key: string) => {
  const values = f.getAll(key);
  if (values.length > 1 || (values.length && typeof values[0] !== "string")) throw new FinanceError("Saisie invalide ou répétée.");
  return String(values[0] ?? "").trim();
};
export function formRevision(form: FormData): number {
  const s = value(form, "revision");
  const n = Number(s);
  if (!/^\d{1,9}$/.test(s) || !Number.isSafeInteger(n)) throw new FinanceError("Version de la saisie invalide : rechargez la page.");
  return n;
}
export function formName(form: FormData): string {
  const name = value(form, "name");
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new FinanceError("Nom requis, de 120 caractères maximum.");
  return name;
}
export function planFromForm(form: FormData, settings: FinanceSettings): FinancePlan {
  if ([...form.keys()].length > 70) throw new FinanceError("Saisie trop volumineuse.");
  const id = value(form, "id");
  const existing = settings.plans.find((p) => p.id === id);
  if (id !== "new" && !existing) throw new FinanceError("Version introuvable dans cet espace.");
  if (id === "new" && settings.plans.length >= 12) throw new FinanceError("Cet espace contient déjà 12 plans : modifiez une version existante.");
  const year = Number(value(form, "year"));
  const kind = value(form, "kind") as FinancePlan["kind"];
  const cells: FinancePlan["cells"] = {};
  for (const [key, raw] of form) {
    if (!key.startsWith("cell:")) continue;
    const match = /^cell:(\d{4}-\d{2}):([a-z-]+)$/.exec(key);
    if (!match || !FINANCE_ROWS.some((r) => r.id === match[2]) || typeof raw !== "string") throw new FinanceError("Cellule de saisie inconnue.");
    const text = value(form, key);
    if (!text) continue;
    const cents = toCents(text);
    if (cents === null) throw new FinanceError("Montant en euros invalide : deux décimales maximum, ou laissez la case vide.");
    cells[match[1]] ??= {};
    cells[match[1]][match[2] as typeof FINANCE_ROWS[number]["id"]] = cents;
  }
  const plan: FinancePlan = {
    id: id === "new" ? randomUUID() : id, name: formName(form), kind, year, currency: "EUR", cells,
    firstForecastMonth: kind === "budget" ? null : value(form, "firstForecastMonth") || null,
    personnelSource: value(form, "personnelSource") as FinancePlan["personnelSource"],
    rhScenarioId: value(form, "personnelSource") === "rh" ? value(form, "rhScenarioId") || null : null, updatedAt: new Date().toISOString(),
  };
  const next = { ...settings, plans: [...settings.plans.filter((p) => p.id !== plan.id), plan] };
  if (!parseFinanceSettings(next)) throw new FinanceError("Version invalide : vérifiez l’année, les mois, le scénario RH et les montants (10 milliards d’euros maximum par case).");
  return plan;
}
export function mappingsFromForm(form: FormData, settings: FinanceSettings): FinanceMapping[] {
  const accounts = form.getAll("account"), rows = form.getAll("row");
  if (accounts.length !== rows.length || accounts.length > 256) throw new FinanceError("256 comptes maximum par enregistrement.");
  const seen = new Set<string>();
  const submitted = accounts.map((a, i) => {
    if (typeof a !== "string" || typeof rows[i] !== "string" || seen.has(a)) throw new FinanceError("Liste de comptes invalide ou répétée.");
    seen.add(a);
    return { account: a, row: rows[i] as FinanceMapping["row"] };
  });
  const mappings = [...settings.mappings.filter((m) => !seen.has(m.account)), ...submitted.filter((m) => defaultFinanceRow(m.account) !== m.row)];
  if (!parseFinanceSettings({ ...settings, mappings })) throw new FinanceError("Correspondance invalide : comptes 6/7 et lignes du modèle uniquement (256 exceptions maximum).");
  return mappings;
}
export function formId(form: FormData) { return value(form, "id"); }
