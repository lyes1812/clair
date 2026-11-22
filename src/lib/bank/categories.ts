import { normalizeLabel } from "./model";

// Cap 13, lot L4 : catégorisation des flux bancaires (cahier des charges, sections 7 et 8). Fonctions pures.
// Ordre d'application : décision saisie sur le flux ; règle apprise sur le tiers (une correction humaine s'applique à
// tous ses flux) ; règle du référentiel (motif de libellé) ; proposition de l'IA sur le résidu. Un flux sans catégorie
// reste « à catégoriser » : aucune catégorie n'est supposée.

export const BANK_CATEGORIES = [
  { id: "customers", label: "Encaissements clients", direction: "in" },
  { id: "other_in", label: "Autres encaissements", direction: "in" },
  { id: "payroll", label: "Salaires nets", direction: "out" },
  { id: "social", label: "Charges sociales", direction: "out" },
  { id: "tax", label: "Impôts et TVA", direction: "out" },
  { id: "suppliers", label: "Fournisseurs d’exploitation", direction: "out" },
  { id: "rent", label: "Loyers", direction: "out" },
  { id: "loans", label: "Échéances d’emprunt", direction: "out" },
  { id: "bank_fees", label: "Frais bancaires", direction: "out" },
  { id: "capex", label: "Investissements", direction: "out" },
  { id: "other_out", label: "Autres décaissements", direction: "out" },
  { id: "internal", label: "Flux internes (neutralisés)", direction: "both" },
] as const;
export type BankCategoryId = typeof BANK_CATEGORIES[number]["id"];
export type FlowDirection = "in" | "out";
const CATEGORY_IDS = new Set<string>(BANK_CATEGORIES.map((c) => c.id));
export const isBankCategory = (v: unknown): v is BankCategoryId => typeof v === "string" && CATEGORY_IDS.has(v);
export const categoryLabel = (id: BankCategoryId | null) => BANK_CATEGORIES.find((c) => c.id === id)?.label ?? null;
/** Une catégorie n'est admise que dans son sens (un encaissement client n'est jamais un débit). */
export const fitsDirection = (id: BankCategoryId, direction: FlowDirection) => {
  const d = BANK_CATEGORIES.find((c) => c.id === id)!.direction;
  return d === "both" || d === direction;
};

/** Référentiel V1 : motifs sur le libellé normalisé (majuscules, sans accents). Premier motif trouvé. */
export const REFERENTIAL_RULES: { id: string; category: BankCategoryId; pattern: RegExp }[] = [
  { id: "interne", category: "internal", pattern: /\b(VIR(EMENT)? INTERNE|COMPTE A COMPTE|CPTE A CPTE|ENTRE (NOS |MES )?COMPTES|VIREMENT DE TRESORERIE)\b/ },
  { id: "emprunt", category: "loans", pattern: /\b(ECH(EANCE)? (DE )?(PRET|CREDIT|EMPRUNT)|REMB(OURSEMENT)? (DE )?(PRET|EMPRUNT)|PRET (PGE|BPI|IMMOBILIER|PROFESSIONNEL)|CREDIT BAIL|LEASING)\b/ },
  { id: "frais", category: "bank_fees", pattern: /\b(FRAIS (BANCAIRES|DE TENUE|TENUE|SUR|VIREMENT|PRELEVEMENT|REJET|D INTERVENTION)|COMMISSION(S)? (D )?(INTERVENTION|MOUVEMENT|DE COMPTE)|COM(MISSION)? INTERVENTION|COTIS(ATION)? CARTE|AGIOS|INTERETS DEBITEURS|ABONNEMENT (BANQUE|BANCAIRE|OFFRE)|TENUE DE COMPTE)\b/ },
  { id: "social", category: "social", pattern: /\b(URSSAF|AGIRC|ARRCO|MALAKOFF|HUMANIS|AG2R|KLESIA|APICIL|HUMANIS|PREVOYANCE|MUTUELLE|CAISSE DE RETRAITE|RETRAITE COMPLEMENTAIRE|POLE EMPLOI|FRANCE TRAVAIL|MSA|CIPAV)\b/ },
  { id: "fiscal", category: "tax", pattern: /\b(DGFIP|DGI|IMPOTS?|TRESOR PUBLIC|TVA|SIE|CFE|CVAE|TAXE (FONCIERE|SUR LES SALAIRES|D APPRENTISSAGE)|DIRECTION GENERALE DES FINANCES)\b/ },
  { id: "salaire", category: "payroll", pattern: /\b(SALAIRES?|PAIE|ACOMPTE SUR SALAIRE|NET A PAYER|VIR(EMENT)? SAL)\b/ },
  { id: "loyer", category: "rent", pattern: /\b(LOYERS?|CHARGES LOCATIVES|QUITTANCE)\b/ },
  { id: "energie-telecom-assurance", category: "suppliers", pattern: /\b(EDF|ENGIE|TOTALENERGIES|TOTAL ENERGIES|VEOLIA|SUEZ|ORANGE|SFR|BOUYGUES TELECOM|FREE PRO|ASSURANCES?|AXA|ALLIANZ|MAAF|MACIF|GROUPAMA|GENERALI|HISCOX)\b/ },
  { id: "encaissement-cb-cheque", category: "customers", pattern: /\b(REMISE (CB|CARTE|CHEQUES?|CHQ)|REM (CB|CHQ)|ENCAISSEMENT (CB|CARTE)|STRIPE|SUMUP|PAYPLUG|LYDIA PRO)\b/ },
  { id: "aides", category: "other_in", pattern: /\b(SUBVENTION|AIDE (DE L ETAT|REGIONALE|EXCEPTIONNELLE)|ASP|INDEMNISATION|REMBOURSEMENT (CREDIT )?TVA|CREDIT D IMPOT)\b/ },
];

