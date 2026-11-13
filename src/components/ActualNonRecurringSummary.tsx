import { DropdownMenu } from "@/components/DropdownMenu";
import { Money } from "@/components/Money";
import type { ActualNonRecurring } from "@/lib/payroll/non-recurring";
import type { RcPayslipPeriod } from "@/lib/payroll/rc-payslips";
import type { LiveNonRecurring } from "@/lib/payroll/live-non-recurring";
import { ACTUAL_NON_RECURRING_CATEGORIES } from "@/lib/viz/actual-non-recurring";
import "@/styles/actual-non-recurring-summary.css";

type Props = {
  rows: ActualNonRecurring["rows"];
  href: string;
  testid?: string;
  unavailable?: boolean;
  rc?: RcPayslipPeriod;
  live?: LiveNonRecurring;
};

const issue = (reason: string) => reason.includes("autre lecture de paie")
  ? { label: "Lecture à vérifier", detail: "Une identification dépend d’une autre lecture de paie. Vérifier son rattachement dans le détail." }
  : reason.includes("Montant chargé non saisi")
    ? { label: "Montant à renseigner", detail: "Une identification attend un montant ou un zéro confirmé sur justificatif." }
    : reason.includes("pas ventilés par service")
      ? { label: "Vue globale requise", detail: "Les coûts identifiés ne sont pas ventilés par service. Retirer le filtre Service pour lire leurs montants." }
      : { label: "À vérifier", detail: "Une identification doit être vérifiée dans le détail avant de reprendre son montant." };

/** Résumé agrégé uniquement : aucune référence de contrat, note ou provenance individuelle n’est rendue. */
export function ActualNonRecurringSummary({ rows, href, testid = "actual-non-recurring-summary", unavailable = false, rc, live }: Props) {
  const entries = live?.entries ?? rows.map((row) => ({ month: row.event.month, kind: row.event.kind, amount: row.amount, reason: row.reason, estimated: !!row.event.calculation }));
  const categories = ACTUAL_NON_RECURRING_CATEGORIES.map((category) => {
    const selected = entries.filter((row) => row.kind === category.kind);
    const issues = selected.flatMap((row) => row.reason ? [issue(row.reason)] : row.amount === null ? [issue("Montant chargé non saisi")] : []);
    const total = selected.reduce((sum, row) => sum + BigInt(row.amount ?? 0), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) issues.push(issue("Total hors des centimes entiers sûrs."));
    const amount = unavailable || issues.length || !selected.length ? null : Number(total);
    const estimate = selected.some((row) => row.amount !== null && row.estimated);
    return { ...category, count: selected.length, amount, estimate, issues };
  });
  const reasons = [...new Set([
    ...(unavailable ? ["Les identifications ne peuvent pas être lues sur la lecture courante."] : []),
    ...categories.flatMap((category) => category.issues.map((entry) => entry.detail)),
    ...(!unavailable && categories.some((category) => !category.count) ? ["Aucun élément identifié ne signifie pas qu’il n’existe aucun coût non récurrent."] : []),
    ...(categories.some((category) => category.estimate) ? ["Le tuilage estimé attribue le coût de l’entrant aux jours de chevauchement ; cette ventilation n’est pas observée dans la paie."] : []),
    ...(rc?.reason ? [rc.reason] : []),
    ...(rc && rc.costStatus !== "value" && rc.status !== "none" ? [rc.costReason ?? "Contributions patronales propres à la RC non isolées ; le coût chargé reste à vérifier."] : []),
  ])];
  return <section className="panel anr-summary" data-testid={testid} aria-label="Éléments non récurrents identifiés">
    <div className="anr-summary-head">
      <div><h2>Éléments non récurrents</h2><p>Coûts identifiés sur la période affichée</p></div>
      <div className="anr-summary-actions">
        {reasons.length > 0 && <DropdownMenu className="anr-summary-vigilance" testid={`${testid}-vigilance`} label={<><span>Vigilance</span><span className="anr-summary-question" aria-label="Comprendre les points de vigilance">?</span></>}>
          <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </DropdownMenu>}
        <a href={href}>Détail et sources →</a>
      </div>
    </div>
    <dl className="anr-summary-categories">
      {categories.map((category) => {
        const bulletin = category.kind === "rupture-conventionnelle" ? rc : undefined;
        const count = live || !bulletin || bulletin.status === "not-read" ? category.count : bulletin.mergedCount;
        // Sans adaptateur, une RC manuelle garde sa lecture historique. Le coût du bulletin ne sert de repli qu’en l’absence de saisie manuelle.
        const charged = category.amount ?? (!live && !category.count && bulletin?.costStatus === "value" && !unavailable ? bulletin.chargedCents ?? null : null);
        return <div key={category.kind} data-testid={`${testid}-${category.kind}`}>
        <dt>{category.label}</dt>
        {bulletin && <dd className="anr-summary-meta">Coût chargé RC</dd>}
        <dd className={charged === null ? "anr-summary-state" : "anr-summary-amount"}>
          {charged !== null ? <Money cents={charged} /> : unavailable ? "n.d." : bulletin && bulletin.status !== "not-read" ? bulletin.status === "none" && !count ? "Aucune indemnité repérée" : "n.d." : !category.count ? "Aucun élément identifié" : "n.d."}
        </dd>
        {bulletin && <dd className="anr-summary-meta">Indemnité RC · bulletin : {bulletin.amountCents !== null ? <Money cents={bulletin.amountCents} /> : "n.d."}{bulletin.status === "review" ? <span>Bulletins à vérifier</span> : bulletin.status === "running" ? <span>Lecture en cours</span> : bulletin.status === "not-read" ? <span>Bulletins non lus</span> : null}{charged === null && bulletin.status !== "none" && bulletin.status !== "not-read" ? <span>Coût chargé à vérifier</span> : null}</dd>}
        {count > 0 && <dd className="anr-summary-meta">{count} élément{count > 1 ? "s" : ""} identifié{count > 1 ? "s" : ""}{category.issues.length > 0 ? <span>{[...new Set(category.issues.map((entry) => bulletin?.status === "value" && entry.label === "Montant à renseigner" ? "Coût chargé à compléter" : entry.label))].join(" · ")}</span> : category.estimate ? <span>Estimation calendaire</span> : null}</dd>}
        {unavailable && <dd className="anr-summary-meta">Lecture indisponible</dd>}
      </div>; })}
    </dl>
  </section>;
}
