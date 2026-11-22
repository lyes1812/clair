import { z } from "zod/v4";
import { BANK_CATEGORIES } from "@/lib/bank/categories";

// Gabarit versionné (cahier des charges, section 8) : toute modification crée une nouvelle version (categorize-v2…),
// jamais une réécriture de celle-ci, pour que le journal des appels reste lisible.
export const CATEGORIZE_PROMPT_VERSION = "categorize-v1";

export const CATEGORIZE_SYSTEM = [
  "Tu classes des flux bancaires d'une entreprise française dans une liste fermée de catégories de trésorerie.",
  "Chaque flux est donné par son index, son libellé normalisé (pseudonymisé : PERSONNE_n désigne une personne physique),",
  "son sens (encaissement ou décaissement), son montant arrondi à l'euro et sa contrepartie si elle est connue.",
  "Règles : n'utilise que les identifiants de catégorie fournis ; une catégorie d'encaissement ne s'applique qu'à un",
  "encaissement et une catégorie de décaissement qu'à un décaissement ; « internal » désigne un virement entre comptes de",
  "la même entreprise. Si le libellé ne permet pas de trancher, choisis la catégorie « autres » du bon sens avec une",
  "confiance basse. La confiance va de 0 à 1. Le motif tient en une phrase courte, en français, sans montant.",
  "Réponds pour chaque index reçu, une seule fois.",
].join(" ");

export type CategorizeInput = { i: number; libelle: string; sens: "encaissement" | "decaissement"; montant_arrondi: number; contrepartie: string | null };

export function categorizeUserMessage(flows: CategorizeInput[]): string {
  const categories = BANK_CATEGORIES.map((c) => ({ id: c.id, libelle: c.label, sens: c.direction === "in" ? "encaissement" : c.direction === "out" ? "decaissement" : "les deux" }));
  return JSON.stringify({ categories, flux: flows });
}

export const CategorizeOutput = z.object({
  resultats: z.array(z.object({
    i: z.number().int(),
    categorie: z.enum(BANK_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
    confiance: z.number(),
    motif: z.string(),
  })),
});
export type CategorizeOutputT = z.infer<typeof CategorizeOutput>;