export function ruleFor(label: string, direction: FlowDirection): { id: string; category: BankCategoryId } | null {
  const l = normalizeLabel(label);
  for (const r of REFERENTIAL_RULES) if (fitsDirection(r.category, direction) && r.pattern.test(l)) return { id: r.id, category: r.category };
  return null;
}

// Mots d'opération sans valeur pour identifier le tiers (virement, prélèvement, carte…).
const NOISE = new Set("VIR VIREMENT VIRT SEPA PRLV PRELEVEMENT PRELEVT CB CARTE RECU RECUE EMIS EMISE DE DU DES LA LE LES A AU AUX POUR PAR INST INSTANTANE CHQ CHEQUE REMISE FACTURE FACT FAC REF MOTIF ECH ECHEANCE PAIEMENT ACHAT RETRAIT DAB WEB INTERNET SA SAS SARL EURL SASU SCI ET".split(" "));

/**
 * Tiers d'un flux, clé des règles apprises : la contrepartie lue dans le relevé si elle existe, sinon les trois premiers mots
 * significatifs du libellé (mots d'opération et références chiffrées retirés). null si rien d'exploitable.
 */
export function tierOf(m: { label: string; counterparty: string | null }): string | null {
  const source = m.counterparty && normalizeLabel(m.counterparty) ? m.counterparty : m.label;
  const words = normalizeLabel(source).split(" ").filter((w) => w.length > 2 && !/\d/.test(w) && !NOISE.has(w));
  return words.length ? words.slice(0, 3).join(" ") : null;
}

export type CategorizedFlow = {
  key: string; date: string; amountCents: number; label: string; counterparty: string | null;
  direction: FlowDirection; tier: string | null;
  category: BankCategoryId | null;
  source: "saisie" | "apprise" | "regle" | "ia" | null;
  /** Règle du référentiel appliquée, ou motif donné par l'IA. */
  reason: string | null;
  confidence: number | null;
  review: boolean;
  reviewReason: string | null;
};
export type AiProposal = { category: BankCategoryId; confidence: number; reason: string; promptVersion: string };
export type CategorizationState = {
  /** Catégorie saisie ou validée pour un flux (clé du mouvement). */
  decisions: Record<string, BankCategoryId>;
  /** Catégorie apprise pour un tiers : s'applique à tous ses flux du même sens. */
  learned: Record<string, BankCategoryId>;
  ai: Record<string, AiProposal>;
};
export const REVIEW_CONFIDENCE = 0.8;
export const REVIEW_SHARE_PERMILLE = 50; // 5 % du décaissement mensuel moyen

/** Décaissement mensuel moyen, en centimes : total des débits / nombre de mois civils couverts par les flux. */
export function monthlyOutflow(flows: { date: string; amountCents: number }[]): number | null {
  if (!flows.length) return null;
  const months = new Set(flows.map((f) => f.date.slice(0, 7))).size;
  const out = flows.reduce((t, f) => t + (f.amountCents < 0 ? -f.amountCents : 0), 0);
  return Math.round(out / months);
}

