import type { ReactNode } from "react";

// Éléments de présentation communs aux écrans Données, Paramètres, Membres et Reporting social.
// Aucun accès aux données : utilisables côté serveur comme côté client.

export type Crumb = { label: string; href?: string };

// En-tête de page : fil d'Ariane (ou rubrique), titre, texte d'introduction.
export function PageHead({ kicker, title, crumbs, children }: { kicker?: string; title: ReactNode; crumbs?: Crumb[]; children?: ReactNode }) {
  return (
    <header className="dn-head">
      {crumbs && crumbs.length > 0 ? (
        <nav className="dn-crumbs" aria-label="Chemin de la page">
          {crumbs.map((c, i) => (
            <span key={`${i}-${c.label}`} className="dn-crumb">
              {i > 0 && <span aria-hidden="true">/</span>}
              {c.href ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      ) : kicker ? (
        <span className="label">{kicker}</span>
      ) : null}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

// Pastille d'état (le libellé porte l'information, la teinte la renforce).
export type Tone = "applied" | "preview" | "running" | "failed" | "neutral";

export function syncTone(status: string): Tone {
  return status === "applied" ? "applied" : status === "preview" ? "preview" : status === "running" ? "running" : status === "failed" ? "failed" : "neutral";
}

export function Pill({ tone = "neutral", testid, children }: { tone?: Tone; testid?: string; children: ReactNode }) {
  return (
    <span className={`status-pill ${tone}`} data-testid={testid}>
      {children}
    </span>
  );
}

// Zone vide : on dit ce qui manque, jamais un zéro.
export function Empty({ testid, children }: { testid?: string; children: ReactNode }) {
  return (
    <p className="dn-empty" data-testid={testid}>
      {children}
    </p>
  );
}

export const sizeFmt = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);

// Nombre de mois d'une période AAAA-MM → AAAA-MM (bornes incluses) ; null si une borne manque ou si la période est inversée.
export function monthCount(from: string, to: string): number | null {
  const re = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const a = re.exec(from);
  const b = re.exec(to);
  if (!a || !b) return null;
  const n = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) + 1;
  return n >= 1 ? n : null;
}

// Recherche sans accents ni casse (filtres de tableaux).
export const foldText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
