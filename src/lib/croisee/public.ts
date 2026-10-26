import type { ChapterModel } from "@/lib/viz/croisee";
import { memoByContext } from "./memo";

// Raisons publiques de la Masse salariale croisée : aucun identifiant de contrat ou d'absence, aucun nom de la base figée d'un
// scénario dans ce que la page affiche ou exporte. Les moteurs (KPI RH, projection) nomment l'élément en cause dans leurs raisons
// n.d. ; ici, chaque forme connue est remplacée par une raison générique qui garde le mois (écrit avant la raison) et le nombre, le
// détail nominatif restant dans KPI RH ou dans Hypothèses budgétaires, avec leurs droits. Fonctions pures, sans base de données.
//
// Formes reconnues (textes des moteurs, src/lib/rh/kpi/absence.ts, turnover.ts, src/lib/budget/engine.ts), y compris reprises dans
// une raison de période (« N mois n.d. (…) ; <mois> : <raison> ») ou de mois (« <mois> : <raison> ») :
// - « absence X rattachée au contrat Y inconnu du référentiel » ;
// - « absence X : date de (début et de fin | début | fin) non renseignée dans PayFit » ;
// - « (absences A, B) » (demi-journées incertaines) ;
// - « entrées | sorties de AAAA-MM : contrats continus non vérifiables (C1 le …, C2 le …) — … », et toute liste de contrats restée
//   entre parenthèses après « contrats continus non vérifiables » (identifiants en texte libre : voir CONTINUITY) ;
// - « <libellé> : base n.d. (…) — saisir une correction de base » (le libellé est le nom de la personne) ;
// - et, par prudence, « sous le contrat X », « contrat X non renvoyé par PayFit », « contrat continu neutralisé (avec X le …) ».
// Toute autre raison est rendue telle quelle. Le filtre est idempotent : une raison déjà publique n'est pas réécrite.

const KPI = "détail dans KPI RH";
const HYP = "détail dans Hypothèses budgétaires";
const nf = new Intl.NumberFormat("fr-FR");
const many = (n: number, one: string, more: string) => `${nf.format(n)} ${n > 1 ? more : one}`;

// Nombre de contrats d'une liste « C1 le 03/03/2026, C2 le 05/03/2026 » : les dates qui terminent un élément (suivies de « , » ou de
// la fin de la liste), à défaut les éléments.
const LE_DATE = / le \d{2}\/\d{2}\/\d{4}(?=, |$)/g;
const listCount = (list: string): number => (list.match(LE_DATE) ?? []).length || list.split(", ").filter((s) => s.trim() !== "").length || 1;

// Contrats continus non vérifiables (turnover.ts) : « <sens> de AAAA-MM : contrats continus non vérifiables (<id> le JJ/MM/AAAA, …)
// — jour voisin hors de la couverture ; sans la neutralisation (Paramètres), ces mouvements seraient comptés ». L'identifiant est un
// texte libre (numéro de contrat DSN : jusqu'à 128 caractères, parenthèses, virgules, dates et noms compris) : la fin de la liste n'est
// jamais cherchée par une classe de caractères ni par une date (« le JJ/MM/AAAA) » peut figurer dans un identifiant). Elle n'est
// reconnue que par le suffixe fixe du moteur (« ) — jour voisin hors de la couverture »), par une correspondance paresseuse : le
// nombre de contrats est alors gardé. Sans ce suffixe (autre tournure, liste coupée, texte inattendu), la liste est retirée jusqu'à la
// fin du texte, sans nombre. Une passe par forme, dans cet ordre. Les formes déjà publiques (« (détail dans KPI RH) », « (N contrats,
// détail dans KPI RH) ») sont exclues : le filtre reste idempotent.
const CONTINUITY = /(entrées|sorties) de (\d{4}-\d{2}) : contrats continus non vérifiables \((?!détail dans KPI RH\))(?!\d[\d\s ]* contrats?, détail dans KPI RH\))(.+?)\) — jour voisin hors de la couverture(?: ; sans la neutralisation \(Paramètres\), ces mouvements seraient comptés)?/gis;
const CONTINUITY_LIST = /contrats continus non vérifiables \((?!détail dans KPI RH\))(?!\d[\d\s ]* contrats?, détail dans KPI RH\))(.+?)\)(?= — jour voisin hors de la couverture)/gs;
const CONTINUITY_LIST_CUT = /contrats continus non vérifiables \((?!détail dans KPI RH\))(?!\d[\d\s ]* contrats?, détail dans KPI RH\)).*$/s;
const ABSENCE_UNKNOWN_CONTRACT = /absence (?:(?!absence )[^;()])+? rattachée au contrat [^;()]+? inconnu du référentiel/g;
const ABSENCE_DATE = /absence (?:(?!absence | : )[^;()])+? : date de (début et de fin|début|fin) non renseignée dans PayFit/g;
const UNCERTAIN_LIST = /incertaine\(s\) \(absences ([^()]*)(\)|$)/g;
const ID_LIST = /(^|\s)\(absences ([^\s,()]*\d[^\s,()]*(?:, [^\s,()]*\d[^\s,()]*)*)\)/g;
// « <libellé> : base n.d. (…) — saisir une correction de base » : le libellé (nom de la personne, texte libre : « : », « — »,
// parenthèses compris) n'est jamais délimité par une classe de caractères ; tout le segment de raison est remplacé, du début du texte
// ou du séparateur de raisons (« ; ») jusqu'à « — saisir une correction de base ». Seuls sont gardés en tête du segment un mois
// (« AAAA-MM : », « avr. 2026 : ») et le nom du scénario (« Scénario « … » : »), qui ne nomment personne.
const BASE_KEEP = String.raw`(?:\d{4}-\d{2} : |[a-zéû]{3,5}\.? \d{4} : |Scénario « [^«»]* » : )*`;
const BASE_ND = new RegExp(String.raw`(^|; )(${BASE_KEEP})(?:(?!; ).)+? : base n\.d\. \(.*?\) — saisir une correction de base`, "gs");
const NO_BASE = `1 contrat sans base de projection (${HYP})`;
const NO_BASE_RUN = new RegExp(`${NO_BASE.replace(/[()]/g, "\\$&")}(?: ; ${NO_BASE.replace(/[()]/g, "\\$&")})+`, "g");
const OTHER_CONTRACT = /sous le contrat (?!précédent |suivant )\S+ (de la même personne|déjà comptée)/g;
const NOT_RETURNED = /contrat (?!non )\S+ non renvoyé par PayFit/g;
// Identifiant en texte libre (espaces, parenthèses, « — », « : », dates compris) : correspondance paresseuse jusqu'à « le JJ/MM/AAAA) »
// suivi de la fin du texte ou d'une fin de raison (« ; », « . », « — », « ) ») ; une date entre parenthèses dans l'identifiant (« CDD
// (fin le 01/02/2026) Nom ») ne termine donc pas le libellé. Sans une telle fin, le libellé est retiré jusqu'à la fin du texte.
const NEUTRALIZED = /contrat continu neutralisé \(avec .+? le (\d{2}\/\d{2}\/\d{4})\)(?=\s*(?:$|[;.—)]))/gs;
const NEUTRALIZED_CUT = /contrat continu neutralisé \(avec (?!un autre contrat(?: le \d{2}\/\d{2}\/\d{4}|, détail dans KPI RH)\)).*$/s;

