import { describe, expect, it, vi } from "vitest";

// Lecture en base simulée : getSettingsMeta renvoie les lignes enregistrées (clé complète → valeur), comme la table workspace_setting.
const stored = vi.hoisted(() => ({ rows: new Map<string, { value: unknown; updatedAt: Date; updatedBy: string | null }>(), asked: [] as { ws: string; keys: string[] }[] }));
vi.mock("@/lib/settings", () => ({
  getSettingsMeta: async (ws: string, keys: string[]) => {
    stored.asked.push({ ws, keys });
    return new Map([...stored.rows].filter(([k]) => keys.includes(k)));
  },
}));

import {
  CROISEE_KEYS,
  CROISEE_PARSERS,
  croiseeSettingLines,
  croiseeSettingReason,
  croiseeSettingsHref,
  getCroiseeSettings,
  readCroiseeSettings,
  settingValue,
  type CroiseeSettingKey,
} from "@/lib/croisee-settings";

const AT = new Date("2026-10-20T08:00:00Z");
const row = (value: unknown) => ({ value, updatedAt: AT, updatedBy: "u1" });

describe("paramètres de la Masse salariale croisée : clés", () => {
  it("quatre clés rh.croisee.*, sans valeur par défaut", () => {
    expect(CROISEE_KEYS).toEqual({
      confidentialite: "rh.croisee.confidentialite",
      seuilsEffectif: "rh.croisee.seuilsEffectif",
      margeAlerte: "rh.croisee.margeAlerte",
      horizonEcheances: "rh.croisee.horizonEcheances",
    });
    // Rien d'enregistré : chaque clé est « absent », jamais une valeur de repli.
    const s = readCroiseeSettings(new Map());
    for (const k of Object.keys(CROISEE_KEYS) as CroiseeSettingKey[]) {
      expect(s[k]).toEqual({ kind: "absent" });
      expect(settingValue(s[k])).toBeNull();
    }
  });
});

describe("analyseurs (cas écrits à la main)", () => {
  it("seuil de confidentialité : entier ≥ 1", () => {
    const f = CROISEE_PARSERS.confidentialite;
    expect(f(5)).toBe(5);
    expect(f(1)).toBe(1);
    for (const bad of [0, -3, 2.5, "5", null, undefined, Number.NaN, Infinity, [5], { v: 5 }, true]) expect(f(bad), String(bad)).toBeNull();
  });

  it("marge d'alerte : entier ≥ 0 (zéro est une valeur explicite)", () => {
    const f = CROISEE_PARSERS.margeAlerte;
    expect(f(0)).toBe(0);
    expect(f(3)).toBe(3);
    for (const bad of [-1, 1.5, "3", null, false]) expect(f(bad), String(bad)).toBeNull();
  });

  it("horizon des échéances : entier de jours ≥ 1", () => {
    const f = CROISEE_PARSERS.horizonEcheances;
    expect(f(90)).toBe(90);
    expect(f(1)).toBe(1);
    for (const bad of [0, -90, 30.5, "90", null]) expect(f(bad), String(bad)).toBeNull();
  });

  it("seuils d'effectif : liste { libelle, valeur }, libellés nettoyés, triée par valeur ; liste vide acceptée", () => {
    const f = CROISEE_PARSERS.seuilsEffectif;
    expect(f([{ libelle: " Seuil B ", valeur: 50 }, { libelle: "Seuil A", valeur: 11 }])).toEqual([
      { libelle: "Seuil A", valeur: 11 },
      { libelle: "Seuil B", valeur: 50 },
    ]);
    expect(f([])).toEqual([]);
  });

  it("seuils d'effectif illisibles : jamais corrigés en silence", () => {
    const f = CROISEE_PARSERS.seuilsEffectif;
    const bad: unknown[] = [
      "11,50",
      { libelle: "A", valeur: 11 }, // objet seul, pas une liste
      [{ libelle: "", valeur: 11 }], // libellé vide
      [{ libelle: "   ", valeur: 11 }],
      [{ libelle: "A", valeur: 0 }], // valeur < 1
      [{ libelle: "A", valeur: 11.5 }],
      [{ libelle: "A", valeur: "11" }],
      [{ libelle: "A" }],
      [{ libelle: "A", valeur: 11, autre: 1 }], // champ inconnu
      [{ libelle: "A", valeur: 11 }, { libelle: "B", valeur: 11 }], // deux seuils de même valeur
      [{ libelle: "x".repeat(81), valeur: 11 }],
      Array.from({ length: 21 }, (_, i) => ({ libelle: `S${i}`, valeur: i + 1 })), // plus de vingt seuils
      [null],
      [[11]],
    ];
    for (const v of bad) expect(f(v), JSON.stringify(v)).toBeNull();
  });
});

