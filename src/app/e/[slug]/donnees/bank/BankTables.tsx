import { MoneyText } from "@/components/Money";
import { BANK_FORMAT_LABELS } from "@/lib/bank/model";
import type { AccountLedger, Continuity } from "@/lib/bank/ledger";
import type { BankStatementSummary } from "@/lib/bank/import";
import { formatDate } from "@/lib/dates";
import { formatEuros } from "@/lib/money";
import { Empty, Pill } from "../ui";

const MOVEMENTS_SHOWN = 30;

export function ContinuityPill({ c }: { c: Continuity }) {
  if (c.kind === "ok") return <Pill tone="applied">continu</Pill>;
  if (c.kind === "gap") return <Pill tone="failed">{`écart ${formatEuros(c.gapCents)}`}</Pill>;
  return <span className="nd" title={c.reason}>n.d. — {c.reason}</span>;
}

const balance = (b: { date: string; cents: number } | null) => (b ? <>{formatEuros(b.cents)} <span className="desc">au {formatDate(b.date)}</span></> : <span className="nd">n.d.</span>);

/** Relevés lus (un fichier CAMT.053 peut en contenir plusieurs). */
export function StatementsTable({ rows }: { rows: BankStatementSummary[] }) {
  if (!rows.length) return <Empty>Aucun relevé lu.</Empty>;
  return (
    <MoneyText><div className="table-wrap scroll">
      <table className="data-table sticky" data-testid="bank-statements">
        <thead><tr><th scope="col">Fichier</th><th scope="col">Format</th><th scope="col">Compte</th><th scope="col">Période</th><th scope="col" className="num">Mouvements</th><th scope="col" className="num">Solde d'ouverture</th><th scope="col" className="num">Total des mouvements</th><th scope="col" className="num">Solde de clôture</th><th scope="col">Continuité</th></tr></thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={`${s.filename}-${i}`}>
              <td>{s.filename}</td>
              <td>{BANK_FORMAT_LABELS[s.format]}</td>
              <td><code>{s.masked}</code></td>
              <td>{formatDate(s.from)} → {formatDate(s.to)}</td>
              <td className="num">{s.movements}</td>
              <td className="num">{balance(s.opening)}</td>
              <td className="num">{formatEuros(s.netCents)}</td>
              <td className="num">{balance(s.closing)}</td>
              <td className="wrap"><ContinuityPill c={s.continuity} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div></MoneyText>
  );
}

/** Comptes : relevés empilés et dédoublonnés, contrôles par compte, derniers mouvements. */
export function AccountsTable({ ledger, testid = "bank-accounts" }: { ledger: AccountLedger[]; testid?: string }) {
  if (!ledger.length) return <Empty testid={`${testid}-empty`}>n.d. — aucun relevé appliqué.</Empty>;
  return (
    <MoneyText><div className="table-wrap scroll">
      <table className="data-table sticky" data-testid={testid}>
        <thead><tr><th scope="col">Compte</th><th scope="col">Banque</th><th scope="col">Période couverte</th><th scope="col" className="num">Mouvements</th><th scope="col" className="num">Doublons écartés</th><th scope="col" className="num">Dernier solde de clôture</th><th scope="col">Contrôles</th></tr></thead>
        <tbody>
          {ledger.map((a) => (
            <tr key={a.accountKey}>
              <td><code>{a.masked}</code></td>
              <td>{a.bank ?? <span className="nd">n.d.</span>}</td>
              <td>{a.from ? `${formatDate(a.from)} → ${formatDate(a.to)}` : <span className="nd">n.d.</span>}</td>
              <td className="num">{a.movements.length}</td>
              <td className="num">{a.duplicates}</td>
              <td className="num">{balance(a.lastClosing)}</td>
              <td className="wrap">{a.warnings.length ? <ul className="dn-warnings">{a.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : <Pill tone="applied">aucun constat</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div></MoneyText>
  );
}

export function RecentMovements({ ledger }: { ledger: AccountLedger[] }) {
  return (
    <MoneyText><>
      {ledger.map((a) => {
        const recent = a.movements.slice(-MOVEMENTS_SHOWN).reverse();
        return (
          <details key={a.accountKey} className="dn-details">
            <summary>{a.masked} : {recent.length} derniers mouvements sur {a.movements.length}</summary>
            <div className="table-wrap scroll">
              <table className="data-table sticky" data-testid="bank-movements">
                <thead><tr><th scope="col">Date</th><th scope="col">Libellé</th><th scope="col">Contrepartie</th><th scope="col" className="num">Montant</th></tr></thead>
                <tbody>
                  {recent.map((m) => (
                    <tr key={m.key}><td>{formatDate(m.bookingDate)}</td><td className="wrap">{m.label}</td><td>{m.counterparty ?? <span className="nd">n.d.</span>}</td><td className="num">{formatEuros(m.amountCents)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </></MoneyText>
  );
}
