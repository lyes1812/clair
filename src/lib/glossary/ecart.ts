import { ECART_DEFINITIONS } from "@/lib/budget/ecart-definitions";
import type { GlossaryEntry } from "./types";

// Définitions déjà écrites dans l'application, reprises telles quelles.
export const GLOSSARY_ECART: GlossaryEntry[] = ECART_DEFINITIONS.map((d) => ({ id: d.id, term: d.title, family: "Écarts", definition: d.text }));
