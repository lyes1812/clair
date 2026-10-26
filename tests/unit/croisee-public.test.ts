import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { memoPublicModel, publicReason, scrubModel } from "@/lib/croisee/public";

// Raisons publiques de la Masse salariale croisée (src/lib/croisee/public.ts). Identifiants et noms entièrement fictifs
// (« CTR-TEST », « ABS-TEST », « FICTIF ») ; chaque texte attendu est écrit à la main.

const LEAK = /CTR-TEST|ABS-TEST|FICTIF/;
const CONT = "sorties de 2026-03 : contrats continus non vérifiables (CTR-TEST-1 le 03/03/2026, CTR-TEST-2 le 05/03/2026) — jour voisin hors de la couverture ; sans la neutralisation (Paramètres), ces mouvements seraient comptés";
const BASE = (who: string, why = "aucune ligne de brut en 2026-01 pour ce contrat") => `${who} : base n.d. (${why}) — saisir une correction de base`;

describe("publicReason : une forme du moteur par cas, le mois et le nombre gardés", () => {
  it("contrats continus non vérifiables (turnover) : nombre de contrats, mois, sens du mouvement", () => {
    // Deux dates dans la liste : deux contrats.
    expect(publicReason(CONT)).toBe("2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)");
    // Sans le suffixe du moteur : la liste est retirée jusqu'à la fin du texte, sans nombre (sa fin ne peut pas être reconnue).
    expect(publicReason("Entrées de 2026-02 : contrats continus non vérifiables (CTR-TEST-3 le 02/02/2026)")).toBe("Entrées de 2026-02 : contrats continus non vérifiables (détail dans KPI RH)");
    // Reprise dans la raison d'une fenêtre du turnover (« <mois> : <mesure> n.d. — <raison du mois> »).
    expect(publicReason(`2026-03 : sorties n.d. — ${CONT}`)).toBe("2026-03 : sorties n.d. — 2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)");
  });

  it("liste de contrats restée entre parenthèses (autre tournure, liste coupée) : retirée jusqu'à la fin du texte, sans nombre", () => {
    expect(publicReason("N-1 : contrats continus non vérifiables (CTR-TEST-4 le 01/02/2025, CTR-TEST-5 le 03/02/2025, CTR-TEST-6 le 04/02/2025)")).toBe("N-1 : contrats continus non vérifiables (détail dans KPI RH)");
    expect(publicReason("entrées de 2026-02 : contrats continus non vérifiables (CTR-TEST-3 le 01/02/2026, CTR-TE…")).toBe("entrées de 2026-02 : contrats continus non vérifiables (détail dans KPI RH)");
  });

  it("absence rattachée à un contrat inconnu du référentiel : seule, après son mois, dans une raison de période", () => {
    const raw = "absence ABS-TEST-9 rattachée au contrat CTR-TEST-4 inconnu du référentiel";
    const pub = "1 absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)";
    expect(publicReason(raw)).toBe(pub);
    expect(publicReason(`2026-03 : ${raw}`)).toBe(`2026-03 : ${pub}`);
    expect(publicReason(`2 mois n.d. (2026-03 → 2026-04) ; 2026-03 : ${raw}`)).toBe(`2 mois n.d. (2026-03 → 2026-04) ; 2026-03 : ${pub}`);
  });

  it("absence sans date dans PayFit : début, fin, début et de fin", () => {
    expect(publicReason("absence ABS-TEST-8 : date de fin non renseignée dans PayFit")).toBe("1 absence sans date de fin renseignée dans PayFit (détail dans KPI RH)");
    expect(publicReason("2026-05 : absence ABS-TEST-7 : date de début non renseignée dans PayFit")).toBe("2026-05 : 1 absence sans date de début renseignée dans PayFit (détail dans KPI RH)");
    expect(publicReason("absence ABS-TEST-42 : date de début et de fin non renseignée dans PayFit")).toBe("1 absence sans date de début et de fin renseignée dans PayFit (détail dans KPI RH)");
    expect(publicReason("3 mois n.d. (2026-01 → 2026-03) ; 2026-01 : absence ABS-TEST-77 : date de début et de fin non renseignée dans PayFit")).toBe(
      "3 mois n.d. (2026-01 → 2026-03) ; 2026-01 : 1 absence sans date de début et de fin renseignée dans PayFit (détail dans KPI RH)",
    );
  });

  it("liste « (absences A, B) » des demi-journées incertaines : le nombre d'absences, sans identifiant", () => {
    expect(publicReason("≥ : 3 demi-journée(s) incertaine(s) (absences ABS-TEST-3, ABS-TEST-4)")).toBe("≥ : 3 demi-journée(s) incertaine(s) (2 absences, détail dans KPI RH)");
    expect(publicReason("chevauchement : 2 demi-journée(s) comptée(s) une fois ; ≥ : 1 demi-journée(s) incertaine(s) (absences ABS-TEST-5)")).toBe(
      "chevauchement : 2 demi-journée(s) comptée(s) une fois ; ≥ : 1 demi-journée(s) incertaine(s) (1 absence, détail dans KPI RH)",
    );
    // Liste d'identifiants dans une autre phrase ; liste coupée.
    expect(publicReason("mars 2026 : borne basse (absences ABS-TEST-1, ABS-TEST-2)")).toBe("mars 2026 : borne basse (2 absences, détail dans KPI RH)");
    expect(publicReason("≥ : 9 demi-journée(s) incertaine(s) (absences ABS-TEST-1, ABS-TE")).toBe("≥ : 9 demi-journée(s) incertaine(s) (détail dans KPI RH)");
  });

  it("« <libellé> : base n.d. (…) » de la projection : le nom part, les contrats d'un même mois sont comptés", () => {
    const one = "1 contrat sans base de projection (détail dans Hypothèses budgétaires)";
    expect(publicReason(BASE("Prénom FICTIF"))).toBe(one);
    // Mois de la projection : raisons jointes par « ; » (deux contrats → 2), puis une autre raison gardée telle quelle.
    expect(publicReason(`2026-11 : ${BASE("Prénom FICTIF")} ; ${BASE("Autre FICTIF", "présence fin 2026-01 n.d. : quotité absente (mois lus : 2025-01 → 2026-01)")}`)).toBe(
      "2026-11 : 2 contrats sans base de projection (détail dans Hypothèses budgétaires)",
    );
    expect(publicReason(`2026-11 : hors de l'horizon du scénario ; 2026-12 : ${BASE("Nom-Composé D'FICTIF")}`)).toBe(`2026-11 : hors de l'horizon du scénario ; 2026-12 : ${one}`);
    // Reprise sous un libellé de série (pont) ou après un tiret.
    expect(publicReason(`Scénario « Plan » : avr. 2026 : ${BASE("Prénom FICTIF")}`)).toBe(`Scénario « Plan » : avr. 2026 : ${one}`);
    // Tout le segment de raison est remplacé : seuls un mois et le nom du scénario sont gardés en tête.
    expect(publicReason(`atterrissage n.d. — ${BASE("Prénom FICTIF")}`)).toBe(one);
  });

  it("par prudence : contrat cité dans une trace d'absence, contrat non renvoyé, contrat continu neutralisé", () => {
    expect(publicReason("2 demi-journée(s) incertaine(s) sous le contrat CTR-TEST-8 de la même personne (non rattachées par PayFit)")).toBe("2 demi-journée(s) incertaine(s) sous un autre contrat de la même personne (non rattachées par PayFit)");
    expect(publicReason("1 demi-journée(s) sous le contrat CTR-TEST-8 déjà comptée(s) par d'autres absences")).toBe("1 demi-journée(s) sous un autre contrat déjà comptée(s) par d'autres absences");
    expect(publicReason("contrat CTR-TEST-9 non renvoyé par PayFit (archivé depuis plus de 12 mois)")).toBe("contrat non renvoyé par PayFit (archivé depuis plus de 12 mois)");
    expect(publicReason("contrat continu neutralisé (avec CTR-TEST-2 le 01/03/2026)")).toBe("contrat continu neutralisé (avec un autre contrat le 01/03/2026)");
  });

  it("toute autre raison est rendue telle quelle, texte ordinaire compris", () => {
    for (const s of [
      "historique insuffisant",
      "absences non lues pour 2026-08 (mois lus : 2026-01 → 2026-07)",
      "Quand une valeur appartient à plusieurs ensembles (absences par motif, contrats observés)",
      "aucun contrat compté présent dans 2026-02",
      "continuité non vérifiable : le 01/03/2026 n'est pas couvert par la source (contrat précédent inconnu)",
      "2026-03 : mois hors de la lecture PayFit appliquée",
      "",
    ])
      expect(publicReason(s), s).toBe(s);
  });

  it("idempotent : une raison déjà publique (de ce filtre ou d'un chapitre) n'est pas réécrite", () => {
    const already = [
      "2 contrats continus non vérifiables en 2026-03 (détail dans KPI RH)", // effectifs (continuityText)
      "entrées de 2026-02 : contrats continus non vérifiables (détail dans KPI RH)", // effectifs (filet)
      "absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)", // absences (publicText)
      "≥ : 3 demi-journée(s) incertaine(s) (détail dans KPI RH)",
      "1 absence rattachée à un contrat inconnu du référentiel en 2026-04 (détail dans KPI RH)", // congés (issueReason)
      "au moins une absence sans date de début ou de fin dans PayFit en 2026-05 (détail dans KPI RH)",
      "2 contrats sans base de projection (détail dans Hypothèses budgétaires)", // budget (publicProjectionReasons)
      "1 autre raison de n.d. de la projection (détail dans Hypothèses budgétaires)",
    ];
    for (const s of already) expect(publicReason(s), s).toBe(s);
    const raw = [CONT, "absence ABS-TEST-9 rattachée au contrat CTR-TEST-4 inconnu du référentiel", "absence ABS-TEST-1 : date de début et de fin non renseignée dans PayFit", "(absences ABS-TEST-1, ABS-TEST-2)", `2026-11 : ${BASE("Prénom FICTIF")} ; ${BASE("Autre FICTIF")}`, "N-1 : contrats continus non vérifiables (CTR-TEST-4 le 01/02/2025)"];
    for (const s of raw) {
      const once = publicReason(s);
      expect(once, s).not.toMatch(LEAK);
      expect(publicReason(once), s).toBe(once);
    }
  });
});

