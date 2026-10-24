// Présentation des écrans de saisie des hypothèses : un seul format de date dans le texte (jj/mm/aaaa pour un jour,
// « novembre 2026 » pour un mois) et légende d'une grille mensuelle (unité et année écrites au-dessus). Aucun calcul métier :
// on réécrit seulement la forme d'une date déjà présente, jamais une valeur.

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Jeton AAAA-MM ou AAAA-MM-JJ isolé (ni lettre, ni chiffre, ni tiret collé avant ou après : un identifiant, un montant, une plage de dates
// « 2026-10-26 → 2026-11-25 » se lisent jeton par jeton). Sans lookbehind : le fichier part aussi dans le navigateur.
const TOKEN = /(^|[^\w-])(\d{4})-(\d{2})(?:-(\d{2}))?(?![\w-])/g;

// « de » devant avril, août ou octobre s'élide (« éléments ponctuels d'octobre 2026 »). Lookahead seulement : pas de lookbehind.
const DE_VOYELLE = /(^|[^\w'’-])(de|De) (?=(?:avril|août|octobre) \d{4})/g;

// Réécrit chaque date ou mois ISO d'un texte ; un jeton qui n'est pas une date réelle (mois 13, 31 février) reste tel quel.
export function frDates(text: string): string {
  return text
    .replace(TOKEN, (all, before: string, y: string, m: string, d: string | undefined) => {
      const month = Number(m);
      if (month < 1 || month > 12) return all;
      if (d === undefined) return `${before}${MONTHS[month - 1]} ${y}`;
      const day = Number(d);
      const last = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
      return day >= 1 && day <= last ? `${before}${d}/${m}/${y}` : all;
    })
    .replace(DE_VOYELLE, (_all, before: string, de: string) => `${before}${de === "De" ? "D" : "d"}'`);
}

// « de décembre 2026 », « d'octobre 2026 » : le mois (AAAA-MM) précédé de « de » correctement élidé. Un mois illisible est rendu tel quel.
export function deMois(month: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return `de ${month}`;
  const name = MONTHS[Number(m[2]) - 1];
  return `${/^[aeiouhàâéèêîôû]/i.test(name) ? "d'" : "de "}${name} ${m[1]}`;
}

// Légende d'une grille mensuelle : « Taux en % · 2026 » ; deux années : « Taux en % · 2026 et 2027 ».
export function gridCaption(unit: string, months: string[]): string {
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  if (years.length === 0) return unit;
  const list = years.length === 1 ? years[0] : `${years.slice(0, -1).join(", ")} et ${years[years.length - 1]}`;
  return `${unit} · ${list}`;
}
