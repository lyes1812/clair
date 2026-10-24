import { BUDGET_DEFINITIONS } from "@/lib/budget/definitions";
import type { GlossaryEntry } from "./types";

// Définitions déjà écrites dans l'application, reprises telles quelles.
export const GLOSSARY_BUDGET: GlossaryEntry[] = BUDGET_DEFINITIONS.map((d) => ({ id: d.id, term: d.title, family: "Hypothèses budgétaires", definition: d.text }));
