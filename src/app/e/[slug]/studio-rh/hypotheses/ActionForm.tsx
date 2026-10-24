"use client";
import { useActionState, useEffect, useRef } from "react";
import { frDates } from "@/lib/viz/hyp-saisie-fmt";
import type { FormState } from "./actions";

// Champs saisis, relus à l'envoi : React remet le formulaire à zéro à la fin de toute action, y compris refusée.
type Kept = { name: string; value: string; checked: boolean };
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const controls = (form: HTMLFormElement): Control[] =>
  [...form.elements].filter((el): el is Control => (el instanceof HTMLInputElement && !["hidden", "submit", "button", "reset", "file"].includes(el.type)) || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement);
const snapshot = (form: HTMLFormElement): Kept[] => controls(form).map((el) => ({ name: el.name, value: el.value, checked: el instanceof HTMLInputElement && el.checked }));
function restore(form: HTMLFormElement, kept: Kept[]) {
  const now = controls(form);
  if (now.length !== kept.length) return;
  now.forEach((el, i) => {
    if (el.name !== kept[i].name) return;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = kept[i].checked;
    else el.value = kept[i].value;
  });
  form.dispatchEvent(new Event("input", { bubbles: true })); // les indicateurs du formulaire se relisent
}

// Formulaire branché sur une action serveur (liée côté serveur au slug et au scénario) : message d'erreur ou de
// confirmation renvoyé par l'action, affiché au-dessus du bouton, bouton désactivé pendant l'envoi.
// Une action refusée rend le message avec sa raison et conserve la saisie (rien n'est à retaper).
// `footer` : élément affiché à côté du bouton (ex. compteur de modifications) ; `confirm` : question posée avant l'envoi
// (actions irréversibles) ; `plain` : bouton secondaire (contour) plutôt que bouton principal ; `compact` : bouton de ligne de
// tableau ; `srLabel` : suite du nom du bouton réservée aux lecteurs d'écran (« Supprimer » + l'objet supprimé), pour que les
// boutons répétés d'un tableau se distinguent. Les dates des messages sont écrites en français (jj/mm/aaaa, « novembre 2026 »).
export function ActionForm({
  action, submit, testid, children, className, danger, footer, confirm, plain, compact, hint, srLabel,
}: { action: (prev: FormState, f: FormData) => Promise<FormState>; submit: string; testid: string; children?: React.ReactNode; className?: string; danger?: boolean; footer?: React.ReactNode; confirm?: string; plain?: boolean; compact?: boolean; hint?: string; srLabel?: string }) {
  const [state, run, pending] = useActionState(action, undefined);
  const form = useRef<HTMLFormElement>(null);
  const kept = useRef<Kept[] | null>(null);
  const message = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state?.error) return;
    if (form.current && kept.current) restore(form.current, kept.current);
    message.current?.scrollIntoView?.({ block: "nearest" });
  }, [state]);

  return (
    <form
      ref={form}
      className={className ?? "form"}
      action={run}
      data-testid={testid}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        kept.current = snapshot(e.currentTarget);
      }}
    >
      {children}
      {(state?.error || state?.ok || state?.details) && (
        <div className="form-msg" ref={message}>
          {state?.error && <p className="error" role="alert">{frDates(state.error)}</p>}
          {state?.ok && <p className="notice" role="status">{frDates(state.ok)}</p>}
          {state?.details && <ul className="list" data-testid={`${testid}-details`}>{state.details.map((d) => <li key={d} className="desc">{frDates(d)}</li>)}</ul>}
        </div>
      )}
      <div className="actions">
        <button className={`${danger ? "btn danger" : plain ? "btn" : "btn primary"}${compact ? " hs-compact" : ""}`} type="submit" disabled={pending} title={hint}>{pending ? "Enregistrement…" : submit}{srLabel && !pending ? <span className="sr-only"> {srLabel}</span> : null}</button>
        {footer}
      </div>
    </form>
  );
}
