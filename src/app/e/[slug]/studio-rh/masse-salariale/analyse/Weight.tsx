import { fmtPercent } from "@/lib/rh/kpi/format";

// Poids d'une contribution dans l'écart total : contribution ÷ écart total, exact (fraction d'entiers), signe écrit.
// Le signe « + » veut dire « dans le sens de l'écart total », « − » « en sens inverse ».
export const weightText = (n: number, total: number) => `${(n < 0) !== (total < 0) ? "−" : "+"}${fmtPercent({ num: Math.abs(n), den: Math.abs(total) })}`;

// Case « Poids des écarts » : « — » pour une contribution nulle ; « n.d. » avec sa raison quand l'écart total est nul (poids non défini)
// ou quand la contribution elle-même est n.d. ; jamais un poids reconstitué.
export function Weight({ n, total, reason }: { n: number | null; total: number; reason?: string | null }) {
  if (n === null) return <abbr className="nd" title={reason ?? "contribution n.d."}>n.d.</abbr>;
  if (n === 0) return <>—</>;
  if (total === 0) return <abbr className="nd" title="écart total nul : le poids d'une contribution (contribution ÷ écart total) n'est pas défini">n.d.</abbr>;
  return <>{weightText(n, total)}</>;
}
