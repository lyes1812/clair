import { describe, expect, it } from "vitest";
import { buildActualNonRecurring, type ActualEvent } from "@/lib/payroll/non-recurring";
import { actualNonRecurringSheet } from "@/lib/payroll/non-recurring-export";
import { declaredLink, maskNonRecurring, natureMonthMask } from "@/lib/payroll/non-recurring-mask";

// Éléments non récurrents du réel : seuil de confidentialité par nature, en personnes distinctes (contrats déclarés reliés par le
// référentiel), selon la règle canonique : une colonne par mois (natures du mois, total publié = « Coûts identifiés » du mois), la
// fenêtre déduite de ses mois, sans relation propre. Données fictives.
const SYNC = "11111111-1111-4111-8111-111111111111";
let n = 0;
const ev = (kind: ActualEvent["kind"], month: string, contractKeys: string[], euros: number | null) => ({
  event: { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, syncId: SYNC, month, kind, chargedCents: euros === null ? null : euros * 100, contractKeys, note: "" } as ActualEvent,
  amount: euros === null ? null : euros * 100,
  reason: euros === null ? "Montant chargé non saisi" : null,
});
const MONTHS = ["2026-01", "2026-02", "2026-03"];
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
// Contrat payfit:cA → personne P1, payfit:cB → P2, …, payfit:cL → P12 (clé du référentiel et identifiant de la source).
const LINK = declaredLink(LETTERS.map((x, i) => ({ contractKey: `payfit:c${x}`, externalId: `c${x}`, personKey: `P${i + 1}` })));
const c = (...xs: string[]) => xs.map((x) => `payfit:c${x}`);
const set = (value: number) => ({ kind: "set" as const, value, updatedAt: null, updatedBy: null });
const R = (seuil: number) => `non affiché (seuil de confidentialité : ${seuil} personne${seuil > 1 ? "s" : ""})`;
const R3 = R(3);
const NV = "effectif du groupe non dénombré : seuil de confidentialité non vérifiable";