// --- Identifiant de contrat DSN en texte libre ---------------------------------------------------------------------------------------

describe("publicReason : identifiant de contrat en texte libre (numéro DSN : jusqu'à 128 caractères, parenthèses et nom compris)", () => {
  // Identifiants fictifs : un nom entre parenthèses ; une date entre parenthèses suivie d'un nom, complétée à 128 caractères.
  const ID_A = "CDI (Prénom FICTIF) n°1";
  const ID_B = "CDD (fin le 01/02/2026) Nom FICTIF ".padEnd(128, "9");
  const SUFFIX = " — jour voisin hors de la couverture ; sans la neutralisation (Paramètres), ces mouvements seraient comptés";
  const RAW = `sorties de 2026-03 : contrats continus non vérifiables (${ID_A} le 31/03/2026, ${ID_B} le 31/03/2026)${SUFFIX}`;
  const PUB = "2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)";

  it("texte du moteur : la liste se termine au suffixe fixe, jamais à la première parenthèse ; nombre et mois gardés", () => {
    expect(ID_B).toHaveLength(128);
    expect(publicReason(RAW)).toBe(PUB);
    // Reprises du turnover : raison d'une fenêtre, raison de l'écart.
    expect(publicReason(`2026-03 : sorties n.d. — ${RAW}`)).toBe(`2026-03 : sorties n.d. — ${PUB}`);
    expect(publicReason(`valeur n.d. — 2026-03 : sorties n.d. — ${RAW}`)).toBe(`valeur n.d. — 2026-03 : sorties n.d. — ${PUB}`);
    // Deux raisons du moteur dans un même texte : chacune s'arrête à son propre suffixe.
    const RAW2 = `entrées de 2026-04 : contrats continus non vérifiables (${ID_A} le 01/04/2026)${SUFFIX}`;
    expect(publicReason(`${RAW} ; ${RAW2}`)).toBe(`${PUB} ; 1 contrat continu non vérifiable en 2026-04 (entrées, détail dans KPI RH)`);
  });

  it("autres tournures : sans suffixe (retirée jusqu'à la fin du texte, sans nombre), sans « sens de mois », liste coupée", () => {
    expect(publicReason(`entrées de 2026-02 : contrats continus non vérifiables (${ID_B} le 02/02/2026)`)).toBe("entrées de 2026-02 : contrats continus non vérifiables (détail dans KPI RH)");
    expect(publicReason(`N-1 : contrats continus non vérifiables (${ID_A} le 01/02/2025, ${ID_B} le 03/02/2025) — jour voisin hors de la couverture`)).toBe(
      "N-1 : contrats continus non vérifiables (2 contrats, détail dans KPI RH) — jour voisin hors de la couverture",
    );
    expect(publicReason(`N-1 : contrats continus non vérifiables (${ID_B} le 01/02/2025).`)).toBe("N-1 : contrats continus non vérifiables (détail dans KPI RH)");
    // Date entre parenthèses dans un identifiant, suivie d'une virgule : la liste n'est pas coupée à cette date (le nom ne reste pas).
    expect(publicReason("N-1 : contrats continus non vérifiables (CDD (fin le 01/02/2026), Nom FICTIF le 03/02/2025)")).toBe("N-1 : contrats continus non vérifiables (détail dans KPI RH)");
    expect(publicReason("sorties de 2026-03 : contrats continus non vérifiables (CDD (fin le 01/03/2026); Nom FICTIF le 31/03/2026) ; autre raison")).toBe("sorties de 2026-03 : contrats continus non vérifiables (détail dans KPI RH)");
    expect(publicReason(`sorties de 2026-03 : contrats continus non vérifiables (${ID_A} le 31/03/2026, CDD (Nom FIC…`)).toBe("sorties de 2026-03 : contrats continus non vérifiables (détail dans KPI RH)");
  });

  it("aucun nom ni identifiant ne reste ; le filtre est idempotent", () => {
    for (const s of [
      RAW,
      `2026-03 : sorties n.d. — ${RAW}`,
      `entrées de 2026-02 : contrats continus non vérifiables (${ID_B} le 02/02/2026)`,
      `N-1 : contrats continus non vérifiables (${ID_A} le 01/02/2025`,
      "N-1 : contrats continus non vérifiables (CDD (fin le 01/02/2026), Nom FICTIF le 03/02/2025)",
      `contrat continu neutralisé (avec ${ID_B} le 01/03/2026)`,
      `2026-11 : ${BASE("Jean FICTIF — CDI (n° 2) : avenant")}`,
    ]) {
      const once = publicReason(s);
      expect(once, s).not.toMatch(LEAK);
      expect(once, s).not.toContain("Prénom");
      expect(publicReason(once), s).toBe(once);
    }
  });
});

