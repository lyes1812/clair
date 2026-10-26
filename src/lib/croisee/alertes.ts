import { sortAlerts, type AlertSpec } from "@/lib/viz/croisee";
import { capital, euros, eurosSigned, monthShortYear } from "@/lib/viz/masse";

// « À surveiller » de la Masse salariale croisée (chapitre 01) : sélection pure des points à surveiller à partir de chiffres déjà
// calculés (écart au budget, atterrissage, mois non clos, comptes non classés, sources absentes, seuils d'effectif, contrôles du
// journal). Trois niveaux seulement : « défavorable » (budget dépassé, atterrissage au-dessus du budget), « à compléter » (donnée ou
// source absente, valeur non calculable), « repère » (information). Comparaisons strictes, en centimes, sans tolérance d'arrondi.
// Un mois sans montant de budget saisi (null) est exclu du décompte et nommé ; un budget de 0 € est un montant saisi (il est
// comparé). Les repères de seuil d'effectif arrivent déjà calculés (seuilAlerts du chapitre 02, paramètres de l'espace) : ce module
// ne contient aucun seuil. Aucun plafond : toutes les alertes sont renvoyées, classées par niveau (sortAlerts). Module sans accès à
// la base : il n'importe que des fonctions de mise en forme.

export type AlertMention = { id: string; text: string; href?: string; linkLabel?: string };
export type AlertesResult = { alerts: AlertSpec[]; mentions: AlertMention[] };

// Un mois de la période : réalisé (masse chargée du journal, null si n.d.) et budget saisi du mois (null si non saisi).
export type BudgetMonth = { month: string; real: number | null; budget: number | null };
// Écart de la période déjà calculé (gap de src/lib/budget/series.ts sur les mois dotés d'un montant de budget).
export type PeriodGap = { kind: "value"; real: number; budget: number; delta: number } | { kind: "nd"; reason: string };
// Atterrissage face au budget sur les mêmes mois : atterrissage et budget de ces mois (landing − budget = delta), `months` mois
// comparés, `excluded` mois sans montant de budget.
export type LandingGap = { kind: "value"; landing: number; budget: number; delta: number; months: number; excluded: string[] } | { kind: "nd"; reason: string };
export type MissingSource = { id: string; label: string; reason: string; href?: string; linkLabel?: string };
// Contrôle journal ↔ comptabilité (comptes 63 et 64, reconcile) : écart, comptabilité non lue, rapprochement n.d., ou sans objet
// (filtre de service, journal non lu).
export type ComptaCheck = { kind: "value"; ecart: number } | { kind: "absent"; reason: string } | { kind: "nd"; reason: string } | { kind: "skip" };
// Contrôle journal ↔ DSN (brut de type 001, dsnBrutWindow) : écart et mois de DSN incomplète, mois sans DSN exploitable (none : aucune
// DSN déposée), ou sans objet.
export type DsnCheck = { kind: "value"; delta: number; incomplete: string[] } | { kind: "nd"; reason: string; months: string[]; none: boolean } | { kind: "skip" };
// Seuils d'effectif : mention (réglage absent ou illisible, ou effectif non filtrable par service), repères déjà calculés et
// effectifs moyens n.d., ou sans objet (référentiel RH non lu : le point « source » le dit déjà).
export type SeuilInput =
  | { kind: "mention"; id: string; text: string; settings: boolean }
  | { kind: "value"; alerts: AlertSpec[]; nd: { label: string; reason: string }[] }
  | { kind: "skip" };

export type AlertesInput = {
  year: number;
  budget:
    | { kind: "value"; name: string; gap: PeriodGap | null; monthly: BudgetMonth[] } // gap null : aucun mois de la période n'a de montant
    | { kind: "absent"; reason: string } // aucun budget saisi pour l'année
    | { kind: "na" }; // sans objet (budget global sous un filtre de service, ou réalisé non lu)
  landing: { kind: "value"; total: number; gap: LandingGap | null } | { kind: "nd"; reason: string } | { kind: "na" };
  openMonths: string[]; // mois de la période ou de N-1 non clôturés à la lecture (paie ou référentiel RH)
  unclassified: string[]; // comptes 63 / 64 sans rubrique sur la période
  missing: MissingSource[]; // sources absentes, indicateurs n.d.
  seuils: SeuilInput;
  checks: { compta: ComptaCheck; dsn: DsnCheck };
  hrefs: { parametres: string; grille: string; budget: string; paieCompta: string; donnees: string };
};

