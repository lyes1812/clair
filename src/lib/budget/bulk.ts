import { hireKey, roundDiv } from "./engine";
import type { BaseSnapshot, CategoryId, Hypothesis, HypothesisKind } from "./types";

// Lot 4 : saisies groupées. Fonctions pures (les identifiants sont fournis par l'appelant) ; le moteur contrôle ensuite
// chaque hypothèse avant enregistrement (store.addHypotheses).

export const MAX_POSTS = 50;
type Hire = Extract<Hypothesis, { kind: "embauche" }>;

// Nombre de postes : une même fiche d'embauche donne N hypothèses indépendantes, numérotées « (i/N) », chacune
// modifiable ou supprimable seule. Un remplacement vise un départ précis : un seul poste.
export function expandHires(h: Hire, count: number, newId: () => string): Hire[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_POSTS) throw new Error(`Nombre de postes entre 1 et ${MAX_POSTS}.`);
  if (count === 1) return [h];
  if (h.replaces) throw new Error("Un remplacement concerne un seul poste : nombre de postes = 1.");
  return Array.from({ length: count }, (_, i) => ({ ...h, id: i === 0 ? h.id : newId(), label: `${h.label} (${i + 1}/${count})` }));
}

// Ordre d'enregistrement d'une reprise : un lien pointe toujours vers une hypothèse déjà enregistrée (le départ avant
// l'embauche qui le remplace, l'embauche avant l'augmentation qui la vise).
const ORDER: HypothesisKind[] = ["depart", "embauche", "augmentation", "absence", "categorie", "base", "ponctuel", "realise"];
export const IMPORTABLE_KINDS = ORDER;

export type ImportPlan = { items: Hypothesis[]; dropped: { label: string; reason: string }[] };

// Reprise des hypothèses d'un autre scénario : nouveaux identifiants, liens remplacés. Un lien vers une hypothèse non
// reprise est refusé (augmentation, congé, catégorie, base ou prime d'une embauche non reprise) ou, pour le lien
// documentaire « remplace », retiré. Les dates et contrats sont ensuite contrôlés par le moteur contre le scénario cible.
export function planImport(src: Hypothesis[], kinds: ReadonlySet<HypothesisKind>, newId: () => string): ImportPlan {
  const picked = src.filter((h) => kinds.has(h.kind)).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const ids = new Map(picked.map((h) => [h.id, newId()]));
  const dropped: ImportPlan["dropped"] = [];
  const items: Hypothesis[] = [];
  // Clé d'un salarié reprise : un contrat de la base garde sa clé, une embauche prend celle de sa copie (si reprise).
  const keyOf = (key: string): string | null => {
    if (!key.startsWith("embauche:")) return key;
    const to = ids.get(key.slice(9));
    return to ? hireKey(to) : null;
  };
  const gone = (h: Hypothesis) => dropped.push({ label: h.label, reason: "l'embauche visée n'est pas reprise" });
  for (const h of picked) {
    const id = ids.get(h.id)!;
    if (h.kind === "embauche") {
      items.push({ ...h, id, replaces: h.replaces ? ids.get(h.replaces) ?? null : null });
    } else if (h.kind === "augmentation" && h.scope.kind === "contrat") {
      const k = keyOf(h.scope.key);
      if (k === null) gone(h);
      else items.push({ ...h, id, scope: { kind: "contrat", key: k } });
    } else if (h.kind === "ponctuel" && h.contractKey) {
      const k = keyOf(h.contractKey);
      if (k === null) gone(h);
      else items.push({ ...h, id, contractKey: k });
    } else if (h.kind === "absence" || h.kind === "categorie" || h.kind === "base" || h.kind === "depart") {
      const k = keyOf(h.contractKey);
      if (k === null) gone(h);
      else items.push({ ...h, id, contractKey: k });
    } else {
      items.push({ ...h, id });
    }
  }
  return { items, dropped };
}

// Profil recopiable dans le formulaire d'embauche : valeurs lues dans la base du scénario (ou une embauche déjà saisie),
// affichées et modifiables avant enregistrement. null : valeur indisponible, le champ reste à saisir (rien n'est supposé).
export type HireProfile = {
  key: string;
  label: string;
  service: string | null;
  category: CategoryId | null;
  grossFullTime: string | null; // euros, ex. « 3000.00 »
  quotaPct: string | null;
  chargesPct: string | null;
  counted: boolean | null;
  note: string;
};

// Entier de centièmes → « 3000.00 » (saisie acceptée par les formulaires, sans passer par un flottant).
const fixed2 = (n: number) => `${n < 0 ? "-" : ""}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, "0")}`;

// Profils recopiables dans le formulaire d'embauche : contrats de la base et embauches déjà saisies.
export function hireProfiles(base: BaseSnapshot, hires: Extract<Hypothesis, { kind: "embauche" }>[]): HireProfile[] {
  const fromBase = base.contracts.map((c): HireProfile => {
    const b = c.base;
    const quotaOk = c.etp4 !== null && c.etp4 > 0;
    const rate = b && b.refBrutCents > 0 ? roundDiv(BigInt(b.refCotisationsCents) * 10_000n, BigInt(b.refBrutCents)) : null;
    const notes = [
      quotaOk && b ? "brut temps plein = salaire du mois de référence ÷ ETP" : "brut temps plein à saisir (ETP ou base n.d.)",
      rate === null ? "taux de charges à saisir (base n.d.)" : "taux de charges observé du contrat (arrondi au centième de %)",
    ];
    return {
      key: c.contractKey, label: c.label, service: c.service, category: c.category ?? null, counted: c.counted,
      grossFullTime: quotaOk && b ? fixed2(Number(roundDiv(BigInt(b.salaryCents) * 10_000n, BigInt(c.etp4!)))) : null,
      quotaPct: quotaOk ? fixed2(c.etp4!) : null,
      chargesPct: rate === null ? null : fixed2(Number(rate)),
      note: `Profil de ${c.label} : ${notes.join(" ; ")}.`,
    };
  });
  const fromHires = hires.map((h): HireProfile => ({
    key: hireKey(h.id), label: `${h.label} (embauche)`, service: h.service, category: h.category ?? null, counted: h.counted,
    grossFullTime: fixed2(h.grossFullTimeCents), quotaPct: fixed2(h.quotaBps), chargesPct: fixed2(h.chargesBps), note: `Profil de l'embauche « ${h.label} » recopié tel que saisi.`,
  }));
  return [...fromBase, ...fromHires];
}
