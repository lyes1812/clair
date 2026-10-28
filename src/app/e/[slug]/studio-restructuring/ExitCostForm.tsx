import { SearchableSelect } from "@/components/SearchableSelect";
import type { Hypothesis } from "@/lib/budget/types";
import { monthEnd } from "@/lib/dates";
import { EXIT_MOTIFS } from "@/lib/restructuring/forms";
import type { RestructuringScenario } from "@/lib/restructuring/model";
import { ActionForm } from "../studio-rh/hypotheses/ActionForm";
import type { FormState } from "../studio-rh/hypotheses/actions";
import { decText, Field, Text } from "../studio-rh/hypotheses/shared";

export type ExitCostAction = (previous: FormState, form: FormData) => Promise<FormState>;
type Departure = Extract<Hypothesis, { kind: "depart" }>;

/** Les montants sont saisis en euros ; aucun coût de départ n'est estimé. */
export function ExitCostForm({ proposal, action, departure }: { proposal: RestructuringScenario; action: ExitCostAction; departure?: Departure }) {
  const id = `restructuring-exit-${departure?.id ?? "new"}`;
  const alreadyDeparting = new Set(proposal.hypotheses.flatMap((hypothesis) => hypothesis.kind === "depart" ? [hypothesis.contractKey] : []));
  const contracts = proposal.base.contracts.filter((contract) => !alreadyDeparting.has(contract.contractKey));
  const selectedContract = departure ? proposal.base.contracts.find((contract) => contract.contractKey === departure.contractKey) : null;
  const previousMotif = departure?.motif ?? "";
  const motifs: string[] = [...EXIT_MOTIFS];
  if (previousMotif && !motifs.includes(previousMotif)) motifs.push(previousMotif);
  const amount = departure?.exitCost;
  if (!departure && !contracts.length) return <p className="desc" data-testid="restructuring-exit-no-contract">Aucun contrat sans départ déjà saisi n’est disponible dans la base de ce projet. Les départs existants se modifient ci-dessous.</p>;
  return <ActionForm action={action} submit={departure ? "Enregistrer le départ" : "Ajouter le départ"} testid={id} className="form restructuring-exit-form">
    {departure ? <><input type="hidden" name="hypothesisId" value={departure.id} /><input type="hidden" name="contractKey" value={departure.contractKey} /><p className="desc">Contrat : <strong>{selectedContract?.label ?? "contrat du départ enregistré"}</strong>. Le contrat et les liens de remplacement sont conservés.</p></> : <Field id={`${id}-contract`} label="Contrat concerné"><SearchableSelect id={`${id}-contract`} name="contractKey" className="select" required defaultValue="" searchLabel="Contrat concerné" options={[
      { value: "", label: "Choisir un contrat…", disabled: true },
      ...contracts.map((contract) => ({ value: contract.contractKey, label: contract.label })),
    ]} /></Field>}
    <div className="filters restructuring-exit-fields">
      <Field id={`${id}-motif`} label="Motif"><select id={`${id}-motif`} className="select" name="motif" required defaultValue={previousMotif}><option value="" disabled>Choisir un motif…</option>{motifs.map((motif) => <option key={motif} value={motif}>{motif}</option>)}</select></Field>
      <Field id={`${id}-date`} label="Dernier jour payé"><input id={`${id}-date`} className="input" name="lastPaidDate" type="date" required min={`${proposal.firstMonth}-01`} max={monthEnd(proposal.lastMonth)} defaultValue={departure?.lastPaidDate ?? ""} /></Field>
      <Field id={`${id}-mode`} label="Saisie du coût de sortie"><select id={`${id}-mode`} className="select" name="exitMode" required defaultValue={amount?.mode ?? ""}><option value="" disabled>Choisir le mode…</option><option value="charge">Coût chargé</option><option value="brut">Brut + taux de charges</option></select></Field>
    </div>
    <div className="filters restructuring-exit-fields">
      <Text id={`${id}-cost`} name="exitCout" label="Coût chargé (€)" inputMode="decimal" defaultValue={amount?.mode === "charge" ? decText(amount.costCents) : ""} hint="À renseigner si le mode Coût chargé est choisi." />
      <Text id={`${id}-gross`} name="exitBrut" label="Brut (€)" inputMode="decimal" defaultValue={amount?.mode === "brut" ? decText(amount.brutCents) : ""} hint="À renseigner si le mode Brut + taux est choisi." />
      <Text id={`${id}-rate`} name="exitTaux" label="Taux de charges (%)" inputMode="decimal" defaultValue={amount?.mode === "brut" ? decText(amount.chargesBps) : ""} hint="Taux explicite requis en mode brut, y compris s’il est nul." />
    </div>
    <p className="desc">Montants en euros, indépendamment de l’affichage € / k€. Un champ vide n’est pas un zéro ; saisis 0 pour un coût nul confirmé. Aucun calcul d’indemnité légale ou conventionnelle.</p>
  </ActionForm>;
}
