import { croiseeSettingReason, settingValue, type CroiseeSetting, type SeuilEffectif } from "@/lib/croisee-settings";
import { fmtFixed } from "@/lib/rh/kpi/format";
import type { Ratio } from "@/lib/rh/kpi/types";
import { sortAlerts, type AlertSpec } from "@/lib/viz/croisee";
import { capital, euros, eurosSigned, monthShortYear } from "@/lib/viz/masse";

// « À surveiller » de la Masse salariale croisée (chapitre 01) : sélection pure des points à surveiller à partir de chiffres déjà
// calculés (écart au budget, atterrissage, mois non clos, comptes non classés, sources absentes, effectif moyen, contrôles). Trois
// niveaux seulement : « défavorable » (budget dépassé, atterrissage au-dessus du budget), « à compléter » (donnée absente ou non
// calculable), « repère » (information). Comparaisons strictes, en centimes, sans tolérance d'arrondi. Un mois sans montant de
// budget saisi (null) est exclu du décompte et nommé ; un budget de 0 € est un montant saisi (il est comparé). Les seuils d'effectif
// et la marge d'alerte ne viennent que des paramètres de l'espace : sans eux, aucune alerte de seuil, une mention le dit. Aucun
// plafond : toutes les alertes sont renvoyées, classées par niveau (sortAlerts).

export type AlertMention = { id: string; text: string; href?: string; linkLabel?: string };
export type AlertesResult = { alerts: AlertSpec[]; mentions: AlertMention[] };

// Un mois de la période : réalisé (masse chargée du journal, null si n.d.) et budget saisi du mois (null si non saisi).
export type BudgetMonth = { month: string; real: number | null; budget: number | null };
// Écart de la période déjà calculé (gap de src/lib/budget/series.ts sur les mois dotés d'un montant de budget).
export type PeriodGap = { kind: "value"; real: number; budget: number; delta: number } | { kind: "nd"; reason: string };
export type LandingGap = { kind: "value"; budget: number; delta: number; months: number; excluded: string[] } | { kind: "nd"; reason: string };
export type MissingSource = { id: string; label: string; reason: string; href?: string; linkLabel?: string };

export type AlertesInput = {
  year: number;
  budget:
    | { kind: "value"; name: string; gap: PeriodGap | null; monthly: BudgetMonth[] } // gap null : aucun mois de la période n'a de montant
    | { kind: "absent"; reason: string } // aucun budget saisi pour l'année
    | { kind: "na" }; // sans objet (budget global sous un filtre de service)
  landing: { kind: "value"; total: number; gap: LandingGap | null } | { kind: "nd"; reason: string } | { kind: "na" };
  openMonths: string[]; // mois de la période ou de N-1 dont la paie n'est pas clôturée
  unclassified: string[]; // comptes 63 / 64 sans rubrique sur la période
  missing: MissingSource[]; // sources absentes, indicateurs n.d.
  headcount: { kind: "value"; average: Ratio } | { kind: "nd"; reason: string } | { kind: "skip" }; // effectif moyen de la période
  seuils: CroiseeSetting<SeuilEffectif[]>;
  marge: CroiseeSetting<number>;
  checks: { compta: number | null; dsn: number | null }; // journal − comptabilité (comptes 63, 64), journal − DSN (brut 001)
  hrefs: { parametres: string; grille: string; budget: string; paieCompta: string };
};

