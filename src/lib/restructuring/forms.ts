import type { Amount, Hypothesis } from "@/lib/budget/types";
import { isIsoDate } from "@/lib/dates";
import { toCents } from "@/lib/money";

export const EXIT_MOTIFS = ["Licenciement", "Rupture conventionnelle", "Autre départ"] as const;
type Departure = Extract<Hypothesis, { kind: "depart" }>;
const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const MAX_MONTH_CENTS = 100_000_000_000_000;
function amount(form: FormData): Amount {
  const mode = text(form, "exitMode");
  const cents = toCents(text(form, mode === "charge" ? "exitCout" : "exitBrut"));
  if (mode !== "charge" && mode !== "brut") throw new Error("Choisis le mode de saisie du coût de sortie.");
  if (cents === null || cents < 0 || cents > MAX_MONTH_CENTS) throw new Error("Coût de sortie positif ou nul requis, en euros. Saisis 0 pour un coût nul confirmé.");
  if (mode === "charge") return { mode, costCents: cents };
  const chargesBps = toCents(text(form, "exitTaux"));
  if (chargesBps === null || chargesBps < 0 || chargesBps > 100_000) throw new Error("Taux de charges explicite requis, de 0 à 1 000 % ; aucune exonération n’est supposée.");
  return { mode, brutCents: cents, chargesBps };
}

/** Saisie d’un coût convenu par l’utilisateur ; aucune règle d’indemnité légale ou conventionnelle. */
export function exitFromForm(form: FormData, id: string, previous?: Departure): Departure {
  const motif = text(form, "motif");
  if (!EXIT_MOTIFS.some((value) => value === motif) && !(previous?.motif && motif === previous.motif)) throw new Error("Choisis Licenciement, Rupture conventionnelle ou Autre départ.");
  const lastPaidDate = text(form, "lastPaidDate");
  if (!isIsoDate(lastPaidDate)) throw new Error("Dernier jour payé requis : une date valide est nécessaire.");
  const contractKey = previous?.contractKey ?? text(form, "contractKey");
  if (!contractKey || contractKey.length > 300) throw new Error("Choisis le contrat concerné.");
  return { ...previous, id: previous?.id ?? id, kind: "depart", label: previous?.label ?? motif, contractKey, motif, lastPaidDate, exitCost: amount(form) };
}
