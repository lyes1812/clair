import { MoneyText } from "@/components/Money";
import type { FecExercise } from "@/lib/fec/import";
import { formatEuros } from "@/lib/money";
import { Empty, Pill } from "../ui";

export function ExercisesTable({ rows, showWarnings = false }: { rows: (FecExercise & { syncId: string; pending: boolean })[]; showWarnings?: boolean }) {
  if (rows.length === 0) return <MoneyText><Empty testid="fec-coverage-empty">n.d. — aucun FEC appliqué.</Empty></MoneyText>;
  return (
    <MoneyText><div className="table-wrap scroll">
      <table className="data-table sticky" data-testid="fec-exercises">
        <thead>
          <tr><th scope="col">Fichier</th><th scope="col">SIREN</th><th scope="col">Période</th><th scope="col" className="num">Lignes</th><th scope="col" className="num">Écritures</th><th scope="col" className="num">Total débit</th><th scope="col" className="num">Total crédit</th><th scope="col">Équilibre</th>{showWarnings && <th scope="col">Constats</th>}</tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={`${e.syncId}-${e.filename}`}>
              <td>{e.filename}{e.pending && <span className="tag dn-tag-inline">aperçu</span>}</td>
              <td><code>{e.siren ?? "n.d."}</code></td>
              <td>{e.firstDate} → {e.lastDate}</td>
              <td className="num">{e.lines}</td>
              <td className="num">{e.entries}</td>
              <td className="num">{formatEuros(e.totalDebitCents)}</td>
              <td className="num">{formatEuros(e.totalCreditCents)}</td>
              <td>{e.balanced ? <Pill tone="applied">équilibré</Pill> : <Pill tone="failed">{`non équilibré${e.unbalancedEntries ? ` (${e.unbalancedEntries} écriture(s))` : ""}`}</Pill>}</td>
              {showWarnings && <td className="wrap">{e.warnings.length ? e.warnings.join(" ") : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div></MoneyText>
  );
}