describe("publicReason : contrat neutralisé et libellé de base en texte libre (parenthèses, espaces, « — », « : »)", () => {
  it("contrat continu neutralisé : identifiant DSN avec espaces, parenthèses, « — » et « : » retiré jusqu'à « le JJ/MM/AAAA) »", () => {
    const pub = "contrat continu neutralisé (avec un autre contrat le 01/03/2026)";
    expect(publicReason("contrat continu neutralisé (avec CDI Prénom FICTIF le 01/03/2026)")).toBe(pub);
    expect(publicReason("contrat continu neutralisé (avec CDI (Prénom FICTIF) — n° 12 : avenant le 01/03/2026)")).toBe(pub);
    expect(publicReason(`2026-03 : ${"contrat continu neutralisé (avec CDD Nom FICTIF : 2 le 31/03/2026)"} ; autre raison`)).toBe("2026-03 : contrat continu neutralisé (avec un autre contrat le 31/03/2026) ; autre raison");
    // Date entre parenthèses dans l'identifiant : elle ne termine pas le libellé (le nom qui suit ne reste pas).
    expect(publicReason("contrat continu neutralisé (avec CDD (fin le 01/02/2026) Nom FICTIF le 01/03/2026)")).toBe(pub);
    // Aucune fin reconnue (libellé coupé) : retiré jusqu'à la fin du texte, sans date.
    const cut = "contrat continu neutralisé (avec un autre contrat, détail dans KPI RH)";
    expect(publicReason("contrat continu neutralisé (avec CDD (fin le 01/02/2026) Nom FIC")).toBe(cut);
    for (const s of [cut, `${pub} ; autre raison`, `${cut}`]) expect(publicReason(s), s).toBe(s);
  });

  it("base n.d. : le libellé (« — », « : », parenthèses compris) part avec tout son segment ; mois et nom du scénario gardés", () => {
    const one = "1 contrat sans base de projection (détail dans Hypothèses budgétaires)";
    expect(publicReason(`2026-11 : ${BASE("Jean FICTIF — CDI")}`)).toBe(`2026-11 : ${one}`);
    expect(publicReason(`2026-11 : ${BASE("Jean : FICTIF (CDD) — n° 2")}`)).toBe(`2026-11 : ${one}`);
    expect(publicReason(BASE("Prénom FICTIF (temps partiel) : avenant — 2"))).toBe(one);
    // Deux contrats du même mois, libellés avec « — » et « : » : comptés ensemble ; une autre raison du mois reste telle quelle.
    expect(publicReason(`2026-12 : ${BASE("A FICTIF — x")} ; ${BASE("B : FICTIF")} ; hors de l'horizon du scénario`)).toBe(
      "2026-12 : 2 contrats sans base de projection (détail dans Hypothèses budgétaires) ; hors de l'horizon du scénario",
    );
    expect(publicReason(`Scénario « Plan » : avr. 2026 : ${BASE("Jean FICTIF — CDI")}`)).toBe(`Scénario « Plan » : avr. 2026 : ${one}`);
    for (const s of [`2026-11 : ${BASE("Jean FICTIF — CDI")}`, `atterrissage n.d. — ${BASE("Jean : FICTIF (CDD) — n° 2")}`]) {
      const once = publicReason(s);
      expect(once, s).not.toMatch(LEAK);
      expect(publicReason(once), s).toBe(once);
    }
  });
});

