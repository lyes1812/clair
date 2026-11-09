export const REPORTING_VUES = [
  { key: "rapport", label: "Rapport de synthèse" },
  { key: "index", label: "Index égalité FH", soon: true },
  { key: "bdese", label: "BDESE", soon: true },
] as const;

export type ReportingVue = (typeof REPORTING_VUES)[number]["key"];
export function resolveReportingVue(value: string): ReportingVue {
  return REPORTING_VUES.some((view) => view.key === value) ? value as ReportingVue : "rapport";
}
