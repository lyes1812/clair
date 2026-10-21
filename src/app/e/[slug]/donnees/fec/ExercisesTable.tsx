import type { FecExercise } from "@/lib/fec/import";
import { formatEuros } from "@/lib/money";

export function ExercisesTable({ rows, showWarnings = false }: { rows: (FecExercise & { syncId: string; pending: boolean })[]; showWarnings?: boolean }) {
  if (rows.length === 0) return <p className="muted" data-testid="fec-coverage-empty">n.d. — aucun FEC appliqué.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table" data-testid="fec-exercises">
        <thead>
          <tr><th>Fichier</th><th>SIREN</th><th>Période</th><th className="num">Lignes</th><th className="num">Écritures</th><th className="num">Total débit</th><th className="num">Total crédit</th><th>Équilibre</th>{showWarnings && <th>Constats</th>}</tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={`${e.syncId}-${e.filename}`}>
              <td>{e.filename}{e.pending && <span className="tag" style={{ marginLeft: 8 }}>aperçu</span>}</td>
              <td><code>{e.siren ?? "n.d."}</code></td>
              <td>{e.firstDate} → {e.lastDate}</td>
              <td className="num">{e.lines}</td>
              <td className="num">{e.entries}</td>
              <td className="num">{formatEuros(e.totalDebitCents)}</td>
              <td className="num">{formatEuros(e.totalCreditCents)}</td>
              <td>{e.balanced ? <span className="status-pill applied">équilibré</span> : <span className="status-pill failed">non équilibré{e.unbalancedEntries ? ` (${e.unbalancedEntries} écriture(s))` : ""}</span>}</td>
              {showWarnings && <td style={{ whiteSpace: "normal" }}>{e.warnings.length ? e.warnings.join(" ") : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