const absencesText = (list: string) => `${many(listCount(list), "absence", "absences")}, ${KPI}`;
const continuity = (_m: string, what: string, month: string, list: string) => `${many(listCount(list), "contrat continu non vérifiable", "contrats continus non vérifiables")} en ${month} (${what.toLowerCase()}, ${KPI})`;
const continuityList = (_m: string, list: string) => `contrats continus non vérifiables (${many(listCount(list), "contrat", "contrats")}, ${KPI})`;

export function publicReason(text: string): string {
  return text
    .replace(CONTINUITY, continuity)
    .replace(CONTINUITY_LIST, continuityList)
    .replace(CONTINUITY_LIST_CUT, `contrats continus non vérifiables (${KPI})`)
    .replace(ABSENCE_UNKNOWN_CONTRACT, `1 absence rattachée à un contrat inconnu du référentiel (${KPI})`)
    .replace(ABSENCE_DATE, (_m, which: string) => `1 absence sans date de ${which} renseignée dans PayFit (${KPI})`)
    .replace(UNCERTAIN_LIST, (_m, list: string, close: string) => `incertaine(s) (${close === ")" ? absencesText(list) : KPI})`)
    .replace(ID_LIST, (_m, before: string, list: string) => `${before}(${absencesText(list)})`)
    .replace(BASE_ND, (_m, before: string, keep: string) => `${before}${keep}${NO_BASE}`)
    .replace(NO_BASE_RUN, (run: string) => `${many(run.split(" ; ").length, "contrat", "contrats")} sans base de projection (${HYP})`)
    .replace(OTHER_CONTRACT, "sous un autre contrat $1")
    .replace(NOT_RETURNED, "contrat non renvoyé par PayFit")
    .replace(NEUTRALIZED, "contrat continu neutralisé (avec un autre contrat le $1)")
    .replace(NEUTRALIZED_CUT, "contrat continu neutralisé (avec un autre contrat, détail dans KPI RH)");
}

// Chaque chaîne d'un modèle de chapitre (raisons n.d. des cellules, des cartes et des blocs, notes, tuiles, alertes, mentions,
// séries, libellés) passe par publicReason. Les tableaux et objets simples sont recopiés (l'original n'est pas modifié) ; nombres,
// booléens, null et undefined restent tels quels ; un objet d'une autre nature (date…) est gardé tel quel.
export function scrubModel<T>(x: T): T {
  if (typeof x === "string") return publicReason(x) as T;
  if (Array.isArray(x)) return x.map((v) => scrubModel(v)) as T;
  if (x instanceof Map) return new Map([...x].map(([k, v]) => [k, scrubModel(v)])) as T;
  if (x instanceof Set) return new Set([...x].map((v) => scrubModel(v))) as T;
  if (x !== null && typeof x === "object") {
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return x;
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, scrubModel(v)])) as T;
  }
  return x;
}

// Mémo par requête d'un modèle de chapitre (comme memoByContext), le modèle passé par scrubModel : l'écran (Ch<Chapitre>.tsx) et les
// exports reçoivent le même modèle, sans identifiant. Chaque chapitre l'importe à la place de memoByContext.
export function memoPublicModel<C extends object, M extends Pick<ChapterModel, "chapter">>(fn: (ctx: C) => Promise<M>): (ctx: C) => Promise<M> {
  return memoByContext((ctx: C) => fn(ctx).then((m) => scrubModel(m)));
}