describe("maskNonRecurring — colonne canonique de chaque mois, fenêtre déduite de ses mois", () => {
  // Cas de référence (seuil 3), calculé à la main. Ordre canonique des libellés : Autres < Licenciements < Ruptures < Tuilages.
  //   Janvier (Coûts identifiés publiés : 18 000 €)
  //     Ruptures      cA, cB, cC × 2 000 €   → P1, P2, P3      : 3 personnes, 6 000 €
  //     Licenciements cD 10 000 €            → P4              : 1 personne → masqué (principal)
  //     Autres        cE, cF, cG, cH × 500 € → P5…P8           : 4 personnes, 2 000 €
  //     Masqué {P4} = 1 < 3 : la plus petite cellule affichée qui apporte une personne est masquée, Autres (2 000 € < 6 000 €)
  //     → ensemble {P4, P5…P8} = 5 ≥ 3 personnes, 2 cellules : Autres secondaire, Ruptures affichée (18 000 − 6 000 = 12 000 € = deux
  //     natures masquées).
  //   Février (5 400 €)
  //     Ruptures      cA, cI, cJ × 1 000 €   → P1, P9, P10     : 3 personnes, 3 000 €
  //     Tuilages      cK + cL 1 500 €        → P11, P12        : 2 personnes → masqué (principal)
  //     Autres        cE, cF, cG × 300 €     → P5, P6, P7      : 3 personnes, 900 €
  //     Masqué {P11, P12} = 2 < 3 : Autres (900 € < 3 000 €) secondaire → {P5, P6, P7, P11, P12} = 5 ≥ 3.
  //   Mars (4 200 €)
  //     Ruptures      cB, cC, cI × 1 000 €   → P2, P3, P9      : 3 personnes, 3 000 €
  //     Autres        cE, cF, cG × 400 €     → P5, P6, P7      : 3 personnes, 1 200 € → rien de masqué
  //   Fenêtre janvier → mars : Ruptures affichée (tous ses mois le sont) ; Licenciements (janvier), Tuilages (février) et Autres
  //   (janvier, février) n.d. : aucun total de fenêtre ne redonne un mois masqué par différence.
  const rows = [
    ...c("A", "B", "C").map((k) => ev("rupture-conventionnelle", "2026-01", [k], 2000)),
    ev("licenciement", "2026-01", c("D"), 10000),
    ...c("E", "F", "G", "H").map((k) => ev("autre", "2026-01", [k], 500)),
    ...c("A", "I", "J").map((k) => ev("rupture-conventionnelle", "2026-02", [k], 1000)),
    ev("tuilage", "2026-02", c("K", "L"), 1500),
    ...c("E", "F", "G").map((k) => ev("autre", "2026-02", [k], 300)),
    ...c("B", "C", "I").map((k) => ev("rupture-conventionnelle", "2026-03", [k], 1000)),
    ...c("E", "F", "G").map((k) => ev("autre", "2026-03", [k], 400)),
  ];

  it("colonne de chaque mois : principal, secondaire dans l'ordre canonique, groupe vide affiché", () => {
    expect(Object.fromEntries(natureMonthMask(rows, "2026-01", LINK, 3))).toEqual({ licenciement: "masked", "rupture-conventionnelle": "shown", tuilage: "shown", autre: "secondary" });
    expect(Object.fromEntries(natureMonthMask(rows, "2026-02", LINK, 3))).toEqual({ licenciement: "shown", "rupture-conventionnelle": "shown", tuilage: "masked", autre: "secondary" });
    expect(Object.fromEntries(natureMonthMask(rows, "2026-03", LINK, 3))).toEqual({ licenciement: "shown", "rupture-conventionnelle": "shown", tuilage: "shown", autre: "shown" });
  });

  it("fenêtre janvier → mars : seule la nature dont tous les mois sont affichés est affichée ; mois de l'export lus dans leur colonne", () => {
    const m = maskNonRecurring(rows, MONTHS, LINK, set(3));
    expect(m["rupture-conventionnelle"]).toEqual({ reason: null, months: { "2026-01": null, "2026-02": null, "2026-03": null } });
    expect(m.licenciement).toEqual({ reason: R3, months: { "2026-01": R3, "2026-02": null, "2026-03": null } });
    expect(m.tuilage).toEqual({ reason: R3, months: { "2026-01": null, "2026-02": R3, "2026-03": null } });
    expect(m.autre).toEqual({ reason: R3, months: { "2026-01": R3, "2026-02": R3, "2026-03": null } });
  });

  it("le statut d'un mois ne dépend pas de la fenêtre ; une fenêtre est n.d. dès qu'un de ses mois l'est", () => {
    const windows = [["2026-01"], ["2026-02"], ["2026-03"], ["2026-01", "2026-02"], ["2026-02", "2026-03"], MONTHS];
    const single = Object.fromEntries(MONTHS.map((month) => [month, maskNonRecurring(rows, [month], LINK, set(3))]));
    for (const w of windows) {
      const m = maskNonRecurring(rows, w, LINK, set(3));
      for (const k of ["licenciement", "rupture-conventionnelle", "tuilage", "autre"] as const) {
        for (const month of w) expect(m[k].months[month], `${k} ${month} dans ${w.join("+")}`).toBe(single[month][k].reason);
        expect(m[k].reason).toBe(w.some((month) => single[month][k].reason !== null) ? R3 : null);
      }
    }
    // Mars seul : Autres (1 200 €) affichée ; février → mars : Autres n.d. (février masqué), le mois de février ne se lit pas par
    // différence (avant : la période recevait sa propre relation et pouvait afficher un total dont un mois était masqué ailleurs).
    expect(maskNonRecurring(rows, ["2026-03"], LINK, set(3)).autre.reason).toBeNull();
    expect(maskNonRecurring(rows, ["2026-02", "2026-03"], LINK, set(3)).autre.reason).toBe(R3);
  });

  it("deux binômes qui partagent un contrat : personnes distinctes du mois (3, pas 4)", () => {
    // Février : tuilage cA + cB et tuilage cA + cC → P1, P2, P3 ; Ruptures cD…cH (5 personnes) pour la colonne.
    const shared = [ev("tuilage", "2026-02", c("A", "B"), 1000), ev("tuilage", "2026-02", c("A", "C"), 1000), ...c("D", "E", "F", "G", "H").map((k) => ev("rupture-conventionnelle", "2026-02", [k], 100))];
    expect(maskNonRecurring(shared, ["2026-02"], LINK, set(3)).tuilage.reason).toBeNull();
    // Seuil 4 : 3 personnes < 4 → masqué ; Ruptures (5 personnes) masquée en second (le total du mois est publié).
    const m4 = maskNonRecurring(shared, ["2026-02"], LINK, set(4));
    expect([m4.tuilage.reason, m4["rupture-conventionnelle"].reason]).toEqual([R(4), R(4)]);
  });

  it("élément sans contrat : contributeur non relié, jamais protecteur (non vérifiable même au seuil 1) ; un autre mois a sa propre colonne", () => {
    // Janvier : Autres sans contrat, 1 000 € → aucune personne reliée, 1 contributeur non relié : non vérifiable, seule nature non vide
    // du mois, rien ne peut la protéger → toute la répartition de janvier est n.d., zéros compris (sinon 1 000 € − 0 − 0 − 0 la
    // redonnerait). Février : un seul licenciement (cA, 1 personne ≥ 1) dans sa propre colonne : affiché ; son total sur
    // janvier → mars est n.d. (janvier masqué), sur février seul il est affiché.
    const items = [ev("autre", "2026-01", [], 1000), ev("licenciement", "2026-02", c("A"), 5000)];
    const m = maskNonRecurring(items, MONTHS, LINK, set(1));
    expect(m.autre).toEqual({ reason: NV, months: { "2026-01": NV, "2026-02": null, "2026-03": null } });
    expect(m.licenciement).toEqual({ reason: R(1), months: { "2026-01": R(1), "2026-02": null, "2026-03": null } });
    expect(maskNonRecurring(items, ["2026-02"], LINK, set(1)).licenciement.reason).toBeNull();
    // Montant 0 explicite sans contrat : ne décrit personne, hors de la relation.
    expect(maskNonRecurring([ev("autre", "2026-01", [], 0)], MONTHS, LINK, set(3)).autre.reason).toBeNull();
  });

  it("une seule nature non vide sous le seuil : toute la répartition du mois est n.d., zéros compris", () => {
    // Seuil 3. Janvier : Ruptures cB, cC, cD (P2, P3, P4) 3 × 2 000 € → 3 personnes, seule nature du mois : affichée. Février :
    // Licenciements cA (P1) 10 000 €, seule nature non vide → masqué ; aucune autre nature n'apporte de personne : relation
    // impossible, les trois natures vides de février sont n.d. aussi (Coûts identifiés de février − 0 redonnerait le licenciement).
    // Fenêtre janvier → mars : toutes les natures n.d. (février masqué) ; export : Ruptures janvier 6 000 €, février n.d., mars sans
    // élément.
    const items = [...c("B", "C", "D").map((k) => ev("rupture-conventionnelle", "2026-01", [k], 2000)), ev("licenciement", "2026-02", c("A"), 10000)];
    expect(Object.fromEntries(natureMonthMask(items, "2026-01", LINK, 3))).toEqual({ licenciement: "shown", "rupture-conventionnelle": "shown", tuilage: "shown", autre: "shown" });
    expect(Object.fromEntries(natureMonthMask(items, "2026-02", LINK, 3))).toEqual({ licenciement: "masked", "rupture-conventionnelle": "secondary", tuilage: "secondary", autre: "secondary" });
    const m = maskNonRecurring(items, MONTHS, LINK, set(3));
    expect(Object.values(m).map((x) => x.reason)).toEqual([R3, R3, R3, R3]);
    expect(m["rupture-conventionnelle"].months).toEqual({ "2026-01": null, "2026-02": R3, "2026-03": null });
    const sheet = actualNonRecurringSheet({ lines: [], months: MONTHS, openMonths: [], grid: {}, serviceAxis: null } as never, items.map((r) => r.event), MONTHS, SYNC, { link: LINK, confidentialite: set(3), guard: null });
    expect(sheet.rows.find((r) => r[0] === "Ruptures conventionnelles")!.slice(1, 6)).toEqual([{ nd: R3 }, 600_000, { nd: R3 }, "Aucun élément identifié", { nd: R3 }]);
  });

  it("montant non saisi : la nature reste un groupe à protéger, jamais un zéro", () => {
    // Janvier : licenciement cA sans montant (1 personne) → masqué, comme un montant non nul.
    const m = maskNonRecurring([ev("licenciement", "2026-01", c("A"), null), ...rows.slice(4)], MONTHS, LINK, set(3));
    expect(m.licenciement.months["2026-01"]).toBe(R3);
    expect(m.licenciement.reason).toBe(R3);
  });

  it("seuil absent ou illisible : toute nature qui porte un élément de la fenêtre est n.d. avec la raison du paramètre", () => {
    const m = maskNonRecurring(rows, MONTHS, LINK, { kind: "absent" });
    const why = "seuil de confidentialité non défini (Paramètres)";
    expect(m.licenciement).toEqual({ reason: why, months: { "2026-01": why, "2026-02": null, "2026-03": null } });
    // Mars seul : aucun licenciement ni tuilage dans la fenêtre → rien à masquer.
    const mar = maskNonRecurring(rows, ["2026-03"], LINK, { kind: "absent" });
    expect([mar.licenciement.reason, mar.tuilage.reason, mar.autre.reason]).toEqual([null, null, why]);
    expect(maskNonRecurring(rows, MONTHS, LINK, { kind: "invalid", raw: "x" } as never).tuilage.reason).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
  });

  it("aucune clé de contrat ni identifiant ne sort du masque", () => {
    expect(JSON.stringify(maskNonRecurring(rows, MONTHS, LINK, set(3)))).not.toMatch(/payfit:|P[1-9]|00000000/);
  });
});