// --- Tout le modèle d'un chapitre ----------------------------------------------------------------------------------------------------

const R_ABS = "2026-03 : absence ABS-TEST-1 rattachée au contrat CTR-TEST-1 inconnu du référentiel";
const R_DATE = "absence ABS-TEST-2 : date de début et de fin non renseignée dans PayFit";
const R_BASE = `2026-12 : ${BASE("Prénom FICTIF")}`;
const R_LIST = "≥ : 2 demi-journée(s) incertaine(s) (absences ABS-TEST-3, ABS-TEST-4)";
// Modèle de chapitre fictif : un identifiant ou un nom dans chaque sorte de chaîne (cellules, cartes, alertes, séries, blocs…).
const model = () => ({
  chapter: "synthese" as const,
  tiles: [{ id: "abs", label: "Absentéisme", sub: R_LIST, value: { text: "n.d.", kind: "nd", reason: R_ABS }, variations: [{ label: "N-1", text: null, reason: R_DATE, tone: "flat" }], note: CONT, spark: { label: "Taux", values: [1, null, 3] } }],
  alerts: [{ id: "a1", level: "a-completer", label: "Atterrissage non calculé", text: R_BASE, href: "/e/demo/x#y" }],
  tables: [
    {
      id: "t1",
      title: "Tableau fictif",
      columns: [{ key: "l", header: "Ligne", kind: "text" }, { key: "v", header: "Valeur", kind: "eur" }],
      rows: [{ cells: ["Masse", 123456] }, { cells: [R_LIST, { nd: R_ABS }] }, { cells: ["Écart", { exact: -0.0125 }] }],
      foot: { cells: ["Total", { nd: R_BASE }] },
      notes: [CONT],
    },
  ],
  charts: [{ id: "c1", title: "Graphique", kind: "barres", unit: "eur", categories: ["janv. 2026"], series: [{ key: "s", name: R_DATE, values: [100, null] }], tableId: "t1" }],
  limits: [R_DATE],
  nd: { reason: R_BASE, action: { href: "/e/demo/parametres", label: "Paramètres" } },
  terms: ["masse"],
  blocks: [{ id: "cartes", title: "Cartes", tables: [], charts: [], nd: [{ label: "Absentéisme", reason: R_ABS }], notes: [R_LIST] }],
  tileNd: [`Absentéisme : ${R_ABS}`],
  prevu: [{ id: "p", label: "Commentaire", reason: R_DATE, term: "x" }],
  mentions: [{ id: "m", text: R_BASE }],
  servicesNote: null,
  trend: true,
  print: { max: 3, folded: 0 },
});

