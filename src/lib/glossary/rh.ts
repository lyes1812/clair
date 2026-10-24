import { RH_DEFINITIONS } from "@/lib/rh/definitions";
import type { GlossaryEntry } from "./types";

// Définitions déjà écrites dans l'application, reprises telles quelles.
export const GLOSSARY_RH: GlossaryEntry[] = RH_DEFINITIONS.map((d) => ({ id: d.id, term: d.title, family: "Collaborateurs", definition: d.text }));
