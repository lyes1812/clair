import { GLOSSARY_BUDGET } from "./budget";
import { GLOSSARY_DONNEES } from "./donnees";
import { GLOSSARY_ECART } from "./ecart";
import { GLOSSARY_ECRAN } from "./ecran";
import { GLOSSARY_HYPOTHESES } from "./hypotheses";
import { GLOSSARY_KPI } from "./kpi";
import { GLOSSARY_MASSE } from "./masse";
import { GLOSSARY_RH } from "./rh";
import { GLOSSARY_FAMILIES, type GlossaryEntry } from "./types";

export { GLOSSARY_FAMILIES, type GlossaryEntry, type GlossaryFamily } from "./types";

// Toutes les entrées du glossaire, dans l'ordre des familles puis par terme. Les identifiants sont uniques (test).
export const GLOSSARY: GlossaryEntry[] = [...GLOSSARY_ECRAN, ...GLOSSARY_RH, ...GLOSSARY_KPI, ...GLOSSARY_MASSE, ...GLOSSARY_BUDGET, ...GLOSSARY_HYPOTHESES, ...GLOSSARY_ECART, ...GLOSSARY_DONNEES].sort(
  (a, b) => GLOSSARY_FAMILIES.indexOf(a.family) - GLOSSARY_FAMILIES.indexOf(b.family) || a.term.localeCompare(b.term, "fr"),
);
export const glossaryEntry = (id: string): GlossaryEntry | undefined => GLOSSARY.find((e) => e.id === id);
export const glossaryHref = (slug: string, id: string) => `/e/${slug}/glossaire#def-${id}`;
