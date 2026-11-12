import { DropdownMenu } from "@/components/DropdownMenu";
import { Money } from "@/components/Money";
import type { ActualNonRecurring } from "@/lib/payroll/non-recurring";
import type { RcPayslipPeriod } from "@/lib/payroll/rc-payslips";
import { ACTUAL_NON_RECURRING_CATEGORIES } from "@/lib/viz/actual-non-recurring";
import "@/styles/actual-non-recurring-summary.css";

type Props = {
  rows: ActualNonRecurring["rows"];
  href: string;
  testid?: string;
  unavailable?: boolean;
  rc?: RcPayslipPeriod;
};

const issue = (reason: string) => reason.includes("autre lecture de paie")
  ? { label: "Lecture à vérifier", detail: "Une identification dépend d’une autre lecture de paie. Vérifier son rattachement dans le détail." }
  : reason.includes("Montant chargé non saisi")
    ? { label: "Montant à renseigner", detail: "Une identification attend un montant ou un zéro confirmé sur justificatif." }
    : reason.includes("pas ventilés par service")
      ? { label: "Vue globale requise", detail: "Les coûts identifiés ne sont pas ventilés par service. Retirer le filtre Service pour lire leurs montants." }
      : { label: "À vérifier", detail: "Une identification doit être vérifiée dans le détail avant de reprendre son montant." };

/** Résumé agrégé uniquement : aucune référence de contrat, note ou provenance individuelle n’est rendue. */
export function ActualNonRecurringSummary({ rows, href, testid = "actual-non-recurring-summary", unavailable = false, rc }: Props) {
  const categories = ACTUAL_NON_RECURRING_CATEGORIES.map((category) => {
    const selected = rows.filter((row) => row.event.kind === category.kind);
    const issues = selected.flatMap((row) => row.reason ? [issue(row.reason)] : row.amount === null ? [issue("Montant chargé non saisi")] : []);
    const total = selected.reduce((sum, row) => sum + BigInt(row.amount ?? 0), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) issues.push(issue("Total hors des centimes entiers sûrs."));
    const amount = unavailable || issues.length || !selected.length ? null : Number(total);
    const estimate = selected.some((row) => row.amount !== null && row.event.calculation);
    return { ...category, count: selected.length, amount, estimate, issues };
  });
  const reasons = [...new Set([
    ...(unavailable ? ["Les identifications ne peuvent pas être lues sur la lecture courante."] : []),
    ...categories.flatMap((category) => category.issues.map((entry) => entry.detail)),
    ...(!unavailable && categories.some((category) => !category.count) ? ["Aucun élément identifié ne signifie pas qu’il n’existe aucun coût non récurrent."] : []),
    ...(categories.some((category) => category.estimate) ? ["Le tuilage estimé attribue le coût de l’entrant aux jours de chevauchement ; cette ventilation n’est pas observée dans la paie."] : []),
    ...(rc?.reason ? [rc.reason] : []),
  ])];
  return <section className="panel anr-summary" data-testid={testid} aria-label="Éléments non récurrents identifiés">
    <div className="anr-summary-head">
      <div><h2>Éléments non récurrents</h2><p>Déjà inclus dans la masse salariale réelle</p></div>
      <div className="anr-summary-actions">
        {reasons.length > 0 && <DropdownMenu className="anr-summary-vigilance" testid={`${testid}-vigilance`} label={<><span>Vigilance</span><span className="anr-summary-question" aria-label="Comprendre les points de vigilance">?</span></>}>
          <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </DropdownMenu>}
        <a href={href}>Détail et sources →</a>
      </div>
    </div>
    <dl className="anr-summary-categories">
      {categories.map((category) => {
        const bulletin = category.kind === "rupture-conventionnelle" && rc?.status !== "not-read" ? rc : undefined;
        const count = bulletin ? bulletin.mergedCount : category.count;
        return <div key={category.kind} data-testid={`${testid}-${category.kind}`}>
        <dt>{category.label}</dt>
        {bulletin && <dd className="anr-summary-meta">Indemnité RC · bulletin</dd>}
        <dd className={(bulletin ? bulletin.amountCents === null : category.amount === null) ? "anr-summary-state" : "anr-summary-amount"}>
          {bulletin ? bulletin.amountCents !== null ? <Money cents={bulletin.amountCents} /> : bulletin.status === "none" ? "Aucune indemnité repérée" : bulletin.status === "running" ? "Lecture en cours" : "n.d."
            : category.amount !== null ? <Money cents={category.amount} /> : unavailable ? "n.d." : !category.count ? "Aucun élément identifié" : "n.d."}
        </dd>
        {bulletin && <dd className="anr-summary-meta">Coût chargé identifié : {category.amount !== null ? <Money cents={category.amount} /> : "n.d."}{bulletin.status === "review" && <span>Bulletins à vérifier</span>}</dd>}
        {category.kind === "rupture-conventionnelle" && rc?.status === "not-read" && <dd className="anr-summary-meta">Bulletins non lus</dd>}
        {count > 0 && <dd className="anr-summary-meta">{count} élément{count > 1 ? "s" : ""} identifié{count > 1 ? "s" : ""}{category.issues.length > 0 ? <span>{[...new Set(category.issues.map((entry) => bulletin?.status === 'value' && entry.label === 'Montant à renseigner' ? 'Coût chargé à compléter' : entry.label))].join(" · ")}</span> : category.estimate ? <span>Estimation calendaire</span> : null}</dd>}
        {unavailable && <dd className="anr-summary-meta">Lecture indisponible</dd>}
      </div>; })}
    </dl>
  </section>;
}
