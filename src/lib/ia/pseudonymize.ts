import { normalizeLabel } from "@/lib/bank/model";

// Pseudonymisation avant tout envoi au modèle (cahier des charges, section 8) : les noms de personnes physiques connues de
// l'espace (salariés, associés, cautions) et ceux qui suivent une civilité sont remplacés par des jetons PERSONNE_n ; IBAN,
// adresses électroniques et références chiffrées (4 chiffres et plus) sont retirés. La table de correspondance reste côté
// Clair : elle n'est jamais envoyée et ne sert qu'au contrôle.

export type Pseudonymizer = { apply: (text: string) => string; table: Map<string, string>; leaks: (text: string) => string[] };

const TITLE = /\b(?:M|MR|MME|MLLE|MONSIEUR|MADAME|MADEMOISELLE|DR|ME)\s+(?!PERSONNE_)([A-Z]+(?:\s(?!PERSONNE_)[A-Z]+)?)\b/g;

export function createPseudonymizer(personNames: string[]): Pseudonymizer {
  // Noms normalisés comme les libellés ; un nom de 2 lettres ou moins est ignoré (trop de faux positifs, aucun nom réel visé).
  const names = [...new Set(personNames.map((n) => normalizeLabel(n)).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  const table = new Map<string, string>();
  const token = (name: string) => {
    let t = table.get(name);
    if (!t) { t = `PERSONNE_${table.size + 1}`; table.set(name, t); }
    return t;
  };
  const patterns = names.map((n) => ({ n, re: new RegExp(`\\b${n.replace(/ /g, "\\s+")}\\b`, "g") }));

  const apply = (text: string) => {
    let s = text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
      .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/gi, " ");
    s = normalizeLabel(s);
    for (const { n, re } of patterns) s = s.replace(re, () => token(n));
    s = s.replace(TITLE, (_m, who: string) => `${token(who.trim())} `);
    // Références : tout mot contenant au moins 4 chiffres (numéros de mandat, de facture, de compte, téléphone).
    s = s.split(" ").filter((w) => (w.match(/\d/g)?.length ?? 0) < 4 || /^PERSONNE_\d+$/.test(w)).join(" ");
    return s.replace(/\s+/g, " ").trim();
  };
  /** Noms connus encore présents dans un texte pseudonymisé (doit rester vide). */
  const leaks = (text: string) => {
    const t = normalizeLabel(text);
    return names.filter((n) => new RegExp(`\\b${n.replace(/ /g, "\\s+")}\\b`).test(t));
  };
  return { apply, table, leaks };
}
