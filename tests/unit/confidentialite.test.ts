import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Lecture et écriture en base simulées : getSettingsMeta renvoie les lignes enregistrées (clé complète → valeur), comme la table
// workspace_setting ; setSetting y écrit. Les suppressions passent par le transaction simulée de withWorkspace.
const stored = vi.hoisted(() => ({
  rows: new Map<string, { value: unknown; updatedAt: Date; updatedBy: string | null }>(),
  asked: [] as { ws: string; keys: string[] }[],
  written: [] as { ws: string; key: string; value: unknown; actor: string }[],
  deleted: 0,
  events: [] as { ws: string; actor: string | null; kind: string; detail: unknown }[],
}));
vi.mock("@/lib/settings", () => ({
  getSettingsMeta: async (ws: string, keys: string[]) => {
    stored.asked.push({ ws, keys });
    return new Map([...stored.rows].filter(([k]) => keys.includes(k)));
  },
  setSetting: async (ws: string, key: string, value: unknown, actor: string) => {
    stored.written.push({ ws, key, value, actor });
    stored.rows.set(key, { value, updatedAt: new Date("2026-10-27T09:00:00Z"), updatedBy: actor });
    stored.events.push({ ws, actor, kind: "setting.changed", detail: { key, value } });
  },
}));
vi.mock("@/db/workspace-scope", () => ({
  withWorkspace: async (_ws: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      delete: () => ({
        where: async () => {
          stored.deleted += 1;
          stored.rows.delete("rh.confidentialite.seuil");
        },
      }),
    }),
}));
vi.mock("@/lib/events", () => ({
  recordEvent: async (ws: string, actor: string | null, kind: string, detail: unknown) => {
    stored.events.push({ ws, actor, kind, detail });
  },
}));

import {
  CONFIDENTIALITE_KEY,
  CONFIDENTIALITE_KEYS,
  CONFIDENTIALITE_LEGACY_KEY,
  CONFIDENTIALITE_TERM,
  confidentialiteHref,
  confidentialiteReason,
  confidentialiteSettingReason,
  getConfidentialite,
  getConfidentialiteRead,
  isHidden,
  linkFromReferential,
  maskGroups,
  maskInput,
  maskReason,
  maskRelations,
  maskSize,
  membersByGroup,
  parseConfidentialite,
  personOf,
  personsOfContracts,
  readConfidentialite,
  SEUIL_ILLISIBLE,
  SEUIL_NON_DEFINI,
  SEUIL_NON_VERIFIABLE,
  setConfidentialite,
} from "@/lib/confidentialite";
import * as structure from "@/lib/croisee/structure";
import type { RhBuildData } from "@/lib/rh/referential/types";

const AT = new Date("2026-10-20T08:00:00Z");
const row = (value: unknown, updatedBy: string | null = "u1") => ({ value, updatedAt: AT, updatedBy });
const reset = () => {
  stored.rows = new Map();
  stored.asked.length = 0;
  stored.written.length = 0;
  stored.deleted = 0;
  stored.events.length = 0;
};

describe("seuil de confidentialité : clés, raisons et lien", () => {
  it("une clé d'application et l'ancienne clé de la croisée, lues dans cet ordre", () => {
    expect(CONFIDENTIALITE_KEY).toBe("rh.confidentialite.seuil");
    expect(CONFIDENTIALITE_LEGACY_KEY).toBe("rh.croisee.confidentialite");
    expect(CONFIDENTIALITE_KEYS).toEqual(["rh.confidentialite.seuil", "rh.croisee.confidentialite"]);
    expect(CONFIDENTIALITE_TERM).toBe("confidentialite");
  });
  it("raisons du n.d. dû au paramètre et lien vers la section Confidentialité des Paramètres", () => {
    expect(SEUIL_NON_DEFINI).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(SEUIL_ILLISIBLE).toBe("seuil de confidentialité illisible : à ré-enregistrer (Paramètres)");
    expect(confidentialiteHref("demo")).toBe("/e/demo/parametres#confidentialite");
    expect(confidentialiteSettingReason({ kind: "absent" })).toBe(SEUIL_NON_DEFINI);
    expect(confidentialiteSettingReason({ kind: "invalid", raw: "5" })).toBe(SEUIL_ILLISIBLE);
    expect(confidentialiteSettingReason({ kind: "set", value: 5, updatedAt: null, updatedBy: null })).toBeNull();
  });
  it("raison d'un masquage : la même pour le masquage principal et secondaire ; effectif non dénombré", () => {
    expect(confidentialiteReason(5)).toBe("non affiché (seuil de confidentialité : 5 personnes)");
    expect(confidentialiteReason(1)).toBe("non affiché (seuil de confidentialité : 1 personne)");
    expect(maskReason("masked", 5)).toBe(maskReason("secondary", 5));
    expect(maskReason("unverifiable", 5)).toBe(SEUIL_NON_VERIFIABLE);
    expect(SEUIL_NON_VERIFIABLE).toBe("effectif du groupe non dénombré : seuil de confidentialité non vérifiable");
  });
});

