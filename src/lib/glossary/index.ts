import { GLOSSARY_BUDGET } from "./budget";
import { GLOSSARY_CROISEE } from "./croisee";
import { GLOSSARY_DONNEES } from "./donnees";
import { GLOSSARY_ECART } from "./ecart";
import { GLOSSARY_ECRAN } from "./ecran";
import { GLOSSARY_HYPOTHESES } from "./hypotheses";
import { GLOSSARY_KPI } from "./kpi";
import { GLOSSARY_MASSE } from "./masse";
import { GLOSSARY_RH } from "./rh";
import { GLOSSARY_FAMILIES, type GlossaryEntry, type GlossaryFamily } from "./types";

export { GLOSSARY_FAMILIES, type GlossaryEntry, type GlossaryFamily } from "./types";

// Toutes les entrées du glossaire, dans l'ordre des familles puis par terme. Les identifiants sont uniques (test).
export const GLOSSARY: GlossaryEntry[] = [...GLOSSARY_ECRAN, ...GLOSSARY_RH, ...GLOSSARY_KPI, ...GLOSSARY_MASSE, ...GLOSSARY_CROISEE, ...GLOSSARY_BUDGET, ...GLOSSARY_HYPOTHESES, ...GLOSSARY_ECART, ...GLOSSARY_DONNEES].sort(
  (a, b) => GLOSSARY_FAMILIES.indexOf(a.family) - GLOSSARY_FAMILIES.indexOf(b.family) || a.term.localeCompare(b.term, "fr"),
);
export const glossaryEntry = (id: string): GlossaryEntry | undefined => GLOSSARY.find((e) => e.id === id);
export const glossaryHref = (slug: string, id: string) => `/e/${slug}/glossaire#def-${id}`;

// --- Recherche et présentation de la page Glossaire -------------------------------------------------------------------------

// Texte comparable : sans accents ni casse, apostrophes et espaces (insécables comprises) ramenées à la forme simple.
export const foldText = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\u0153/g, "oe")
    .replace(/\u00e6/g, "ae")
    .replace(/\s+/g, " ")
    .trim();

export const QUERY_MAX = 100;

// Paramètre d'adresse « q » : première valeur, espaces réduits, longueur bornée. Tout ce qui n'est pas un texte donne « ».
export function normalizeQuery(raw: unknown): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === "string" ? first.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX) : "";
}

// Filtre sur le terme et la définition : chaque mot de la recherche doit s'y trouver (dans n'importe quel ordre). Recherche vide : tout.
export function searchGlossary(query: string, entries: GlossaryEntry[] = GLOSSARY): GlossaryEntry[] {
  const words = foldText(query).split(" ").filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((e) => {
    const haystack = foldText(`${e.term} ${e.definition}`);
    return words.every((w) => haystack.includes(w));
  });
}

// Entrées groupées par famille, dans l'ordre des familles ; une famille sans entrée n'apparaît pas.
export function groupByFamily(entries: GlossaryEntry[]): { family: GlossaryFamily; entries: GlossaryEntry[] }[] {
  return GLOSSARY_FAMILIES.map((family) => ({ family, entries: entries.filter((e) => e.family === family) })).filter((g) => g.entries.length > 0);
}

// Ancre d'une famille : « Lecture des écrans » → « famille-lecture-des-ecrans ».
export const familyAnchor = (family: string): string => `famille-${foldText(family).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

// Paragraphes d'une définition (séparés par une ligne vide).
export const definitionParagraphs = (definition: string): string[] =>
  definition
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
