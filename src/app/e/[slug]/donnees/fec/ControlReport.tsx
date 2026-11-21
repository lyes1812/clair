import { MoneyText } from "@/components/Money";
import { FEC_SEVERITY_LABELS, type FecCheck, type FecStoredControls } from "@/lib/fec/controls";
import { formatEuros } from "@/lib/money";
import { Pill, type Tone } from "../ui";

// Rapport de contrôle F01 à F09 d'un FEC : un tableau par fichier, les lignes rejetées et les soldes fournisseurs (F09).
const statusPill = (c: FecCheck): { tone: Tone; label: string } => {
  if (c.status === "ok") return { tone: "applied", label: "conforme" };
  if (c.status === "nd") return { tone: "neutral", label: "n.d." };
  if (c.severity === "blocking") return { tone: "failed", label: "refus" };
  if (c.severity === "info") return { tone: "preview", label: "information" };
  return { tone: "preview", label: c.severity === "strong" ? "avertissement fort" : "avertissement" };
};

export function ControlReport({ title, checks, stored, testid = "fec-control-report" }: { title: string; checks: FecCheck[]; stored?: Pick<FecStoredControls, "rejectedRows" | "rejectedCount" | "suppliers"> | null; testid?: string }) {
  const suppliers = stored?.suppliers ?? null;
  return (
    // Constats au centime : pas d'arrondi d'affichage, un écart de 0,10 € doit rester lisible.
    <div className="dn-report" data-testid={testid}>
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Code</th><th scope="col">Contrôle</th><th scope="col">Gravité</th><th scope="col">Résultat</th><th scope="col">Constat</th></tr></thead>
          <tbody>
            {checks.map((c) => {
              const p = statusPill(c);
              return (
                <tr key={c.code} data-testid={`fec-check-${c.code}`} data-status={c.status}>
                  <td><code>{c.code}</code></td>
                  <td className="wrap">{c.label}</td>
                  <td>{FEC_SEVERITY_LABELS[c.severity]}</td>
                  <td><Pill tone={p.tone}>{p.label}</Pill></td>
                  <td className="wrap">{c.detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {stored && stored.rejectedCount > 0 && (
        <details data-testid="fec-rejected-rows">
          <summary>{stored.rejectedCount} ligne(s) rejetée(s){stored.rejectedCount > stored.rejectedRows.length ? ` (${stored.rejectedRows.length} premières listées)` : ""}</summary>
          <ul>{stored.rejectedRows.map((r) => <li key={r.line}>{r.reason}</li>)}</ul>
        </details>
      )}
      {suppliers && suppliers.count > 0 && (
        <MoneyText><details data-testid="fec-suppliers">
          <summary>F09 · soldes fournisseurs par compte auxiliaire ({suppliers.count}{suppliers.count > suppliers.top.length ? `, ${suppliers.top.length} plus gros soldes listés` : ""})</summary>
          <div className="table-wrap scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Compte auxiliaire</th><th scope="col">Libellé</th><th scope="col" className="num">Lignes</th><th scope="col" className="num">Solde créditeur</th><th scope="col" className="num">Non lettré</th></tr></thead>
              <tbody>
                {suppliers.top.map((s) => (
                  <tr key={s.auxiliary ?? ""}>
                    <td><code>{s.auxiliary ?? "sans auxiliaire"}</code></td>
                    <td>{s.label ?? "n.d."}</td>
                    <td className="num">{s.lines}</td>
                    <td className="num">{formatEuros(s.balanceCents)}</td>
                    <td className="num">{formatEuros(s.unletteredCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details></MoneyText>
      )}
    </div>
  );
}