describe("analyseur (cas écrits à la main) : entier ≥ 1, jamais converti", () => {
  it("accepte 1 et 5 ; refuse 0, négatif, décimal, texte, null, tableau, objet, booléen, infini", () => {
    expect(parseConfidentialite(5)).toBe(5);
    expect(parseConfidentialite(1)).toBe(1);
    for (const bad of [0, -3, 2.5, "5", null, undefined, Number.NaN, Infinity, [5], { v: 5 }, true, 2 ** 53]) expect(parseConfidentialite(bad), String(bad)).toBeNull();
  });
});

describe("lecture pure : nouvelle clé, puis repli sur l'ancienne clé", () => {
  it("rien d'enregistré : absent, sans clé d'origine (jamais une valeur de repli)", () => {
    expect(readConfidentialite(new Map())).toEqual({ setting: { kind: "absent" }, source: null });
  });
  it("nouvelle clé définie : lue avec sa traçabilité, source « seuil »", () => {
    expect(readConfidentialite(new Map([[CONFIDENTIALITE_KEY, row(5)]]))).toEqual({ setting: { kind: "set", value: 5, updatedAt: AT, updatedBy: "u1" }, source: "seuil" });
  });
  it("nouvelle clé absente, ancienne clé définie : reprise, source « croisee »", () => {
    expect(readConfidentialite(new Map([[CONFIDENTIALITE_LEGACY_KEY, row(3, null)]]))).toEqual({ setting: { kind: "set", value: 3, updatedAt: AT, updatedBy: null }, source: "croisee" });
  });
  it("les deux clés définies : la nouvelle l'emporte, même illisible (jamais remplacée par l'ancienne)", () => {
    const both = new Map([[CONFIDENTIALITE_KEY, row(5)], [CONFIDENTIALITE_LEGACY_KEY, row(3)]]);
    expect(readConfidentialite(both).setting).toEqual({ kind: "set", value: 5, updatedAt: AT, updatedBy: "u1" });
    const invalidOwn = new Map([[CONFIDENTIALITE_KEY, row("5")], [CONFIDENTIALITE_LEGACY_KEY, row(3)]]);
    expect(readConfidentialite(invalidOwn)).toEqual({ setting: { kind: "invalid", raw: "5" }, source: "seuil" });
  });
  it("ancienne clé illisible, nouvelle absente : illisible avec la valeur brute, source « croisee »", () => {
    expect(readConfidentialite(new Map([[CONFIDENTIALITE_LEGACY_KEY, row(0)]]))).toEqual({ setting: { kind: "invalid", raw: 0 }, source: "croisee" });
  });
  it("une ligne sans traçabilité : dates et auteur à null", () => {
    expect(readConfidentialite(new Map([[CONFIDENTIALITE_KEY, { value: 2 }]])).setting).toEqual({ kind: "set", value: 2, updatedAt: null, updatedBy: null });
  });
});

describe("lecture en base (simulée) : une requête pour les deux clés", () => {
  it("getConfidentialite renvoie la forme du réglage ; getConfidentialiteRead ajoute la clé d'origine", async () => {
    reset();
    stored.rows.set(CONFIDENTIALITE_LEGACY_KEY, row(4));
    expect(await getConfidentialite("w1")).toEqual({ kind: "set", value: 4, updatedAt: AT, updatedBy: "u1" });
    expect(await getConfidentialiteRead("w1")).toEqual({ setting: { kind: "set", value: 4, updatedAt: AT, updatedBy: "u1" }, source: "croisee" });
    expect(stored.asked).toEqual([
      { ws: "w1", keys: ["rh.confidentialite.seuil", "rh.croisee.confidentialite"] },
      { ws: "w1", keys: ["rh.confidentialite.seuil", "rh.croisee.confidentialite"] },
    ]);
  });
});

