import { isMonth } from "@/lib/connectors/months";

type Search = Record<string, string | string[] | undefined>;
export type PayrollExplorationQuery = {
  filters: { year: string; from: string; to: string; axis: string; referenceYear: string; display: "tout" | "graphique" | "tableau" };
  years: string[];
  referenceYears: string[];
  monthsA: string[];
  monthsB: string[];
  axis: string | null;
  notices: string[];
};
const yearValid = (year: string) => /^\d{4}$/.test(year) && Number(year) > 0;
const monthValid = (month: string) => /^(0[1-9]|1[0-2])$/.test(month);
const uniqueYears = (values: string[]) => [...new Set(values.filter(yearValid))].sort().reverse();
const field = (value: Search[string], fallback: string) => value === undefined ? fallback : typeof value === "string" ? value : value.join(" · ");
const period = (year: string, from: string, to: string): string[] => {
  if (!yearValid(year) || !monthValid(from) || !monthValid(to) || from > to) return [];
  return Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => `${year}-${String(Number(from) + i).padStart(2, "0")}`);
};

// Les choix par défaut dépendent de la lecture appliquée, jamais de l'horloge du serveur.
// Une sélection explicite vide, invalide ou hors source est conservée et n'est pas remplacée.
export function payrollExplorationQuery(search: Search, availableMonths: readonly string[], closedMonths: readonly string[], axes: readonly string[]): PayrollExplorationQuery {
  const available = [...new Set(availableMonths.filter(isMonth))].sort();
  const closed = [...new Set(closedMonths.filter((m) => isMonth(m) && available.includes(m)))].sort();
  const latest = closed.at(-1) ?? available.at(-1) ?? "";
  const year = field(search.annee, latest.slice(0, 4));
  const from = field(search.de, "01");
  const to = field(search.a, latest.slice(5, 7));
  const referenceYear = field(search.reference, yearValid(year) && Number(year) > 1 ? String(Number(year) - 1).padStart(4, "0") : "");
  const axis = field(search.axe, "");
  const display = search.affichage === "tableau" || search.affichage === "graphique" ? search.affichage : "tout";
  const repeatedPeriod = [search.annee, search.de, search.a].some(Array.isArray);
  const monthsA = repeatedPeriod ? [] : period(year, from, to);
  const monthsB = Array.isArray(search.reference) ? [] : period(referenceYear, from, to);
  const notices: string[] = [];
  if (!monthsA.length) notices.push("Période invalide : sélectionne une année et des mois dans l’ordre chronologique.");
  if (!monthsB.length) notices.push("Année de référence invalide : la comparaison est indisponible.");
  if (Array.isArray(search.axe) || (axis && !axes.includes(axis))) notices.push("Axe analytique absent de la lecture ou sélection invalide.");
  const years = uniqueYears([...available.map((m) => m.slice(0, 4)), year]);
  return {
    filters: { year, from, to, axis, referenceYear, display }, years,
    referenceYears: uniqueYears([...years, referenceYear]), monthsA, monthsB,
    axis: !Array.isArray(search.axe) && axes.includes(axis) ? axis : null, notices,
  };
}
