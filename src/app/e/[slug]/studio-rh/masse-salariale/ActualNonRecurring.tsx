import { Money, MoneyUnitLabel } from "@/components/Money";
import { SearchableSelect } from "@/components/SearchableSelect";
import type { JournalInput } from "@/lib/payroll/engine";
import { buildActualNonRecurring, type ActualEvent } from "@/lib/payroll/non-recurring";
import { formatMonth } from "@/lib/dates";
import { ActionForm } from "../hypotheses/ActionForm";
import type { FormState } from "../hypotheses/actions";
import { decText, Field, Text } from "../hypotheses/shared";
import { PanelHead, ReadDetails, ScrollTable, Tile } from "./components";

type Save = (previous: FormState, form: FormData) => Promise<FormState>;
type Props = {
  slug: string;
  input: JournalInput | null;
  events: ActualEvent[];
  months: string[];
  syncId: string | null;
  contracts: { key: string; label: string }[];
  editable: boolean;
  save?: Save;
};
const CATEGORIES = [
  { kind: "licenciement", label: "Licenciements" },
  { kind: "rupture-conventionnelle", label: "Ruptures conventionnelles" },
  { kind: "tuilage", label: "Tuilages passés" },
  { kind: "autre", label: "Autres éléments non récurrents" },
] as const;
const KINDS: Record<ActualEvent["kind"], string> = { licenciement: "Licenciement", "rupture-conventionnelle": "Rupture conventionnelle", tuilage: "Tuilage passé", autre: "Autre élément non récurrent" };
const shown = (amount: number | null, reason?: string | null) => amount === null
  ? <span className="nd" title={reason ?? "Montant non renseigné."}>n.d.</span>
  : <Money cents={amount} />;

