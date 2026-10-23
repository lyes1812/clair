import type { CoverageRow } from "@/lib/dsn/selection";
import { Empty, Pill, type Tone } from "../ui";

const STATUS: Record<CoverageRow["status"], { label: string; tone: Tone }> = {
  complete: { label: "Complète", tone: "applied" },
  incomplete: { label: "Incomplète", tone: "preview" },
  blocked: { label: "Bloquée", tone: "failed" },
};
const TYPE: Record<string, string> = { "01": "normale", "03": "annule et remplace" };

export function CoverageTable({ rows }: { rows: CoverageRow[] }) {
  if (rows.length === 0) return <Empty testid="dsn-coverage-empty">n.d. — aucune déclaration appliquée.</Empty>;
  return (
    <div className="table-wrap scroll">
      <table className="data-table sticky" data-testid="dsn-coverage">
        <thead><tr><th scope="col">Mois</th><th scope="col">SIRET</th><th scope="col">État</th><th scope="col">Déclarations retenues</th><th scope="col">Écartées</th><th scope="col">Constats</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.siret}-${r.month}`}>
              <td>{r.month}</td>
              <td><code>{r.siret}</code></td>
              <td><Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill></td>
              <td className="wrap">
                {r.selected.length === 0 ? "—" : r.selected.map((d) => `${TYPE[d.type ?? ""] ?? d.type} · fraction ${d.fraction?.[0]}/${d.fraction?.[1]} · ordre ${d.order}`).join(" ; ")}
              </td>
              <td className="wrap">
                {r.excluded.length === 0 ? "—" : r.excluded.map((e) => `${TYPE[e.declaration.type ?? ""] ?? e.declaration.type} ordre ${e.declaration.order ?? "n.d."} (${e.reason})`).join(" ; ")}
              </td>
              <td className="wrap">{r.messages.length ? r.messages.join(" ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
