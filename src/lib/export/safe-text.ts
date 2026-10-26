// Neutralisation des formules dans un tableur : un texte qui commence par =, +, @, une tabulation, un retour chariot ou « - » peut être
// pris pour une formule à l'ouverture (CSV surtout). Il est précédé d'une apostrophe.
// « - » (et « + ») suivi d'un nombre pur (entier ou décimal à virgule ou à point, signé) est un nombre, pas une formule : il reste tel quel.
// Ne s'applique qu'à du TEXTE : une cellule numérique (un écart négatif, par exemple) n'y passe jamais.
const DANGEROUS_START = /^[=+@\t\r-]/;
const PURE_NUMBER = /^[+-]?\d+(?:[.,]\d+)?$/;

export function safeText(s: string): string {
  return DANGEROUS_START.test(s) && !PURE_NUMBER.test(s) ? `'${s}` : s;
}
