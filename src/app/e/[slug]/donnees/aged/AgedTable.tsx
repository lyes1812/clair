import { MoneyText } from "@/components/Money";
import type { AgedInvoice } from "@/lib/aged/parser";
import { formatDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { AGING_LABELS, agingOf, type AgingBucket } from "@/lib/restructuring/crisis/claims";
import { Empty } from "../ui";

const BUCKETS: AgingBucket[] = ["non_echu", "0_30", "31_60", "61_90", "plus_90", "nd"];

// Factures de la balance âgée et tranches d'âge recalculées à la date de la balance (jamais reprises du fichier).
export function AgedTable({ invoices, asOf, testid = "aged-invoices" }: { invoices: AgedInvoice[]; asOf: string; testid?: string }) {
  if (!invoices.length) return <Empty>Aucune facture.</Empty>;
  const buckets = BUCKETS.map((b) => {
    const members = invoices.filter((i) => agingOf(i.dueDate, asOf) === b);
    return { b, count: members.length, cents: members.reduce((t, i) => t + i.amountCents, 0) };
  });
  const total = invoices.reduce((t, i) => t + i.amountCents, 0);
  return (
    <MoneyText>
      <div className="table-wrap">
        <table className="data-table" data-testid={`${testid}-aging`}>
          <thead><tr><th scope="col">Tranche (retard à l&apos;échéance au {formatDate(asOf)})</th><th scope="col" className="num">Factures</th><th scope="col" className="num">Restant dû</th></tr></thead>
          <tbody>
            {buckets.map((x) => <tr key={x.b}><td>{AGING_LABELS[x.b]}</td><td className="num">{x.count}</td><td className="num">{formatEuros(x.cents)}</td></tr>)}
            <tr><th scope="row">Total</th><td className="num">{invoices.length}</td><td className="num">{formatEuros(total)}</td></tr>
          </tbody>
        </table>
      </div>
      <details>
        <summary>{invoices.length} facture(s)</summary>
        <div className="table-wrap scroll">
          <table className="data-table sticky" data-testid={testid}>
            <thead><tr><th scope="col">Fournisseur</th><th scope="col">Compte</th><th scope="col">Facture</th><th scope="col">Date</th><th scope="col">Échéance</th><th scope="col" className="num">Restant dû</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.line}>
                  <td>{i.supplier}</td><td><code>{i.auxiliary ?? "n.d."}</code></td><td>{i.invoice}</td><td>{formatDate(i.invoiceDate)}</td>
                  <td>{i.dueDate ? formatDate(i.dueDate) : <span className="nd">n.d.</span>}</td><td className="num">{formatEuros(i.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </MoneyText>
  );
}
