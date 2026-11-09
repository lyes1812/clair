"use client";

import { useId, useState } from "react";
import { ActionForm } from "../../studio-rh/hypotheses/ActionForm";
import type { EntityKind, Link } from "@/lib/reconciliation/types";

export type ReconciliationAction = Parameters<typeof ActionForm>[0]["action"];
export type ControlIdentity = { runId: string; revision: number; inputHash: string };
export type LinkChoice = { id: string; label: string; parentId: string | null };

export function ControlFields({ control }: { control: ControlIdentity }) {
  return <><input type="hidden" name="runId" value={control.runId} /><input type="hidden" name="revision" value={control.revision} /><input type="hidden" name="inputHash" value={control.inputHash} /></>;
}

/** Deux choix manuels vides. Le serveur vérifie à nouveau la paire et calcule son empreinte. */
export function LinkForm({ entity, dsn, payfit, parents, control, action }: { entity: EntityKind; dsn: LinkChoice[]; payfit: LinkChoice[]; parents: Link[]; control: ControlIdentity; action: ReconciliationAction }) {
  const uid = useId();
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const dsnChoices = entity === "person" ? dsn : dsn.filter((choice) => parents.some((pair) => pair.dsnId === choice.parentId));
  const selected = dsnChoices.find((choice) => choice.id === left);
  const rightParent = entity === "contract" ? parents.find((pair) => pair.dsnId === selected?.parentId)?.payfitId : null;
  const payfitChoices = entity === "person" ? payfit : payfit.filter((choice) => choice.parentId === rightParent);
  if (!dsnChoices.length || !payfit.length) return <p className="desc rec-link-empty">{entity === "contract" && !parents.length ? "Lie d’abord les personnes correspondantes." : "Aucune paire disponible à relier."}</p>;
  return (
    <ActionForm action={action} submit={entity === "person" ? "Lier les personnes" : "Lier les contrats"} testid={`rec-link-${entity}`} className="rec-link-form">
      <ControlFields control={control} />
      <input type="hidden" name="kind" value={`link-${entity}`} />
      <div className="field-row"><label htmlFor={`${uid}-dsn`}>Ligne DSN</label><select className="select" id={`${uid}-dsn`} name="dsnId" value={left} required onChange={(event) => { setLeft(event.target.value); setRight(""); }}>
        <option value="">Choisir une ligne DSN</option>{dsnChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
      </select></div>
      <div className="field-row"><label htmlFor={`${uid}-payfit`}>Ligne PayFit</label><select className="select" id={`${uid}-payfit`} name="payfitId" value={right} required disabled={!left} onChange={(event) => setRight(event.target.value)}>
        <option value="">{!left ? "Choisir d’abord la ligne DSN" : payfitChoices.length ? "Choisir une ligne PayFit" : "Aucun contrat de la personne liée"}</option>{payfitChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
      </select></div>
    </ActionForm>
  );
}