describe("écriture : nouvelle clé seulement, audit, jamais 0", () => {
  it("valeur illisible : refus avant toute lecture ou écriture", async () => {
    reset();
    for (const bad of [0, 2.5, -1, "5" as unknown as number]) await expect(setConfidentialite("w1", bad, "u1"), String(bad)).rejects.toThrow("Valeur invalide pour rh.confidentialite.seuil.");
    expect(stored.asked).toEqual([]);
    expect(stored.written).toEqual([]);
  });
  it("rien d'enregistré : écrit la nouvelle clé avec un événement setting.changed", async () => {
    reset();
    expect(await setConfidentialite("w1", 5, "u1")).toBe("written");
    expect(stored.written).toEqual([{ ws: "w1", key: "rh.confidentialite.seuil", value: 5, actor: "u1" }]);
    expect(stored.events).toEqual([{ ws: "w1", actor: "u1", kind: "setting.changed", detail: { key: "rh.confidentialite.seuil", value: 5 } }]);
  });
  it("même valeur déjà enregistrée sous la nouvelle clé : rien n'est réécrit ni tracé", async () => {
    reset();
    stored.rows.set(CONFIDENTIALITE_KEY, row(5));
    expect(await setConfidentialite("w1", 5, "u1")).toBe("unchanged");
    expect(stored.written).toEqual([]);
    expect(stored.events).toEqual([]);
  });
  it("même valeur lue par repli sur l'ancienne clé : la nouvelle clé est écrite (elle doit exister) ; l'ancienne n'est pas touchée", async () => {
    reset();
    stored.rows.set(CONFIDENTIALITE_LEGACY_KEY, row(5));
    expect(await setConfidentialite("w1", 5, "u1")).toBe("written");
    expect(stored.written).toEqual([{ ws: "w1", key: "rh.confidentialite.seuil", value: 5, actor: "u1" }]);
    expect(stored.rows.get(CONFIDENTIALITE_LEGACY_KEY)).toEqual(row(5));
    expect((await getConfidentialiteRead("w1")).source).toBe("seuil");
  });
  it("valeur illisible enregistrée sous la nouvelle clé : réécrite", async () => {
    reset();
    stored.rows.set(CONFIDENTIALITE_KEY, row("5"));
    expect(await setConfidentialite("w1", 5, "u1")).toBe("written");
  });
  it("null : supprime la nouvelle clé (événement à valeur null), jamais remplacée par 0 ; rien à supprimer = inchangé", async () => {
    reset();
    expect(await setConfidentialite("w1", null, "u1")).toBe("unchanged");
    expect(stored.deleted).toBe(0);
    stored.rows.set(CONFIDENTIALITE_KEY, row(5));
    expect(await setConfidentialite("w1", null, "u1")).toBe("deleted");
    expect(stored.deleted).toBe(1);
    expect(stored.events).toEqual([{ ws: "w1", actor: "u1", kind: "setting.changed", detail: { key: "rh.confidentialite.seuil", value: null } }]);
    expect(await getConfidentialite("w1")).toEqual({ kind: "absent" });
  });
  it("null avec l'ancienne clé encore présente : seule la nouvelle clé est supprimée, l'ancienne redevient lue par repli (annoncé à l'écran)", async () => {
    reset();
    stored.rows.set(CONFIDENTIALITE_KEY, row(5));
    stored.rows.set(CONFIDENTIALITE_LEGACY_KEY, row(3));
    expect(await setConfidentialite("w1", null, "u1")).toBe("deleted");
    expect(await getConfidentialiteRead("w1")).toEqual({ setting: { kind: "set", value: 3, updatedAt: AT, updatedBy: "u1" }, source: "croisee" });
    // Ancienne clé seule : null ne supprime rien (écriture de la nouvelle clé seulement).
    expect(await setConfidentialite("w1", null, "u1")).toBe("unchanged");
    expect(stored.deleted).toBe(1);
  });
});

// --- Personnes distinctes d'un groupe de contrats ---------------------------------------------------------------------------------
// Référentiel fictif écrit à la main : cinq contrats, quatre reliés à trois personnes (P2 a deux contrats), un contrat sans personne.
const contract = (externalId: string, personKey: string | null) => ({ contractKey: `payfit:${externalId}`, externalId, personKey }) as RhBuildData["contracts"][number];
const DATA = { contracts: [contract("C1", "P1"), contract("C2", "P2"), contract("C3", "P2"), contract("C4", "P3"), contract("C5", null)] };