type Movement = { key: string; bookingDate: string; amountCents: number; label: string; counterparty: string | null };
export function categorize(movements: Movement[], state: CategorizationState): CategorizedFlow[] {
  const mean = monthlyOutflow(movements.map((m) => ({ date: m.bookingDate, amountCents: m.amountCents })));
  const big = (cents: number) => mean !== null && Math.abs(cents) * 1000 > mean * REVIEW_SHARE_PERMILLE;
  return movements.map((m) => {
    const direction: FlowDirection = m.amountCents < 0 ? "out" : "in";
    const tier = tierOf(m);
    const base = { key: m.key, date: m.bookingDate, amountCents: m.amountCents, label: m.label, counterparty: m.counterparty, direction, tier };
    const decided = state.decisions[m.key];
    if (decided && fitsDirection(decided, direction)) return { ...base, category: decided, source: "saisie", reason: null, confidence: null, review: false, reviewReason: null };
    const learned = tier ? state.learned[tier] : undefined;
    if (learned && fitsDirection(learned, direction)) return { ...base, category: learned, source: "apprise", reason: `Tiers « ${tier} »`, confidence: null, review: false, reviewReason: null };
    const rule = ruleFor(m.label, direction);
    if (rule) return { ...base, category: rule.category, source: "regle", reason: `Règle « ${rule.id} »`, confidence: null, review: false, reviewReason: null };
    const ai = state.ai[m.key];
    if (ai && fitsDirection(ai.category, direction)) {
      const low = ai.confidence < REVIEW_CONFIDENCE;
      const large = big(m.amountCents);
      return {
        ...base, category: ai.category, source: "ia", reason: ai.reason, confidence: ai.confidence, review: low || large,
        reviewReason: low ? `Confiance ${Math.round(ai.confidence * 100)} % (< 80 %)` : large ? "Montant > 5 % du décaissement mensuel moyen" : null,
      };
    }
    return { ...base, category: null, source: null, reason: null, confidence: null, review: true, reviewReason: "À catégoriser" };
  });
}

export function categorizationStats(flows: CategorizedFlow[]) {
  const count = (s: CategorizedFlow["source"]) => flows.filter((f) => f.source === s).length;
  const byRules = count("regle") + count("apprise");
  return {
    total: flows.length, saisie: count("saisie"), apprise: count("apprise"), regle: count("regle"), ia: count("ia"), none: count(null),
    review: flows.filter((f) => f.review).length,
    /** Part des flux classés par règles (référentiel + apprises), en pour mille ; null sans flux. */
    rulesPermille: flows.length ? Math.round((byRules * 1000) / flows.length) : null,
  };
}

// --- Saisies : lecture stricte de la valeur enregistrée (une valeur inconnue rend l'ensemble illisible).
export const CATEGORIZATION_KEY = "bank.categorization";
export type CategorizationSettings = CategorizationState & { noAi: boolean };
export const emptyCategorization = (): CategorizationSettings => ({ decisions: {}, learned: {}, ai: {}, noAi: false });

export function parseCategorization(value: unknown): CategorizationSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const map = (raw: unknown): Record<string, BankCategoryId> | null => {
    if (raw === undefined) return {};
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out: Record<string, BankCategoryId> = {};
    for (const [k, c] of Object.entries(raw)) { if (!isBankCategory(c) || !k) return null; out[k] = c; }
    return out;
  };
  const decisions = map(v.decisions);
  const learned = map(v.learned);
  if (!decisions || !learned) return null;
  const ai: Record<string, AiProposal> = {};
  if (v.ai !== undefined) {
    if (v.ai === null || typeof v.ai !== "object" || Array.isArray(v.ai)) return null;
    for (const [k, raw] of Object.entries(v.ai as Record<string, unknown>)) {
      const p = raw as Record<string, unknown> | null;
      if (!p || typeof p !== "object" || !isBankCategory(p.category) || typeof p.confidence !== "number" || p.confidence < 0 || p.confidence > 1 || typeof p.reason !== "string" || typeof p.promptVersion !== "string") return null;
      ai[k] = { category: p.category, confidence: p.confidence, reason: p.reason, promptVersion: p.promptVersion };
    }
  }
  if (v.noAi !== undefined && typeof v.noAi !== "boolean") return null;
  return { decisions, learned, ai, noAi: v.noAi === true };
}