describe("lecture : absent / défini / illisible pour chaque clé", () => {
  it("valeurs définies : reprises avec leur traçabilité", () => {
    const s = readCroiseeSettings(
      new Map([
        ["rh.croisee.confidentialite", row(5)],
        ["rh.croisee.seuilsEffectif", row([{ libelle: "Seuil A", valeur: 11 }])],
        ["rh.croisee.margeAlerte", row(2)],
        ["rh.croisee.horizonEcheances", row(90)],
      ]),
    );
    expect(s.confidentialite).toEqual({ kind: "set", value: 5, updatedAt: AT, updatedBy: "u1" });
    expect(s.seuilsEffectif).toEqual({ kind: "set", value: [{ libelle: "Seuil A", valeur: 11 }], updatedAt: AT, updatedBy: "u1" });
    expect(s.margeAlerte).toEqual({ kind: "set", value: 2, updatedAt: AT, updatedBy: "u1" });
    expect(s.horizonEcheances).toEqual({ kind: "set", value: 90, updatedAt: AT, updatedBy: "u1" });
    for (const k of Object.keys(CROISEE_KEYS) as CroiseeSettingKey[]) expect(croiseeSettingReason(k, s[k])).toBeNull();
  });

  it("valeur illisible : « invalid » avec la valeur brute, jamais remplacée par un défaut", () => {
    const s = readCroiseeSettings(
      new Map([
        ["rh.croisee.confidentialite", row("5")],
        ["rh.croisee.seuilsEffectif", row([{ libelle: "Seuil A", valeur: -1 }])],
        ["rh.croisee.margeAlerte", row(-2)],
        ["rh.croisee.horizonEcheances", row(null)],
      ]),
    );
    expect(s.confidentialite).toEqual({ kind: "invalid", raw: "5" });
    expect(s.seuilsEffectif).toEqual({ kind: "invalid", raw: [{ libelle: "Seuil A", valeur: -1 }] });
    expect(s.margeAlerte).toEqual({ kind: "invalid", raw: -2 });
    expect(s.horizonEcheances).toEqual({ kind: "invalid", raw: null });
    for (const k of Object.keys(CROISEE_KEYS) as CroiseeSettingKey[]) expect(settingValue(s[k])).toBeNull();
    expect(croiseeSettingReason("confidentialite", s.confidentialite)).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
  });

  it("clés mêlées : chacune lue indépendamment ; une clé inconnue est ignorée", () => {
    const s = readCroiseeSettings(new Map([["rh.croisee.margeAlerte", row(0)], ["rh.croisee.autre", row(1)], ["rh.croisee.horizonEcheances", row(1.5)]]));
    expect(s.confidentialite).toEqual({ kind: "absent" });
    expect(s.seuilsEffectif).toEqual({ kind: "absent" });
    expect(s.margeAlerte).toEqual({ kind: "set", value: 0, updatedAt: AT, updatedBy: "u1" });
    expect(s.horizonEcheances).toEqual({ kind: "invalid", raw: 1.5 });
  });

  it("raisons des n.d. : textes de la spécification (paramètre absent)", () => {
    const absent = { kind: "absent" } as const;
    expect(croiseeSettingReason("confidentialite", absent)).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(croiseeSettingReason("seuilsEffectif", absent)).toBe("seuils d'effectif non définis (Paramètres)");
    expect(croiseeSettingReason("horizonEcheances", absent)).toBe("horizon des échéances non défini (Paramètres)");
    expect(croiseeSettingReason("margeAlerte", absent)).toBe("marge d'alerte des seuils d'effectif non définie (Paramètres)");
    expect(croiseeSettingsHref("demo")).toBe("/e/demo/parametres#croisee");
  });

  it("liste de seuils vide : lisible mais « seuils d'effectif non définis » (raison non nulle, aucune valeur utilisable)", () => {
    const s = readCroiseeSettings(new Map([["rh.croisee.seuilsEffectif", row([])]]));
    expect(s.seuilsEffectif).toEqual({ kind: "set", value: [], updatedAt: AT, updatedBy: "u1" });
    expect(croiseeSettingReason("seuilsEffectif", s.seuilsEffectif)).toBe("seuils d'effectif non définis (Paramètres)");
    expect(settingValue(s.seuilsEffectif)).toBeNull();
    // Une liste non vide reste une valeur définie.
    const one = readCroiseeSettings(new Map([["rh.croisee.seuilsEffectif", row([{ libelle: "Seuil A", valeur: 11 }])]]));
    expect(croiseeSettingReason("seuilsEffectif", one.seuilsEffectif)).toBeNull();
    expect(settingValue(one.seuilsEffectif)).toEqual([{ libelle: "Seuil A", valeur: 11 }]);
  });

  it("lignes du bloc « Sources et hypothèses de travail » : valeur écrite, ou n.d. avec la raison (jamais de défaut)", () => {
    const set = readCroiseeSettings(
      new Map([
        ["rh.croisee.confidentialite", row(5)],
        ["rh.croisee.seuilsEffectif", row([{ libelle: "Seuil B", valeur: 50 }, { libelle: "Seuil A", valeur: 11 }])],
        ["rh.croisee.margeAlerte", row(0)],
        ["rh.croisee.horizonEcheances", row(1)],
      ]),
    );
    expect(croiseeSettingLines(set)).toEqual([
      { key: "confidentialite", label: "Seuil de confidentialité", text: "5 personnes", reason: null },
      { key: "seuilsEffectif", label: "Seuils d'effectif suivis", text: "« Seuil A » : 11 salariés ; « Seuil B » : 50 salariés", reason: null },
      { key: "margeAlerte", label: "Marge d'alerte des seuils d'effectif", text: "0 salarié", reason: null },
      { key: "horizonEcheances", label: "Horizon des échéances de contrat", text: "1 jour", reason: null },
    ]);
    const other = readCroiseeSettings(new Map([["rh.croisee.confidentialite", row(1)], ["rh.croisee.seuilsEffectif", row([])], ["rh.croisee.margeAlerte", row("2")]]));
    expect(croiseeSettingLines(other)).toEqual([
      { key: "confidentialite", label: "Seuil de confidentialité", text: "1 personne", reason: null },
      { key: "seuilsEffectif", label: "Seuils d'effectif suivis", text: null, reason: "seuils d'effectif non définis (Paramètres)" },
      { key: "margeAlerte", label: "Marge d'alerte des seuils d'effectif", text: null, reason: "marge d'alerte des seuils d'effectif illisible : à ré-enregistrer (Paramètres)" },
      { key: "horizonEcheances", label: "Horizon des échéances de contrat", text: null, reason: "horizon des échéances non défini (Paramètres)" },
    ]);
  });

  it("getCroiseeSettings : une seule lecture des quatre clés de l'espace", async () => {
    stored.rows = new Map([["rh.croisee.confidentialite", row(3)], ["rh.croisee.horizonEcheances", row("90")]]);
    stored.asked.length = 0;
    const s = await getCroiseeSettings("w1");
    expect(stored.asked).toEqual([{ ws: "w1", keys: ["rh.croisee.confidentialite", "rh.croisee.seuilsEffectif", "rh.croisee.margeAlerte", "rh.croisee.horizonEcheances"] }]);
    expect(s.confidentialite).toEqual({ kind: "set", value: 3, updatedAt: AT, updatedBy: "u1" });
    expect(s.seuilsEffectif).toEqual({ kind: "absent" });
    expect(s.horizonEcheances).toEqual({ kind: "invalid", raw: "90" });
  });
});