describe("scrubModel : publicReason sur toutes les chaînes d'un modèle de chapitre", () => {
  it("aucun identifiant ni nom ne reste ; nombres, n.d. (forme), booléens et null intacts ; l'original n'est pas modifié", () => {
    const m = model();
    const before = JSON.stringify(m);
    const out = scrubModel(m);
    expect(JSON.stringify(out)).not.toMatch(LEAK);
    expect(JSON.stringify(m)).toBe(before); // copie : le modèle mémoïsé d'origine n'est pas touché
    expect(out.tables[0].rows.map((r) => r.cells)).toEqual([
      ["Masse", 123456],
      ["≥ : 2 demi-journée(s) incertaine(s) (2 absences, détail dans KPI RH)", { nd: "2026-03 : 1 absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)" }],
      ["Écart", { exact: -0.0125 }],
    ]);
    expect(out.tables[0].foot.cells[1]).toEqual({ nd: "2026-12 : 1 contrat sans base de projection (détail dans Hypothèses budgétaires)" });
    expect(out.tiles[0].value).toEqual({ text: "n.d.", kind: "nd", reason: "2026-03 : 1 absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)" });
    expect(out.tiles[0].note).toBe("2 contrats continus non vérifiables en 2026-03 (sorties, détail dans KPI RH)");
    expect(out.tiles[0].spark).toEqual({ label: "Taux", values: [1, null, 3] });
    expect(out.charts[0].series[0]).toEqual({ key: "s", name: "1 absence sans date de début et de fin renseignée dans PayFit (détail dans KPI RH)", values: [100, null] });
    expect(out.alerts[0]).toEqual({ id: "a1", level: "a-completer", label: "Atterrissage non calculé", text: "2026-12 : 1 contrat sans base de projection (détail dans Hypothèses budgétaires)", href: "/e/demo/x#y" });
    expect(out.nd.action).toEqual({ href: "/e/demo/parametres", label: "Paramètres" });
    expect([out.servicesNote, out.trend, out.print]).toEqual([null, true, { max: 3, folded: 0 }]);
  });

  it("Map, Set et objets d'une autre nature : chaînes filtrées dans Map et Set, date gardée telle quelle", () => {
    const at = new Date("2026-10-01T08:00:00Z");
    const out = scrubModel({ map: new Map([["k", R_ABS]]), set: new Set([R_DATE]), at, n: undefined });
    expect(out.map.get("k")).toBe("2026-03 : 1 absence rattachée à un contrat inconnu du référentiel (détail dans KPI RH)");
    expect([...out.set]).toEqual(["1 absence sans date de début et de fin renseignée dans PayFit (détail dans KPI RH)"]);
    expect(out.at).toBe(at);
    expect("n" in out).toBe(true);
  });
});