function EventForm({ p, event }: { p: Props & { save: Save }; event?: ActualEvent }) {
  const id = `actual-non-recurring-${event?.id ?? "new"}`;
  const options = p.contracts.map((contract) => ({ value: contract.key, label: contract.label }));
  // Une référence devenue indisponible reste visible, jamais remplacée par le premier contrat de la liste.
  for (const key of event?.contractKeys ?? []) if (!options.some((option) => option.value === key)) options.push({ value: key, label: "Contrat indisponible dans le référentiel courant" });
  const choices = [{ value: "", label: "Aucun contrat / choisir…" }, ...options];
  return <ActionForm action={p.save} submit={event ? "Enregistrer l’identification" : "Identifier l’élément passé"} testid={id}>
    {event ? <input type="hidden" name="id" value={event.id} /> : null}
    <div className="filters">
      <Field id={`${id}-kind`} label="Nature"><select className="select" id={`${id}-kind`} name="kind" required defaultValue={event?.kind ?? ""}><option value="" disabled>Choisir la nature…</option>{CATEGORIES.map((category) => <option key={category.kind} value={category.kind}>{category.label}</option>)}</select></Field>
      <Field id={`${id}-month`} label="Mois du réel"><select className="select" id={`${id}-month`} name="month" required defaultValue={event?.month ?? ""}><option value="" disabled>Choisir un mois…</option>{p.months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></Field>
      <Field id={`${id}-valuation`} label="Origine du montant"><select className="select" id={`${id}-valuation`} name="valuation" defaultValue={event?.calculation ? "calendar" : "manual"}><option value="manual">Montant fourni sur justificatif</option><option value="calendar">Tuilage : estimation calendaire depuis la paie</option></select></Field>
      <Text id={`${id}-amount`} name="chargedEuros" label="Coût chargé isolé (€)" inputMode="decimal" defaultValue={decText(event?.chargedCents)} hint="Montant fourni uniquement : vide = n.d. ; 0 = zéro confirmé. En estimation calendaire, ce champ est ignoré et le serveur recalcule depuis la paie." />
    </div>
    <div className="filters">
      <Field id={`${id}-contract1`} label="Contrat concerné / entrant du tuilage" hint="Facultatif hors tuilage. Pour calculer un tuilage, choisis ici l’entrant : seul son coût est attribué au chevauchement."><SearchableSelect className="select" id={`${id}-contract1`} name="contract1" defaultValue={event?.contractKeys[0] ?? ""} searchLabel="Contrat concerné ou entrant du tuilage" options={choices} /></Field>
      <Field id={`${id}-contract2`} label="Sortant du tuilage" hint="Pour un tuilage uniquement ; deux contrats distincts sont nécessaires. Laisser vide pour les autres éléments."><SearchableSelect className="select" id={`${id}-contract2`} name="contract2" defaultValue={event?.contractKeys[1] ?? ""} searchLabel="Sortant du tuilage" options={choices} /></Field>
    </div>
    {event && !event.calculation && event.chargedCents !== null ? <label className="desc"><input type="checkbox" name="confirmReplace" value="yes" /> Si je choisis l’estimation calendaire, je confirme qu’elle remplace le montant fourni de cette identification. Sinon, mon montant sur justificatif est conservé.</label> : null}
    <Field id={`${id}-note`} label="Source du montant / justificatif" hint="Requise lorsqu’un montant est renseigné. Indique la pièce ou l’origine de l’identification."><textarea className="input" id={`${id}-note`} name="note" maxLength={300} rows={2} defaultValue={event?.note ?? ""} /></Field>
    <p className="desc">Le coût est déjà compris dans la paie réelle. En estimation calendaire : coût chargé mensuel de l’entrant × jours de chevauchement ÷ jours de présence de l’entrant dans le mois. Le coût du sortant n’est pas ajouté ; primes et régularisations ne sont pas datées au jour. Aucun coût juridique n’est calculé.</p>
  </ActionForm>;
}

function categorySummary(rows: ReturnType<typeof buildActualNonRecurring>["rows"], kind: ActualEvent["kind"]) {
  const selected = rows.filter((row) => row.event.kind === kind);
  const reasons = [...new Set(selected.flatMap((row) => row.amount === null ? [row.reason ?? "Montant non renseigné."] : []))];
  if (reasons.length) return { count: selected.length, amount: null, reason: reasons.join(" · ") };
  const total = selected.reduce((sum, row) => sum + BigInt(row.amount!), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) return { count: selected.length, amount: null, reason: "Total de catégorie hors des centimes entiers sûrs." };
  return { count: selected.length, amount: Number(total), reason: null };
}

export function ActualNonRecurring(p: Props) {
  const model = buildActualNonRecurring(p.input, p.events, p.months, p.syncId);
  const reason = model.reasons.join(" · ");
  const save = p.editable && p.save && p.syncId && p.input && p.months.length ? p.save : null;
  const contractLabel = (keys: string[]) => keys.length ? keys.map((key) => p.contracts.find((contract) => contract.key === key)?.label ?? "Contrat indisponible dans le référentiel courant").join(" · ") : "Non rattaché à un contrat";
  return <section className="panel" data-testid="actual-non-recurring">
    <PanelHead title="Éléments non récurrents du réel" desc={<>Éléments identifiés sur la période affichée · <MoneyUnitLabel /></>} />
    <p className="desc">Licenciements, ruptures conventionnelles et tuilages passés : ces coûts sont déjà compris dans la masse salariale réelle, qui reste inchangée. Cette liste déclarative n’est pas exhaustive.</p>
    <dl className="facts ms-tiles" data-testid="actual-non-recurring-kpis">
      <Tile testid="actual-non-recurring-raw" label="Masse salariale réelle" value={shown(model.raw, reason)} nd={model.raw === null} lead="Lecture PayFit appliquée, sans modification" />
      <Tile testid="actual-non-recurring-identified" label="Coûts identifiés" value={shown(model.nonRecurring, reason)} nd={model.nonRecurring === null} lead="Montants fournis ou estimations calendaires, liste non exhaustive" compare={model.nonRecurring === null ? "Un montant non renseigné rend le cumul n.d." : model.rows.length ? `${model.rows.length} élément${model.rows.length === 1 ? "" : "s"} identifié${model.rows.length === 1 ? "" : "s"}` : "Aucun élément identifié : cela ne prouve pas son absence"} />
      <Tile testid="actual-non-recurring-adjusted" label="Hors éléments identifiés" value={shown(model.adjusted, reason)} nd={model.adjusted === null} lead="Réel − coûts identifiés · lecture analytique" compare="Les montants sources ne sont ni réécrits ni diminués" />
    </dl>
    {model.rows.some((row) => row.event.calculation) ? <p className="notice" data-testid="actual-overlap-qualification">Estimation calendaire incluse : coût de l’entrant attribué aux jours de chevauchement. Le montant mensuel vient de la paie ; sa ventilation journalière est calculée, pas observée.</p> : null}
    {model.reasons.length ? <ul className="ms-nd-reasons" data-testid="actual-non-recurring-reasons">{model.reasons.map((line) => <li key={line}>{line}</li>)}</ul> : null}
    <ScrollTable label="Éléments non récurrents du réel par nature"><table className="data-table sticky sticky-first" data-testid="actual-non-recurring-categories"><thead><tr><th scope="col">Nature</th><th scope="col" className="num">Éléments identifiés</th><th scope="col" className="num">Coût chargé déclaré</th></tr></thead><tbody>{CATEGORIES.map((category) => {
      const summary = categorySummary(model.rows, category.kind);
      return <tr key={category.kind}><th scope="row">{category.label}</th><td className="num">{summary.count || "Aucun élément identifié"}</td><td className="num">{summary.count ? shown(summary.amount, summary.reason) : "—"}{summary.reason ? <p className="tile-foot">{summary.reason}</p> : null}</td></tr>;
    })}</tbody></table></ScrollTable>
    {p.editable && model.rows.length ? <>
      <ScrollTable label="Identifications du réel et sources renseignées"><table className="data-table sticky sticky-first" data-testid="actual-non-recurring-details"><thead><tr><th scope="col">Mois</th><th scope="col">Nature</th><th scope="col">Contrat / binôme</th><th scope="col" className="num">Coût chargé isolé</th><th scope="col">Source / justificatif</th></tr></thead><tbody>{model.rows.map((row) => <tr key={row.event.id}><th scope="row">{formatMonth(row.event.month)}</th><td>{KINDS[row.event.kind]}</td><td className="wrap">{contractLabel(row.event.contractKeys)}</td><td className="num">{shown(row.amount, row.reason)}{row.reason ? <p className="tile-foot">{row.reason}</p> : null}</td><td className="wrap">{row.event.calculation ? <><strong>Estimation calendaire</strong><p className="tile-foot">Coût mensuel de l’entrant <Money cents={row.event.calculation.source.chargedCents!} /> × {row.event.calculation.days.overlap}/{row.event.calculation.days.incomingPresence} jours · {row.event.calculation.interval ? `${row.event.calculation.interval.from} → ${row.event.calculation.interval.to}` : "aucun chevauchement"}. Primes et régularisations non ventilées par jour.</p></> : null}{row.event.note || (!row.event.calculation ? <span className="nd">Source non renseignée</span> : null)}</td></tr>)}</tbody></table></ScrollTable>
      {save ? model.rows.map((row) => <details className="ms-read-details" key={row.event.id}><summary>Modifier l’identification : {KINDS[row.event.kind]} · {formatMonth(row.event.month)}</summary><div className="ms-read-body"><EventForm p={{ ...p, save }} event={row.event} /></div></details>) : null}
    </> : null}
    {save ? <details className="ms-read-details" data-testid="actual-non-recurring-create"><summary>Identifier un élément passé</summary><div className="ms-read-body"><EventForm p={{ ...p, save }} /></div></details> : null}
    <ReadDetails><p>Les montants sont isolés sur la lecture PayFit retenue, pour les mois affichés. Un coût non renseigné reste n.d. ; aucun total partiel n’est présenté comme complet.</p><p>Le simple chevauchement de contrats ne prouve pas un remplacement : aucun prorata automatique n’est déclenché. L’estimation calendaire demande de choisir explicitement les rôles entrant et sortant ; elle est recalculée sur le serveur puis enregistrée avec sa provenance.</p><p>Les identifications et leurs sources sont distinctes du journal comptable de paie, consultable dans <a href={`/e/${p.slug}/donnees`}>Données</a>.</p></ReadDetails>
  </section>;
}

export default ActualNonRecurring;
