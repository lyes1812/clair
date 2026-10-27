"use client";

import { useState } from "react";
import { formatMonth } from "@/lib/dates";
import { FINANCE_ROWS, type FinancePlan } from "@/lib/finance/types";
import { decText, Field } from "../studio-rh/hypotheses/shared";

type Props = {
  plan: FinancePlan | null;
  year: number;
  rhOptions: { id: string; name: string; firstMonth: string; lastMonth: string }[];
};

/** La saisie reste en euros, indépendamment de l’unité d’affichage du tableau de bord. */
export function FinancePlanGrid({ plan, year, rhOptions }: Props) {
  const [kind, setKind] = useState<"budget" | "forecast">(plan?.kind ?? "budget");
  const [personnel, setPersonnel] = useState<"manual" | "rh">(plan?.personnelSource ?? "manual");
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  const first = plan?.firstForecastMonth ?? "";
  return <>
    <div className="filters finance-plan-fields">
      <Field id="finance-plan-name" label="Nom"><input className="input" id="finance-plan-name" name="name" defaultValue={plan?.name ?? ""} maxLength={120} required /></Field>
      <Field id="finance-plan-kind" label="Lecture"><select className="select" id="finance-plan-kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value as "budget" | "forecast")}><option value="budget">Budget</option><option value="forecast">Prévision : réel puis hypothèses</option></select></Field>
      <Field id="finance-plan-year" label="Année" hint="L’année se choisit dans les filtres de la page."><input className="input" id="finance-plan-year" name="year" value={year} readOnly /></Field>
      {kind === "forecast" ? <Field id="finance-plan-first" label="Premier mois prévisionnel" hint="Les mois précédents restent comptables, même si le réel est incomplet."><select className="select" id="finance-plan-first" name="firstForecastMonth" defaultValue={first} required><option value="" disabled>Choisir le mois…</option>{months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></Field> : <input type="hidden" name="firstForecastMonth" value="" />}
      <Field id="finance-plan-personnel" label="Personnel projeté"><select className="select" id="finance-plan-personnel" name="personnelSource" value={personnel} onChange={(event) => setPersonnel(event.target.value as "manual" | "rh")}><option value="manual">Montants saisis dans ce plan</option><option value="rh">Scénario du Studio RH</option></select></Field>
      {personnel === "rh" ? <Field id="finance-plan-rh" label="Scénario RH" hint="Remplace uniquement le personnel projeté ; le réel comptable reste inchangé."><select className="select" id="finance-plan-rh" name="rhScenarioId" defaultValue={plan?.rhScenarioId ?? ""} required><option value="" disabled>Choisir explicitement un scénario…</option>{rhOptions.map((option) => <option key={option.id} value={option.id}>{option.name} · {formatMonth(option.firstMonth)} → {formatMonth(option.lastMonth)}</option>)}</select></Field> : <input type="hidden" name="rhScenarioId" value="" />}
    </div>
    {personnel === "rh" && rhOptions.length === 0 ? <p className="notice">Aucun scénario RH disponible : crée un scénario dans les Hypothèses budgétaires, puis sélectionne-le ici.</p> : null}
    <div className="table-wrap scroll finance-plan-grid" tabIndex={0} role="region" aria-label="Montants du plan sur douze mois">
      <table className="data-table">
        <caption>Montants saisis en euros, avec décimales possibles. Vide = non renseigné ; 0 = montant nul.</caption>
        <thead><tr><th scope="col">Ligne financière</th>{months.map((month) => <th key={month} scope="col">{formatMonth(month)}</th>)}</tr></thead>
        <tbody>{FINANCE_ROWS.map((row) => <tr key={row.id} data-rh-inactive={row.id === "personnel" && personnel === "rh" ? true : undefined}>
          <th scope="row">{row.label}{row.id === "personnel" && personnel === "rh" ? <small>Scénario RH : saisies manuelles conservées, non utilisées.</small> : null}</th>
          {months.map((month) => <td key={month}><input className="input" name={`cell:${month}:${row.id}`} inputMode="decimal" aria-label={`${row.label}, ${formatMonth(month)}, euros`} defaultValue={decText(plan?.cells[month]?.[row.id])} readOnly={row.id === "personnel" && personnel === "rh"} /></td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <p className="desc">Produits et charges sont saisis positifs ; un avoir ou une régularisation peut être négatif. Résultat = produits − charges.</p>
  </>;
}
