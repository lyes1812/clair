import type { CoverageRow } from "@/lib/dsn/selection";

const STATUS: Record<CoverageRow["status"], { label: string; cls: string }> = {
  complete: { label: "Complète", cls: "applied" },
  incomplete: { label: "Incomplète", cls: "preview" },
  blocked: { label: "Bloquée", cls: "failed" },
};
const TYPE: Record<string, string> = { "01": "normale", "03": "annule et remplace" };

export function CoverageTable({ rows }: { rows: CoverageRow[] }) {
  if (rows.length === 0) return <p className="muted" data-testid="dsn-coverage-empty">n.d. — aucune déclaration appliquée.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table" data-testid="dsn-coverage">
        <thead><tr><th>Mois</th><th>SIRET</th><th>État</th><th>Déclarations retenues</th><th>Écartées</th><th>Constats</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.siret}-${r.month}`}>
              <td>{r.month}</td>
              <td><code>{r.siret}</code></td>
              <td><span className={`status-pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
              <td style={{ whiteSpace: "normal" }}>
                {r.selected.length === 0 ? "—" : r.selected.map((d) => `${TYPE[d.type ?? ""] ?? d.type} · fraction ${d.fraction?.[0]}/${d.fraction?.[1]} · ordre ${d.order}`).join(" ; ")}
              </td>
              <td style={{ whiteSpace: "normal" }}>
                {r.excluded.length === 0 ? "—" : r.excluded.map((e) => `${TYPE[e.declaration.type ?? ""] ?? e.declaration.type} ordre ${e.declaration.order ?? "n.d."} (${e.reason})`).join(" ; ")}
              </td>
              <td style={{ whiteSpace: "normal" }}>{r.messages.length ? r.messages.join(" ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