// Constat de la relecture (rv13) : trois fenêtres reconstituaient un licenciement d'une personne. Seuil 5, écran
// (buildActualNonRecurring → maskNonRecurring) et export (actualNonRecurringSheet).
//   Licenciements : janvier cA (P1) 100 € ; février cB…cF (P2…P6) 5 × 100 €. Ruptures : janvier cG…cK (P7…P11) 5 × 1 000 €.
//   Avant : janvier → licenciements n.d. ; janvier–février 600 € affichés (6 personnes) ; février 500 € → 600 − 500 = 100 € (P1).
//   Règle canonique, à la main : colonne de janvier (Coûts identifiés 5 100 € publiés) : Licenciements 1 personne masqué ; Ruptures
//   (5 personnes) masquée en second (sinon 5 100 − 5 000 = 100 €) → {P1, P7…P11} = 6 ≥ 5. Colonne de février : Licenciements
//   5 personnes, affiché. Fenêtre janvier–février : Licenciements et Ruptures n.d. (janvier masqué) ; février seul : 500 € affiché.
describe("constat rv13 : statut d'une nature identique sur les trois fenêtres", () => {
  const S = "11111111-1111-4111-8111-111111111111";
  let k = 0;
  const e = (kind: ActualEvent["kind"], month: string, key: string, euros: number): ActualEvent => ({ id: `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`, syncId: S, month, kind, chargedCents: euros * 100, contractKeys: [`payfit:c${key}`], note: "pièce fictive" });
  const events = [e("licenciement", "2026-01", "A", 100), ...["B", "C", "D", "E", "F"].map((x) => e("licenciement", "2026-02", x, 100)), ...["G", "H", "I", "J", "K"].map((x) => e("rupture-conventionnelle", "2026-01", x, 1000))];
  const J = { lines: [], months: ["2026-01", "2026-02"], openMonths: [], grid: {}, serviceAxis: null } as never;
  const screen = (months: string[]) => maskNonRecurring(buildActualNonRecurring(J, events, months, S).rows, months, LINK, set(5));
  const exported = (months: string[]) => {
    const row = actualNonRecurringSheet(J, events, months, S, { link: LINK, confidentialite: set(5), guard: null }).rows.find((r) => r[0] === "Licenciements")!;
    return { count: row[1], months: row.slice(2, 2 + months.length), total: row[2 + months.length] };
  };

  it("écran : janvier et janvier–février n.d. ; février seul affiché", () => {
    expect(screen(["2026-01"]).licenciement.reason).toBe(R(5));
    expect(screen(["2026-01", "2026-02"]).licenciement.reason).toBe(R(5));
    expect(screen(["2026-02"]).licenciement.reason).toBeNull();
    // Ruptures de janvier masquées en second dans la colonne de janvier, quelle que soit la fenêtre.
    expect(screen(["2026-01"])["rupture-conventionnelle"].reason).toBe(R(5));
    expect(screen(["2026-01", "2026-02"])["rupture-conventionnelle"].reason).toBe(R(5));
  });

  it("export : nombre et total de janvier–février n.d., mois de janvier n.d., mois de février lu dans sa colonne (500 €)", () => {
    const nd = { nd: R(5) };
    expect(exported(["2026-01"])).toEqual({ count: nd, months: [nd], total: nd });
    expect(exported(["2026-01", "2026-02"])).toEqual({ count: nd, months: [nd, 50_000], total: nd });
    expect(exported(["2026-02"])).toEqual({ count: 5, months: [50_000], total: 50_000 });
  });

  it("constat v2 (seuil 3, deux exports) : la rupture de janvier reste n.d. dans les deux exports", () => {
    // Licenciement C1 janvier 10 000 € ; Ruptures C2…C4 janvier 3 × 1 000 €, février 3 × 6 000 € ; Autres C5…C7 janvier 3 × 2 000 €.
    // Colonne de janvier (19 000 € publiés) : Licenciements (1 personne) masqué ; Ruptures (3 000 €) < Autres (6 000 €) : Ruptures
    // secondaire → {P1…P4} = 4 ≥ 3. Avant : l'export janvier–février publiait Ruptures janvier 3 000 €, d'où 19 000 − 3 000 − 6 000.
    const v: ActualEvent[] = [e("licenciement", "2026-01", "A", 10_000), ...["B", "C", "D"].flatMap((x) => [e("rupture-conventionnelle", "2026-01", x, 1_000), e("rupture-conventionnelle", "2026-02", x, 6_000)]), ...["E", "F", "G"].map((x) => e("autre", "2026-01", x, 2_000))];
    const sheet = (months: string[]) => actualNonRecurringSheet(J, v, months, S, { link: LINK, confidentialite: set(3), guard: null });
    const rc = (months: string[]) => sheet(months).rows.find((r) => r[0] === "Ruptures conventionnelles")!;
    expect(rc(["2026-01"]).slice(1, 4)).toEqual([{ nd: R3 }, { nd: R3 }, { nd: R3 }]);
    expect(rc(["2026-01", "2026-02"]).slice(1, 5)).toEqual([{ nd: R3 }, { nd: R3 }, 1_800_000, { nd: R3 }]);
    expect(sheet(["2026-01"]).rows.find((r) => r[0] === "Autres éléments identifiés")!.slice(1, 4)).toEqual([3, 600_000, 600_000]);
  });
});
