// Tendances financières : le rouge et le vert sont les deux seules couleurs hors de l'univers bleu / blanc / noir de Clair, et ne
// servent qu'à cela. Pour un COÛT (masse salariale, brut, charges, primes, indemnités, cotisations), une hausse est une tendance
// négative (rouge), une baisse une tendance positive (verte), une variation nulle reste neutre. Jamais appliqué aux effectifs,
// aux ETP, aux entrées ni aux sorties : ce ne sont pas des montants. La convention est écrite au glossaire.
export type TrendTone = "good" | "bad" | "flat";

export const costTone = (delta: number | null | undefined): TrendTone => (delta === null || delta === undefined || delta === 0 ? "flat" : delta > 0 ? "bad" : "good");
export const trendClass = (tone: TrendTone): string => (tone === "flat" ? "" : `trend-${tone}`);