describe("memoPublicModel : un calcul par requête, modèle filtré pour l'écran et les exports", () => {
  it("même promesse pour un même contexte ; calcul relancé pour un autre contexte ; aucun identifiant", async () => {
    const build = vi.fn(async () => model());
    const memo = memoPublicModel(build);
    const ctx = {};
    const a = memo(ctx);
    expect(memo(ctx)).toBe(a);
    expect(JSON.stringify(await a)).not.toMatch(LEAK);
    expect(build).toHaveBeenCalledTimes(1);
    await memo({});
    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe("chapitres : le filtre commun leur parvient par import", () => {
  it("chaque fichier de chapitre mémoïse son modèle par memoPublicModel (src/lib/croisee/public.ts) ; la Synthèse ré-exporte publicReason", () => {
    for (const f of ["absences", "budget", "effectifs", "masse", "paie", "synthese"]) {
      const src = readFileSync(`src/lib/viz/croisee-${f}.ts`, "utf8");
      expect(src, f).toMatch(/import \{ memoPublicModel as memoByContext(, publicReason)? \} from "@\/lib\/croisee\/public";/);
      expect(src, f).not.toContain('from "@/lib/croisee/memo"');
    }
    expect(readFileSync("src/lib/viz/croisee-synthese.ts", "utf8")).toContain('export { publicReason } from "@/lib/croisee/public";');
  });
});