const nf = new Intl.NumberFormat("fr-FR");
const months = (list: string[]) => list.map(monthShortYear).join(", ");
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n > 1 ? many : one}`;
const sentence = (s: string) => `${capital(s.trim().replace(/[.\s]+$/, ""))}.`;

// Mois au-dessus du budget du mois : comparaison stricte réalisé > budget, sur les mois qui ont les deux montants. Les mois sans
// montant de budget et ceux dont le réalisé est n.d. sont exclus et renvoyés à part (jamais comptés comme « au budget »).
export function monthsAboveBudget(monthly: readonly BudgetMonth[]): { above: string[]; compared: string[]; noBudget: string[]; noReal: string[] } {
  const above: string[] = [];
  const compared: string[] = [];
  const noBudget: string[] = [];
  const noReal: string[] = [];
  for (const m of monthly) {
    if (m.budget === null) noBudget.push(m.month);
    else if (m.real === null) noReal.push(m.month);
    else {
      compared.push(m.month);
      if (m.real > m.budget) above.push(m.month);
    }
  }
  return { above, compared, noBudget, noReal };
}

// Prochain seuil strictement supérieur à l'effectif moyen (fraction exacte) et écart à ce seuil ; repère quand l'écart ne dépasse
// pas la marge (≤). Calcul en entiers (BigInt) : aucun arrondi ne décide de l'alerte.
export function nearThreshold(average: Ratio, seuils: readonly SeuilEffectif[], marge: number): { seuil: SeuilEffectif; gap: Ratio } | null {
  const num = BigInt(average.num);
  const den = BigInt(average.den);
  if (den <= 0n) return null;
  const next = [...seuils].sort((a, b) => a.valeur - b.valeur).find((s) => BigInt(s.valeur) * den > num);
  if (!next) return null;
  const gapNum = BigInt(next.valeur) * den - num;
  if (gapNum > BigInt(marge) * den) return null;
  const safe = (x: bigint) => x <= BigInt(Number.MAX_SAFE_INTEGER);
  return safe(gapNum) && safe(den) ? { seuil: next, gap: { num: Number(gapNum), den: Number(den) } } : null;
}

export function selectAlerts(input: AlertesInput): AlertesResult {
  const alerts: AlertSpec[] = [];
  const mentions: AlertMention[] = [];
  const h = input.hrefs;

  // --- Budget saisi de la période
  const b = input.budget;
  if (b.kind === "absent") {
    alerts.push({ id: "budget-absent", level: "a-completer", label: "Budget saisi absent", text: sentence(b.reason), href: h.budget, linkLabel: "Hypothèses budgétaires" });
  } else if (b.kind === "value") {
    const split = monthsAboveBudget(b.monthly);
    const excludedText = split.noBudget.length ? ` ${plural(split.noBudget.length, "mois sans montant de budget exclu", "mois sans montant de budget exclus")} (${months(split.noBudget)}).` : "";
    if (b.gap === null) {
      alerts.push({ id: "budget-non-saisi", level: "a-completer", label: "Budget de la période non saisi", text: `Aucun montant de budget saisi « ${b.name} » pour ${months(b.monthly.map((m) => m.month))}.`, href: h.budget, linkLabel: "Hypothèses budgétaires" });
    } else if (b.gap.kind === "nd") {
      alerts.push({ id: "budget-nd", level: "a-completer", label: "Écart au budget non calculé", text: sentence(b.gap.reason) });
    } else if (b.gap.delta > 0) {
      const n = split.compared.length + split.noReal.length;
      alerts.push({
        id: "budget-depasse",
        level: "defavorable",
        label: "Budget dépassé",
        text: `Réalisé ${euros(b.gap.real)} pour un budget saisi « ${b.name} » de ${euros(b.gap.budget)} sur ${plural(n, "mois", "mois")} : écart ${eurosSigned(b.gap.delta)}.${excludedText}`,
      });
    }
    // Repère mois par mois : seulement sur une période de plusieurs mois comparés (un seul mois, c'est l'écart de la période).
    if (split.compared.length > 1 && split.above.length > 0) {
      const noReal = split.noReal.length ? ` Réalisé n.d. : ${months(split.noReal)}.` : "";
      alerts.push({
        id: "budget-mois",
        level: "repere",
        label: "Mois au-dessus du budget du mois",
        text: `${nf.format(split.above.length)} mois sur ${nf.format(split.compared.length)} : ${months(split.above)}.${excludedText}${noReal}`,
      });
    }
  }

  // --- Atterrissage annuel face au budget saisi de l'année
  const l = input.landing;
  if (l.kind === "nd") {
    alerts.push({ id: "atterrissage-nd", level: "a-completer", label: "Atterrissage non calculé", text: sentence(l.reason) });
  } else if (l.kind === "value" && l.gap?.kind === "value" && l.gap.delta > 0) {
    const g = l.gap;
    const text = g.excluded.length
      ? `Atterrissage et budget saisi comparés sur ${plural(g.months, "mois", "mois")} (${plural(g.excluded.length, "mois sans montant de budget exclu", "mois sans montant de budget exclus")} : ${months(g.excluded)}) : écart ${eurosSigned(g.delta)}.`
      : `Atterrissage ${input.year} : ${euros(l.total)} pour un budget saisi de ${euros(g.budget)} : écart ${eurosSigned(g.delta)}.`;
    alerts.push({ id: "atterrissage-depasse", level: "defavorable", label: "Atterrissage au-dessus du budget annuel", text });
  }

  // --- Données absentes ou non calculables
  for (const m of input.missing) alerts.push({ id: `source-${m.id}`, level: "a-completer", label: m.label, text: sentence(m.reason), href: m.href, linkLabel: m.linkLabel });
  if (input.unclassified.length > 0) {
    const ids = [...new Set(input.unclassified)].sort();
    alerts.push({
      id: "comptes-non-classes",
      level: "a-completer",
      label: "Comptes non classés",
      text: `${plural(ids.length, "compte de charges de personnel sans rubrique", "comptes de charges de personnel sans rubrique")}, hors masse chargée : ${ids.join(", ")}.`,
      href: h.grille,
      linkLabel: "Classer dans les Paramètres",
    });
  }

  // --- Seuils d'effectif : paramètres de l'espace, sans valeur par défaut
  const seuilsWhy = croiseeSettingReason("seuilsEffectif", input.seuils);
  const margeWhy = croiseeSettingReason("margeAlerte", input.marge);
  const seuils = settingValue(input.seuils);
  const marge = settingValue(input.marge);
  if (seuilsWhy || seuils === null) mentions.push({ id: "seuils-effectif", text: capital(seuilsWhy ?? "seuils d'effectif non définis (Paramètres)"), href: h.parametres, linkLabel: "Paramètres" });
  else if (margeWhy || marge === null) mentions.push({ id: "marge-alerte", text: capital(margeWhy ?? "marge d'alerte des seuils d'effectif non définie (Paramètres)"), href: h.parametres, linkLabel: "Paramètres" });
  else if (input.headcount.kind === "nd") {
    alerts.push({ id: "effectif-nd", level: "a-completer", label: "Effectif moyen non calculé", text: sentence(input.headcount.reason) });
  } else if (input.headcount.kind === "value") {
    const near = nearThreshold(input.headcount.average, seuils, marge);
    if (near) {
      alerts.push({
        id: "seuil-effectif",
        level: "repere",
        label: "Effectif proche d'un seuil",
        text: `Effectif moyen de la période : ${fmtFixed(input.headcount.average)} ; seuil « ${near.seuil.libelle} » : ${plural(near.seuil.valeur, "salarié", "salariés")} ; écart ${fmtFixed(near.gap)}, marge ${nf.format(marge)}.`,
      });
    }
  }

  // --- Repères : mois non clos, contrôles du journal
  if (input.openMonths.length > 0) {
    alerts.push({ id: "mois-non-clos", level: "repere", label: "Mois non clos", text: `Paie non clôturée à la lecture : ${months([...input.openMonths].sort())} (montants provisoires).` });
  }
  if (input.checks.compta !== null && input.checks.compta !== 0) {
    alerts.push({ id: "journal-compta", level: "repere", label: "Journal de paie et comptabilité", text: `Écart sur les comptes 63 et 64 de la période : ${eurosSigned(input.checks.compta)}.`, href: h.paieCompta, linkLabel: "Paie & comptabilité" });
  }
  if (input.checks.dsn !== null && input.checks.dsn !== 0) {
    alerts.push({ id: "journal-dsn", level: "repere", label: "Journal de paie et DSN", text: `Brut du journal moins brut déclaré (DSN, type 001) sur la période : ${eurosSigned(input.checks.dsn)}.`, href: h.paieCompta, linkLabel: "Paie & comptabilité" });
  }

  return { alerts: sortAlerts(alerts), mentions };
}