const nf = new Intl.NumberFormat("fr-FR");
const months = (list: string[]) => list.map(monthShortYear).join(", ");
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n > 1 ? many : one}`;
const sentence = (s: string) => `${capital(s.trim().replace(/[.\s]+$/, ""))}.`;
// Mois ISO d'une raison du moteur (« 2026-03 : … ») écrits en clair (« mars 2026 : … »).
const frMonths = (s: string) => s.replace(/\b(\d{4}-\d{2})\b/g, (m) => monthShortYear(m));

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

  // --- Atterrissage annuel face au budget saisi de l'année, sur les mêmes mois
  const l = input.landing;
  if (l.kind === "nd") {
    alerts.push({ id: "atterrissage-nd", level: "a-completer", label: "Atterrissage non calculé", text: sentence(l.reason) });
  } else if (l.kind === "value" && l.gap?.kind === "value" && l.gap.delta > 0) {
    const g = l.gap;
    const text = g.excluded.length
      ? `Atterrissage et budget saisi comparés sur ${plural(g.months, "mois", "mois")} (${plural(g.excluded.length, "mois sans montant de budget exclu", "mois sans montant de budget exclus")} : ${months(g.excluded)}) : écart ${eurosSigned(g.delta)}.`
      : `Atterrissage ${input.year} : ${euros(g.landing)} pour un budget saisi de ${euros(g.budget)} : écart ${eurosSigned(g.delta)}.`;
    alerts.push({ id: "atterrissage-depasse", level: "defavorable", label: "Atterrissage au-dessus du budget annuel", text });
  }

  // --- Sources absentes et données non calculables
  for (const m of input.missing) alerts.push({ id: `source-${m.id}`, level: "a-completer", label: m.label, text: sentence(m.reason), href: m.href, linkLabel: m.linkLabel });
  const c = input.checks.compta;
  if (c.kind === "absent") alerts.push({ id: "source-compta", level: "a-completer", label: "Comptabilité non lue", text: sentence(c.reason), href: h.donnees, linkLabel: "Données" });
  else if (c.kind === "nd") alerts.push({ id: "source-compta", level: "a-completer", label: "Rapprochement avec la comptabilité non calculé", text: sentence(frMonths(c.reason)), href: h.paieCompta, linkLabel: "Paie & comptabilité" });
  const d = input.checks.dsn;
  if (d.kind === "nd") {
    alerts.push(
      d.none
        ? { id: "source-dsn", level: "a-completer", label: "DSN de contrôle non lue", text: "Aucune DSN déposée dans Données : le brut du journal de paie n'est pas contrôlé.", href: h.donnees, linkLabel: "Données" }
        : { id: "source-dsn", level: "a-completer", label: "DSN de contrôle non déposée pour un mois", text: `${capital(plural(d.months.length, "mois", "mois"))} de la période sans DSN exploitable : ${frMonths(d.reason)}.`, href: h.donnees, linkLabel: "Données" },
    );
  }
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

  // --- Seuils d'effectif : repères calculés ailleurs (chapitre 02) ; sans réglage, une mention, jamais une alerte
  const s = input.seuils;
  if (s.kind === "mention") mentions.push(s.settings ? { id: s.id, text: s.text, href: h.parametres, linkLabel: "Paramètres" } : { id: s.id, text: s.text });
  else if (s.kind === "value") {
    if (s.nd.length) alerts.push({ id: "effectif-nd", level: "a-completer", label: "Effectif moyen non calculé", text: s.nd.map((x) => `${x.label} : ${x.reason.trim().replace(/[.\s]+$/, "")}`).join(" ; ") + "." });
    alerts.push(...s.alerts);
  }

  // --- Repères : mois non clos, contrôles du journal
  if (input.openMonths.length > 0) {
    alerts.push({ id: "mois-non-clos", level: "repere", label: "Mois non clos (paie ou référentiel RH)", text: `Non clôturés à la lecture : ${months([...input.openMonths].sort())} ; montants provisoires.` });
  }
  if (c.kind === "value" && c.ecart !== 0) {
    alerts.push({ id: "journal-compta", level: "repere", label: "Journal de paie et comptabilité", text: `Écart sur les comptes 63 et 64 de la période : ${eurosSigned(c.ecart)}.`, href: h.paieCompta, linkLabel: "Paie & comptabilité" });
  }
  if (d.kind === "value" && d.delta !== 0) {
    const inc = d.incomplete.length ? ` DSN incomplète : ${months([...d.incomplete].sort())}.` : "";
    alerts.push({ id: "journal-dsn", level: "repere", label: "Journal de paie et DSN", text: `Brut du journal moins brut déclaré (DSN, type 001) sur la période : ${eurosSigned(d.delta)}.${inc}`, href: h.paieCompta, linkLabel: "Paie & comptabilité" });
  }

  return { alerts: sortAlerts(alerts), mentions };
}

// Impression « Synthèse en PDF · 1 page » : au-delà de `max` repères, les repères suivants sont regroupés en une ligne
// « + k autres repères » ; un point « défavorable » ou « à compléter » n'est jamais regroupé. Renvoie le nombre de repères regroupés.
export function printFold(alerts: readonly AlertSpec[], max: number): { shown: AlertSpec[]; folded: number } {
  let reperes = 0;
  const shown: AlertSpec[] = [];
  for (const a of sortAlerts(alerts)) {
    if (a.level === "repere" && ++reperes > max) continue;
    shown.push(a);
  }
  return { shown, folded: Math.max(0, reperes - max) };
}
