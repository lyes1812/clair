"use client";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ViewSwitch } from "@/components/ViewSwitch";

// La rubrique du graphique se change sans recharger la page et se reporte dans l'adresse. Ces éléments relisent l'adresse
// courante pour que les liens (affichage, détail par salarié) et les formulaires de la page gardent la rubrique choisie ; sans
// adresse lisible, ils gardent la valeur du rendu serveur.
const useRub = (initial: string) => useSearchParams()?.get("rub") || initial;

function withRub(href: string, rub: string): string {
  try {
    const u = new URL(href, "http://clair.local");
    u.searchParams.set("rub", rub);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return href;
  }
}

// La rubrique vient parfois d'être changée sans rechargement : relire l'adresse au moment du choix évite une ancienne valeur.
export function liveViewHref(href: string, initialRub: string, currentHref?: string): string {
  let rub = initialRub;
  try {
    if (currentHref) rub = new URL(currentHref, "http://clair.local").searchParams.get("rub") || initialRub;
  } catch { /* Aperçu sans adresse lisible : garder la rubrique connue. */ }
  return withRub(href, rub);
}

export function RubInput({ initial }: { initial: string }) {
  const rub = useRub(initial);
  return <input type="hidden" name="rub" value={rub} />;
}

export function LiveViewSwitch({ initialRub, options, ...rest }: { initialRub: string } & Parameters<typeof ViewSwitch>[0]) {
  const rub = useRub(initialRub);
  return <ViewSwitch {...rest} options={options.map((o) => ({ ...o, href: withRub(o.href, rub) }))}
    resolveHref={(href) => liveViewHref(href, rub, window.location.href)} />;
}

// Lien interne qui garde la rubrique choisie (détail par salarié d'un écart).
export function LiveLink({ initialRub, href, title, label, children }: { initialRub: string; href: string; title?: string; label?: string; children: ReactNode }) {
  const rub = useRub(initialRub);
  return <a href={withRub(href, rub)} title={title} aria-label={label}>{children}</a>;
}