describe("personnes distinctes d'un groupe de contrats", () => {
  const link = linkFromReferential(DATA);
  it("lien contrat → personne depuis le référentiel : un contrat sans personne n'y figure pas", () => {
    expect([...link]).toEqual([["C1", "P1"], ["C2", "P2"], ["C3", "P2"], ["C4", "P3"]]);
  });
  it("contrats reliés, tous distincts : autant de personnes, triées, aucun non relié", () => {
    expect(personsOfContracts(["C4", "C1"], link)).toEqual({ persons: ["P1", "P3"], unlinked: 0 });
  });
  it("deux contrats d'une même personne : une seule personne (C2 et C3 = P2)", () => {
    expect(personsOfContracts(["C2", "C3"], link)).toEqual({ persons: ["P2"], unlinked: 0 });
    expect(personsOfContracts(["C1", "C2", "C3", "C4"], link)).toEqual({ persons: ["P1", "P2", "P3"], unlinked: 0 });
  });
  it("contrat non relié (sans personne, ou inconnu du référentiel) : compté à part, n'apporte aucune personne", () => {
    expect(personsOfContracts(["C1", "C5"], link)).toEqual({ persons: ["P1"], unlinked: 1 });
    expect(personsOfContracts(["C9"], link)).toEqual({ persons: [], unlinked: 1 });
  });
  it("un contrat cité deux fois compte une fois (reliés comme non reliés) ; groupe vide", () => {
    expect(personsOfContracts(["C1", "C1", "C5", "C5"], link)).toEqual({ persons: ["P1"], unlinked: 1 });
    expect(personsOfContracts([], link)).toEqual({ persons: [], unlinked: 0 });
    expect(personsOfContracts(new Set(["C2", "C3"]), link)).toEqual({ persons: ["P2"], unlinked: 0 });
  });
  it("taille pour le masquage (seuil 2) : personnes reliées ; non dénombrée (null) quand des contrats non reliés existent sous le seuil", () => {
    expect(maskSize({ persons: ["P1", "P2"], unlinked: 0 }, 2)).toBe(2);
    expect(maskSize({ persons: ["P1"], unlinked: 0 }, 2)).toBe(1); // masqué (1 < 2), dénombré
    expect(maskSize({ persons: [], unlinked: 0 }, 2)).toBe(0); // groupe vide : ne désigne personne
    expect(maskSize({ persons: ["P1"], unlinked: 1 }, 2)).toBeNull(); // 1 personne reliée + 1 contrat non relié : non vérifiable
    expect(maskSize({ persons: [], unlinked: 2 }, 2)).toBeNull();
    expect(maskSize({ persons: ["P1", "P2"], unlinked: 3 }, 2)).toBe(2); // deux personnes reliées suffisent, quels que soient les autres
  });
  it("entrée de masquage : taille, valeur et personnes ; le moteur partagé rend « unverifiable » pour un groupe non dénombré", () => {
    const g = personsOfContracts(["C1", "C5"], link);
    expect(maskInput(g, 2, 7)).toEqual({ size: null, value: 7, members: ["P1"] });
    const status = maskGroups([maskInput(g, 2, 7), maskInput(personsOfContracts(["C2", "C3", "C4"], link), 2, 3)], 2, false);
    expect(status).toEqual(["unverifiable", "shown"]);
    expect(status.map(isHidden)).toEqual([true, false]);
    expect(maskReason(status[0], 2)).toBe(SEUIL_NON_VERIFIABLE);
    // Total publié : un seul groupe masqué d'une personne reliée, l'autre (P2, P3) est masqué à son tour ; ensemble : 3 personnes ≥ 2.
    const withTotal = maskGroups([maskInput(personsOfContracts(["C1"], link), 2, 1), maskInput(personsOfContracts(["C2", "C3", "C4"], link), 2, 3)], 2, true);
    expect(withTotal).toEqual(["masked", "secondary"]);
    expect(maskReason(withTotal[0], 2)).toBe(maskReason(withTotal[1], 2));
  });
});

// --- Une seule implémentation du masquage, aucune base chargée à l'import ----------------------------------------------------------
describe("module partagé : ré-exports et pureté à l'import", () => {
  it("ré-exporte les fonctions de src/lib/croisee/structure.ts (mêmes fonctions, aucune copie)", () => {
    expect(maskGroups).toBe(structure.maskGroups);
    expect(maskRelations).toBe(structure.maskRelations);
    expect(isHidden).toBe(structure.isHidden);
    expect(maskReason).toBe(structure.maskReason);
    expect(confidentialiteReason).toBe(structure.confidentialiteReason);
    expect(SEUIL_NON_VERIFIABLE).toBe(structure.SEUIL_NON_VERIFIABLE);
    expect(membersByGroup).toBe(structure.membersByGroup);
    expect(personOf).toBe(structure.personOf);
  });
  it("aucune importation de valeur hors du dossier et de structure.ts : les chapitres et les exports peuvent l'importer sans base", () => {
    const dir = "src/lib/confidentialite";
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.sort()).toEqual(["index.ts", "persons.ts", "setting.ts"]);
    for (const f of files) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      for (const m of src.matchAll(/^(?:import|export) (?!type )[^;]*from "([^"]+)";/gm)) expect(m[1], `${f} : ${m[1]}`).toMatch(/^(\.\/|@\/lib\/croisee\/structure$)/);
    }
  });
});
