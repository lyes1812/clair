import { sql } from "drizzle-orm";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import { organization, user } from "@/db/schema";
import { listEvents } from "@/lib/events";
import type { Role } from "@/lib/roles";

// Paramètres de la Masse salariale croisée (P1), seuil de confidentialité de l'application (lot 12) et chapitres « Prévu » 09 et 10.
// Base PostgreSQL de TEST uniquement (rôle non superutilisateur, comme rls.test.ts) : deux espaces et un utilisateur fictifs, créés
// ici et supprimés à la fin. La garde d'accès est simulée avec la vraie règle des rôles : un rôle inférieur au rôle demandé est
// refusé (404), comme requireWorkspace.
const W = `test-ws-croisee-${Date.now()}`;
const B = `test-ws-croisee-b-${Date.now()}`;
const U = `test-user-croisee-${Date.now()}`;
const SLUG = W;

const access = vi.hoisted(() => ({ role: "admin" as string, asked: [] as string[] }));
vi.mock("@/lib/workspace", () => ({
  requireWorkspace: async (slug: string, minRole = "reader") => {
    const { hasAtLeast } = await import("@/lib/roles");
    access.asked.push(minRole);
    if (!hasAtLeast(access.role as Role, minRole as Role)) throw new Error("NEXT_NOT_FOUND");
    return { session: { user: { id: U } }, workspace: { id: W, name: "Espace fictif", slug, role: access.role } };
  },
}));
const revalidated = vi.hoisted(() => [] as unknown[][]);
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidated.push(args) }));

import { saveConfidentialite, saveCroiseeSettings } from "@/app/e/[slug]/parametres/actions";
import { CONFIDENTIALITE_FORM_NOTE, CONFIDENTIALITE_LEGACY_NOTE, ConfidentialiteForm, type ConfidentialiteFormProps } from "@/app/e/[slug]/parametres/ConfidentialiteForm";
import { CROISEE_CONFIDENTIALITE_NOTE, CroiseeForm, type CroiseeFormKey, type CroiseeFormProps, type CroiseeOrigin } from "@/app/e/[slug]/parametres/CroiseeForm";
import { chapterDef } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import ChJuridique, { JURIDIQUE_OUVERT, JURIDIQUE_RAISON } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChJuridique";
import ChRestructuration, { RESTRUCTURATION_OUVERT, RESTRUCTURATION_RAISON } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChRestructuration";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { CONFIDENTIALITE_KEY, CONFIDENTIALITE_LEGACY_KEY, getConfidentialiteRead } from "@/lib/confidentialite";
import { CROISEE_KEYS, croiseeSettingReason, getCroiseeSettings, setCroiseeSettings, type CroiseeSettingKey } from "@/lib/croisee-settings";
import { setSetting } from "@/lib/settings";
import type { ChapterId } from "@/lib/viz/croisee";

const KEYS = Object.keys(CROISEE_KEYS) as CroiseeSettingKey[];
const OK = "Paramètres de la Masse salariale croisée enregistrés.";
const NOTHING = "Aucune modification : rien n'a été enregistré.";

// Formulaire tel que le navigateur l'envoie : un champ par réglage, le marqueur « seuils » et les lignes du tableau des seuils.
type Fields = Record<string, string | string[]>;
const form = (fields: Fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};
const EMPTY: Fields = { margeAlerte: "", horizonEcheances: "", seuils: "1", seuilLibelle: [""], seuilValeur: [""] };
const save = (fields: Fields) => saveCroiseeSettings(SLUG, undefined, form(fields));
const saveSeuil = (seuil: string) => saveConfidentialite(SLUG, undefined, form({ seuil }));
// Événements setting.changed de l'espace, du plus ancien au plus récent : clé et valeur enregistrée (null = suppression).
const changes = async () =>
  (await listEvents(W, 200))
    .filter((e) => e.kind === "setting.changed")
    .reverse()
    .map((e) => e.detail as { key: string; value: unknown });

beforeAll(async () => {
  await db.insert(organization).values([
    { id: W, name: "Espace fictif", slug: W, createdAt: new Date() },
    { id: B, name: "Autre espace fictif", slug: B, createdAt: new Date() },
  ]);
  await db.insert(user).values({ id: U, name: "Administrateur fictif", email: `${U}@test.invalid` });
});
// Nettoyage : l'utilisateur fictif est supprimé même si la suppression des espaces échoue, et la connexion est toujours fermée.
// Délai porté à 60 s : la suppression des espaces entraîne celle de leurs réglages et événements.
afterAll(async () => {
  try {
    await db.delete(organization).where(sql`id in (${W}, ${B})`);
  } finally {
    try {
      await db.delete(user).where(sql`id = ${U}`);
    } finally {
      await pool.end();
    }
  }
}, 60_000);
beforeEach(() => {
  access.role = "admin";
  access.asked.length = 0;
  revalidated.length = 0;
});

describe("Paramètres › Masse salariale croisée : enregistrement (base de test)", () => {
  it("formulaire vide : rien n'est écrit, les quatre réglages restent « non définis », aucun 0", async () => {
    expect(await save(EMPTY)).toEqual({ ok: NOTHING });
    expect(access.asked).toEqual(["admin"]);
    const s = await getCroiseeSettings(W);
    for (const k of KEYS) expect(s[k], k).toEqual({ kind: "absent" });
    expect(await changes()).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  it("valeurs saisies : analysées et écrites telles quelles, un événement setting.changed par réglage ; le seuil de confidentialité n'est pas lu ici", async () => {
    // Cas écrit à la main : espaces autour d'un nombre retirés, ligne vide ignorée, seuils triés par effectif, libellés nettoyés,
    // marge 0 saisie = valeur explicite. Un champ « confidentialite » encore envoyé est ignoré (section Confidentialité).
    const r = await save({ confidentialite: "5", margeAlerte: "0", horizonEcheances: " 90 ", seuils: "1", seuilLibelle: ["Seuil B", "", " Seuil A "], seuilValeur: ["50", "", "11"] });
    expect(r).toEqual({ ok: OK });
    expect(revalidated).toEqual([[`/e/${SLUG}`, "layout"]]);
    const s = await getCroiseeSettings(W);
    expect(s.confidentialite).toEqual({ kind: "absent" });
    expect(s.seuilsEffectif).toMatchObject({ kind: "set", value: [{ libelle: "Seuil A", valeur: 11 }, { libelle: "Seuil B", valeur: 50 }], updatedBy: U });
    expect(s.margeAlerte).toMatchObject({ kind: "set", value: 0 });
    expect(s.horizonEcheances).toMatchObject({ kind: "set", value: 90 });
    expect(s.horizonEcheances.kind === "set" && s.horizonEcheances.updatedAt).toBeInstanceOf(Date);
    expect(await changes()).toEqual([
      { key: "rh.croisee.seuilsEffectif", value: [{ libelle: "Seuil A", valeur: 11 }, { libelle: "Seuil B", valeur: 50 }] },
      { key: "rh.croisee.margeAlerte", value: 0 },
      { key: "rh.croisee.horizonEcheances", value: 90 },
    ]);
    // L'autre espace ne voit rien (isolation par espace).
    const other = await getCroiseeSettings(B);
    for (const k of KEYS) expect(other[k], k).toEqual({ kind: "absent" });
  });

  it("même saisie une seconde fois : rien n'est réécrit ni tracé", async () => {
    const r = await save({ margeAlerte: "0", horizonEcheances: "90", seuils: "1", seuilLibelle: ["Seuil A", "Seuil B"], seuilValeur: ["11", "50"] });
    expect(r).toEqual({ ok: NOTHING });
    expect(await changes()).toHaveLength(3);
  });

  it("valeur invalide : refus écrit, rien n'est enregistré (ni partiellement, ni corrigé en silence)", async () => {
    const before = await getCroiseeSettings(W);
    const valid: Fields = { margeAlerte: "2", horizonEcheances: "120", seuils: "1", seuilLibelle: ["Seuil C"], seuilValeur: ["30"] };
    const marge = "Valeur invalide : marge d'alerte (nombre entier de salariés, 0 ou plus).";
    const horizon = "Valeur invalide : horizon des échéances (nombre entier de jours, au moins 1).";
    const cases: [Fields, string][] = [
      [{ margeAlerte: "-1" }, marge],
      [{ margeAlerte: "2,5" }, marge],
      [{ margeAlerte: "deux" }, marge],
      [{ horizonEcheances: "0" }, horizon],
      [{ horizonEcheances: "1.5" }, horizon],
      [{ horizonEcheances: "99999999999999999999" }, horizon],
      [{ seuilLibelle: ["Seuil C"], seuilValeur: [""] }, "Seuil d'effectif n° 1 : libellé et effectif sont requis ensemble."],
      [{ seuilLibelle: ["", "  "], seuilValeur: ["", "30"] }, "Seuil d'effectif n° 2 : libellé et effectif sont requis ensemble."],
      [{ seuilLibelle: ["Seuil C"], seuilValeur: ["0"] }, "Seuil d'effectif n° 1 : effectif en nombre entier de salariés, au moins 1."],
      [{ seuilLibelle: ["Seuil C"], seuilValeur: ["12,5"] }, "Seuil d'effectif n° 1 : effectif en nombre entier de salariés, au moins 1."],
      [{ seuilLibelle: ["x".repeat(81)], seuilValeur: ["30"] }, "Seuil d'effectif n° 1 : libellé de 80 caractères au plus."],
      [{ seuilLibelle: ["Seuil C", "Seuil D"], seuilValeur: ["30", "30"] }, "Seuils d'effectif : deux seuils ne peuvent pas avoir le même effectif."],
      [{ seuilLibelle: Array.from({ length: 21 }, (_, i) => `S${i}`), seuilValeur: Array.from({ length: 21 }, (_, i) => String(i + 1)) }, "Seuils d'effectif : 20 au plus."],
    ];
    for (const [patch, error] of cases) expect(await save({ ...valid, ...patch }), JSON.stringify(patch)).toEqual({ error });
    expect(await getCroiseeSettings(W)).toEqual(before);
    expect(await changes()).toHaveLength(3);
    expect(revalidated).toEqual([]);
  });

  it("rôle non administrateur : refusé avant toute lecture du formulaire, rien n'est écrit", async () => {
    for (const role of ["editor", "reader"]) {
      access.role = role;
      await expect(save({ ...EMPTY, horizonEcheances: "3" }), role).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(access.asked).toEqual(["admin", "admin"]);
    expect(await getCroiseeSettings(W)).toMatchObject({ horizonEcheances: { kind: "set", value: 90 } });
    expect(await changes()).toHaveLength(3);
  });

  it("champ vidé : réglage supprimé, retour à « non défini » (jamais 0) ; champ absent du formulaire : inchangé", async () => {
    // Toutes les lignes de seuils vidées ; marge et horizon inchangés.
    expect(await save({ margeAlerte: "0", horizonEcheances: "90", seuils: "1", seuilLibelle: ["", ""], seuilValeur: ["", ""] })).toEqual({ ok: OK });
    let s = await getCroiseeSettings(W);
    expect(s.seuilsEffectif).toEqual({ kind: "absent" });
    expect(croiseeSettingReason("seuilsEffectif", s.seuilsEffectif)).toBe("seuils d'effectif non définis (Paramètres)");
    expect(s.margeAlerte).toMatchObject({ kind: "set", value: 0 });
    expect((await changes()).slice(3)).toEqual([{ key: "rh.croisee.seuilsEffectif", value: null }]);
    // Seul l'horizon est envoyé (vide) : il est supprimé ; la marge, absente du formulaire, reste à 0.
    expect(await save({ horizonEcheances: "" })).toEqual({ ok: OK });
    s = await getCroiseeSettings(W);
    expect(s.horizonEcheances).toEqual({ kind: "absent" });
    expect(s.margeAlerte).toMatchObject({ kind: "set", value: 0 });
    expect((await changes()).slice(4)).toEqual([{ key: "rh.croisee.horizonEcheances", value: null }]);
  });

  it("écriture directe : une valeur typée illisible refuse tout l'enregistrement avant la moindre écriture ; liste vide = suppression ; le seuil est délégué au module partagé", async () => {
    const n = (await changes()).length;
    await expect(setCroiseeSettings(W, { confidentialite: 3, horizonEcheances: 0 }, U)).rejects.toThrow("Valeur invalide pour rh.croisee.horizonEcheances.");
    await expect(setCroiseeSettings(W, { margeAlerte: 2.5 }, U)).rejects.toThrow("Valeur invalide pour rh.croisee.margeAlerte.");
    await expect(setCroiseeSettings(W, { confidentialite: "5" as unknown as number }, U)).rejects.toThrow("Valeur invalide pour rh.confidentialite.seuil.");
    expect((await getCroiseeSettings(W)).confidentialite).toEqual({ kind: "absent" });
    expect(await setCroiseeSettings(W, {}, U)).toEqual([]);
    expect(await setCroiseeSettings(W, { seuilsEffectif: [{ libelle: "Seuil E", valeur: 25 }] }, U)).toEqual(["seuilsEffectif"]);
    expect(await setCroiseeSettings(W, { seuilsEffectif: [], margeAlerte: null }, U)).toEqual(["seuilsEffectif", "margeAlerte"]);
    // Seuil de confidentialité par la croisée : écrit sous la clé de l'application (setConfidentialite), puis supprimé.
    expect(await setCroiseeSettings(W, { confidentialite: 6 }, U)).toEqual(["confidentialite"]);
    expect(await getConfidentialiteRead(W)).toMatchObject({ setting: { kind: "set", value: 6, updatedBy: U }, source: "seuil" });
    expect(await setCroiseeSettings(W, { confidentialite: 6 }, U)).toEqual([]);
    expect(await setCroiseeSettings(W, { confidentialite: null }, U)).toEqual(["confidentialite"]);
    const s = await getCroiseeSettings(W);
    for (const k of KEYS) expect(s[k], k).toEqual({ kind: "absent" });
    expect((await changes()).slice(n)).toEqual([
      { key: "rh.croisee.seuilsEffectif", value: [{ libelle: "Seuil E", valeur: 25 }] },
      { key: "rh.croisee.seuilsEffectif", value: null },
      { key: "rh.croisee.margeAlerte", value: null },
      { key: "rh.confidentialite.seuil", value: 6 },
      { key: "rh.confidentialite.seuil", value: null },
    ]);
  });
});

describe("Paramètres › Confidentialité : enregistrement (base de test)", () => {
  const CONF = "Valeur invalide : seuil de confidentialité (nombre entier de personnes, au moins 1).";

  it("champ vide, rien d'enregistré : rien n'est écrit, le seuil reste « non défini », aucun 0", async () => {
    const n = (await changes()).length;
    expect(await saveSeuil("")).toEqual({ ok: NOTHING });
    expect(access.asked).toEqual(["admin"]);
    expect(await getConfidentialiteRead(W)).toEqual({ setting: { kind: "absent" }, source: null });
    expect(await changes()).toHaveLength(n);
    expect(revalidated).toEqual([]);
  });

  it("valeur saisie : écrite telle quelle sous rh.confidentialite.seuil, un événement setting.changed ; lue par la croisée avec la même forme", async () => {
    const n = (await changes()).length;
    expect(await saveSeuil(" 5 ")).toEqual({ ok: "Seuil de confidentialité enregistré." });
    expect(revalidated).toEqual([[`/e/${SLUG}`, "layout"]]);
    const read = await getConfidentialiteRead(W);
    expect(read).toMatchObject({ setting: { kind: "set", value: 5, updatedBy: U }, source: "seuil" });
    expect(read.setting.kind === "set" && read.setting.updatedAt).toBeInstanceOf(Date);
    expect((await getCroiseeSettings(W)).confidentialite).toEqual(read.setting);
    expect((await changes()).slice(n)).toEqual([{ key: CONFIDENTIALITE_KEY, value: 5 }]);
    // L'autre espace ne voit rien (isolation par espace).
    expect(await getConfidentialiteRead(B)).toEqual({ setting: { kind: "absent" }, source: null });
  });

  it("même valeur une seconde fois : rien n'est réécrit ni tracé", async () => {
    const n = (await changes()).length;
    expect(await saveSeuil("5")).toEqual({ ok: NOTHING });
    expect(await changes()).toHaveLength(n);
    expect(revalidated).toEqual([]);
  });

  it("valeur invalide : refus écrit, rien n'est enregistré (ni arrondi, ni converti, ni remplacé par 0)", async () => {
    const n = (await changes()).length;
    for (const bad of ["0", "2,5", "2.5", "-1", "cinq", "99999999999999999999", "1e3"]) expect(await saveSeuil(bad), bad).toEqual({ error: CONF });
    expect(await getConfidentialiteRead(W)).toMatchObject({ setting: { kind: "set", value: 5 }, source: "seuil" });
    expect(await changes()).toHaveLength(n);
    expect(revalidated).toEqual([]);
  });

  it("rôle non administrateur : refusé avant toute lecture du formulaire, rien n'est écrit", async () => {
    for (const role of ["editor", "reader"]) {
      access.role = role;
      await expect(saveSeuil("3"), role).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(access.asked).toEqual(["admin", "admin"]);
    expect(await getConfidentialiteRead(W)).toMatchObject({ setting: { kind: "set", value: 5 } });
  });

  it("champ vidé : seuil supprimé, retour à « non défini » (jamais 0), événement à valeur null", async () => {
    const n = (await changes()).length;
    expect(await saveSeuil("")).toEqual({ ok: "Seuil de confidentialité supprimé : non défini." });
    expect(await getConfidentialiteRead(W)).toEqual({ setting: { kind: "absent" }, source: null });
    expect((await changes()).slice(n)).toEqual([{ key: CONFIDENTIALITE_KEY, value: null }]);
    expect(revalidated).toEqual([[`/e/${SLUG}`, "layout"]]);
  });

  it("ancienne clé de la croisée encore enregistrée : reprise tant que la nouvelle est absente ; écrite ici, la nouvelle l'emporte ; supprimée, l'ancienne redevient lue et l'écran le dit", async () => {
    // L'ancienne clé existe sur les espaces réglés avant le lot 12 : écrite ici telle que l'ancienne croisée l'écrivait.
    await setSetting(W, CONFIDENTIALITE_LEGACY_KEY, 4, U);
    expect(await getConfidentialiteRead(W)).toMatchObject({ setting: { kind: "set", value: 4, updatedBy: U }, source: "croisee" });
    expect((await getCroiseeSettings(W)).confidentialite).toMatchObject({ kind: "set", value: 4 });
    // Même valeur que l'ancienne clé : la nouvelle clé est tout de même écrite (elle doit exister).
    const n = (await changes()).length;
    expect(await saveSeuil("4")).toEqual({ ok: "Seuil de confidentialité enregistré." });
    expect(await getConfidentialiteRead(W)).toMatchObject({ setting: { kind: "set", value: 4 }, source: "seuil" });
    expect(await saveSeuil("5")).toEqual({ ok: "Seuil de confidentialité enregistré." });
    expect(await getConfidentialiteRead(W)).toMatchObject({ setting: { kind: "set", value: 5 }, source: "seuil" });
    expect((await getCroiseeSettings(W)).confidentialite).toMatchObject({ kind: "set", value: 5 });
    // Suppression : seule la nouvelle clé est retirée ; l'ancienne (4) est de nouveau lue par repli, et le message le dit.
    expect(await saveSeuil("")).toEqual({ ok: "Seuil de confidentialité supprimé ; l'ancien réglage de la Masse salariale croisée reste lu tant qu'il existe." });
    expect(await getConfidentialiteRead(W)).toMatchObject({ setting: { kind: "set", value: 4 }, source: "croisee" });
    expect((await changes()).slice(n)).toEqual([
      { key: CONFIDENTIALITE_KEY, value: 4 },
      { key: CONFIDENTIALITE_KEY, value: 5 },
      { key: CONFIDENTIALITE_KEY, value: null },
    ]);
  });
});

// --- Formulaires (rendu serveur, valeurs fictives écrites à la main) --------------------------------------------------------------
const ABSENT: Record<CroiseeFormKey, CroiseeOrigin> = { seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } };
const props = (over: Partial<CroiseeFormProps> = {}): CroiseeFormProps => ({
  slug: "demo",
  values: { seuilsEffectif: [], margeAlerte: null, horizonEcheances: null },
  origins: ABSENT,
  limits: { seuilsMax: 20, libelleMax: 80 },
  disabled: false,
  ...over,
});
// Balises <input> visibles (hors champ caché) : nom et valeur affichée.
const inputs = (html: string) =>
  [...html.matchAll(/<input [^>]*>/g)].map((m) => m[0]).filter((t) => !t.includes('type="hidden"')).map((t) => ({ name: t.match(/ name="([^"]*)"/)?.[1], value: t.match(/ value="([^"]*)"/)?.[1] }));
const origin = (html: string, id: string) => html.match(new RegExp(`<span class="desc pm-origin"( data-missing="true")? data-testid="setting-croisee-origin-${id}">([^<]*)</span>`));
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("Paramètres › Masse salariale croisée : formulaire", () => {
  it("rien d'enregistré : champs vides, aucune valeur suggérée, « Non défini. » pour chaque réglage ; le seuil de confidentialité renvoie à sa section", () => {
    const html = renderToStaticMarkup(h(CroiseeForm, props()));
    for (const id of ["seuils", "marge", "horizon"]) expect(origin(html, id)?.[2], id).toBe("Non défini.");
    const fields = inputs(html);
    expect(fields.map((f) => f.name)).toEqual(["horizonEcheances", "seuilLibelle", "seuilValeur", "margeAlerte"]);
    for (const f of fields) expect(f.value, f.name).toBe("");
    expect(html).not.toContain("placeholder");
    for (const t of ["setting-croisee-marge", "setting-croisee-horizon", "setting-croisee-save", "setting-croisee-seuil-add", "setting-croisee-seuils", "setting-croisee-confidentialite-note"]) expect(html, t).toContain(`data-testid="${t}"`);
    expect(html).not.toContain('data-testid="setting-croisee-confidentialite"');
    expect(html).not.toContain('name="confidentialite"');
    expect(unescape(html)).toContain(CROISEE_CONFIDENTIALITE_NOTE);
    expect(html).toContain('href="#confidentialite"');
    expect(html.match(/data-testid="setting-croisee-seuil-libelle"/g)).toHaveLength(1); // une ligne vide à remplir
    expect(html).toContain('<input type="hidden" name="seuils" value="1"/>');
    expect(html).toContain('min="0"'); // marge : zéro est une valeur possible, jamais une valeur par défaut
    expect(html).toContain("Aucune valeur par défaut : un champ vidé supprime le réglage, qui redevient « non défini ».");
  });

  it("valeurs enregistrées, lecteur : valeurs et origine affichées, champs désactivés, aucune action", () => {
    const at = "20/10/2026 10:00";
    const set: CroiseeOrigin = { kind: "set", at };
    const html = renderToStaticMarkup(
      h(CroiseeForm, props({
        values: { seuilsEffectif: [{ libelle: "Seuil A", valeur: 11 }, { libelle: "Seuil B", valeur: 50 }], margeAlerte: 0, horizonEcheances: 90 },
        origins: { seuilsEffectif: set, margeAlerte: set, horizonEcheances: { kind: "set", at: null } },
        disabled: true,
      })),
    );
    for (const id of ["seuils", "marge"]) expect(origin(html, id)?.[2], id).toBe(`Modifié le ${at} par un administrateur.`);
    expect(origin(html, "horizon")?.[2]).toBe("Modifié le n.d. par un administrateur.");
    expect(inputs(html)).toEqual([
      { name: "horizonEcheances", value: "90" },
      { name: "seuilLibelle", value: "Seuil A" },
      { name: "seuilValeur", value: "11" },
      { name: "seuilLibelle", value: "Seuil B" },
      { name: "seuilValeur", value: "50" },
      { name: "margeAlerte", value: "0" },
    ]);
    expect(html.match(/<fieldset class="pm-card[^"]*" disabled="">/g)).toHaveLength(2);
    for (const t of ["setting-croisee-save", "setting-croisee-seuil-add", "setting-croisee-seuil-remove"]) expect(html, t).not.toContain(`data-testid="${t}"`);
  });

  it("valeur illisible : signalée, champ vide (jamais remplacé par une valeur de repli)", () => {
    const html = renderToStaticMarkup(h(CroiseeForm, props({ origins: { ...ABSENT, margeAlerte: { kind: "invalid" } } })));
    const o = origin(html, "marge");
    expect(o?.[1]).toBe(' data-missing="true"');
    expect(o?.[2]).toBe("Valeur enregistrée illisible : à ré-enregistrer.");
    expect(inputs(html).find((f) => f.name === "margeAlerte")).toEqual({ name: "margeAlerte", value: "" });
  });

  it("anciens appelants : un seuil de confidentialité encore transmis n'est ni affiché ni envoyé", () => {
    const html = renderToStaticMarkup(h(CroiseeForm, props({ values: { confidentialite: 5, seuilsEffectif: [], margeAlerte: null, horizonEcheances: null }, origins: { ...ABSENT, confidentialite: { kind: "set", at: "x" } } })));
    expect(html).not.toContain('name="confidentialite"');
    expect(html).not.toContain('value="5"');
  });
});

const confProps = (over: Partial<ConfidentialiteFormProps> = {}): ConfidentialiteFormProps => ({ slug: "demo", value: null, origin: { kind: "absent" }, disabled: false, ...over });
const confOrigin = (html: string) => html.match(/<span class="desc pm-origin"( data-missing="true")?( data-legacy="true")? data-testid="setting-confidentialite-origin">([^<]*)<\/span>/);

describe("Paramètres › Confidentialité : formulaire", () => {
  it("rien d'enregistré : champ vide (aucune valeur suggérée), origine « non défini », entier ≥ 1, action d'enregistrement", () => {
    const html = renderToStaticMarkup(h(ConfidentialiteForm, confProps()));
    expect(inputs(html)).toEqual([{ name: "seuil", value: "" }]);
    expect(html).not.toContain("placeholder");
    expect(html).toContain('min="1"');
    expect(html).toContain('step="1"');
    const o = confOrigin(html);
    expect(o?.[1]).toBe(' data-missing="true"');
    expect(o?.[2]).toBeUndefined();
    expect(unescape(o?.[3] ?? "")).toBe("Non défini : toute répartition est n.d. tant que le seuil n'est pas enregistré.");
    for (const t of ["setting-confidentialite-seuil", "setting-confidentialite-save", "setting-confidentialite-origin"]) expect(html, t).toContain(`data-testid="${t}"`);
    expect(html).toContain("Seuil de confidentialité (personnes distinctes)");
    expect(unescape(html)).toContain(CONFIDENTIALITE_FORM_NOTE);
    expect(html).toContain("Enregistrer le seuil de confidentialité");
    expect(html).not.toContain("disabled");
  });

  it("valeur enregistrée dans cette section : valeur et date affichées ; lecteur : champ désactivé, aucune action", () => {
    const html = renderToStaticMarkup(h(ConfidentialiteForm, confProps({ value: 5, origin: { kind: "set", at: "20/10/2026 10:00", legacy: false }, disabled: true })));
    expect(inputs(html)).toEqual([{ name: "seuil", value: "5" }]);
    const o = confOrigin(html);
    expect(o?.[1]).toBeUndefined();
    expect(o?.[2]).toBeUndefined();
    expect(o?.[3]).toBe("Modifié le 20/10/2026 10:00 par un administrateur.");
    expect(html).toContain('<fieldset class="pm-card" disabled="">');
    expect(html).not.toContain('data-testid="setting-confidentialite-save"');
  });

  it("valeur reprise de l'ancien réglage de la croisée : dite telle quelle (à confirmer ici)", () => {
    const html = renderToStaticMarkup(h(ConfidentialiteForm, confProps({ value: 3, origin: { kind: "set", at: null, legacy: true } })));
    expect(inputs(html)).toEqual([{ name: "seuil", value: "3" }]);
    const o = confOrigin(html);
    expect(o?.[2]).toBe(' data-legacy="true"');
    expect(unescape(o?.[3] ?? "")).toBe(`Modifié le n.d. par un administrateur. ${CONFIDENTIALITE_LEGACY_NOTE}`);
  });

  it("valeur illisible : signalée, champ vide (jamais remplacé par une valeur de repli)", () => {
    const html = renderToStaticMarkup(h(ConfidentialiteForm, confProps({ origin: { kind: "invalid", legacy: false } })));
    expect(inputs(html)).toEqual([{ name: "seuil", value: "" }]);
    const o = confOrigin(html);
    expect(o?.[1]).toBe(' data-missing="true"');
    expect(o?.[3]).toBe("Valeur enregistrée illisible : à ré-enregistrer.");
    const legacy = confOrigin(renderToStaticMarkup(h(ConfidentialiteForm, confProps({ origin: { kind: "invalid", legacy: true } }))));
    expect(legacy?.[2]).toBe(' data-legacy="true"');
    expect(unescape(legacy?.[3] ?? "")).toContain(CONFIDENTIALITE_LEGACY_NOTE);
  });

  it("textes d'interface : français sobre, sans tutoiement", () => {
    const html = renderToStaticMarkup(h(ConfidentialiteForm, confProps({ origin: { kind: "set", at: null, legacy: true } })));
    const text = unescape(html.replace(/<[^>]*>/g, " "));
    expect(text).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi)(?!\p{L})/iu);
    expect(text).not.toMatch(/outil observé|cahier|webinaire|capture/i);
  });
});

// --- Chapitres « Prévu » 09 et 10 ---------------------------------------------------------------------------------------------
// Contexte réduit : un chapitre « Prévu » ne lit aucune source (aucun lecteur fourni : un appel échouerait).
const ctxOf = (id: ChapterId) => ({ slug: "demo", chapter: chapterDef(id) }) as unknown as CroiseeContext;
const render = (el: ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ");

describe("chapitres « Prévu » de la Masse salariale croisée", () => {
  it("09 · Restructuration : mention Prévu, raison courte, écrans existants d'Hypothèses budgétaires, reste à décider ; aucun chiffre", () => {
    const html = render(ChRestructuration({ ctx: ctxOf("restructuration") }) as ReactElement);
    expect(html).toContain('data-testid="cx-prevu-restructuration"');
    expect(html).toContain(`<span class="tag">Prévu</span> ${RESTRUCTURATION_RAISON}`);
    expect(RESTRUCTURATION_RAISON).toBe("Hypothèses de projet à saisir ; délai de retour et point mort non calculés dans cette version.");
    for (const href of ["/e/demo/studio-rh/hypotheses", "/e/demo/studio-rh/hypotheses?vue=postes", "/e/demo/studio-rh/hypotheses?vue=resultat&sous=atterrissage"]) expect(html, href).toContain(`href="${href}"`);
    expect(html).toContain("Hypothèses budgétaires › Résultat › Atterrissage");
    expect(html).toContain('id="cx-restructuration-prevu"');
    expect(html).toContain('id="cx-restructuration-ouvert"');
    expect(html).toContain('data-testid="cx-prevu-restructuration-ouvert"');
    expect(html).toContain(">Reste à décider</h3>");
    for (const t of RESTRUCTURATION_OUVERT) expect(html, t).toContain(`<li>${t}</li>`);
    expect(visibleText(html)).not.toMatch(/\d/);
  });

  it("10 · Bibliothèque juridique : aucune convention collective codée, bibliothèque d'espace à définir ; aucun chiffre", () => {
    const html = render(ChJuridique({ ctx: ctxOf("juridique") }) as ReactElement);
    expect(html).toContain('data-testid="cx-prevu-juridique"');
    expect(html).toContain(`<span class="tag">Prévu</span> ${JURIDIQUE_RAISON}`);
    expect(JURIDIQUE_RAISON).toBe("Aucune convention collective ni aucun texte juridique n'est codé dans Clair ; la bibliothèque de l'espace reste à définir.");
    for (const href of ["/e/demo/parametres", "/e/demo/glossaire"]) expect(html, href).toContain(`href="${href}"`);
    expect(html).toContain('data-testid="cx-prevu-juridique-ouvert"');
    for (const t of JURIDIQUE_OUVERT) expect(html, t).toContain(`<li>${t}</li>`);
    expect(visibleText(html)).not.toMatch(/\d/);
  });

  it("textes d'interface : français sobre, sans tutoiement", () => {
    const all = [RESTRUCTURATION_RAISON, JURIDIQUE_RAISON, ...RESTRUCTURATION_OUVERT, ...JURIDIQUE_OUVERT].join(" ");
    expect(all).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi)(?!\p{L})/iu);
    expect(all).not.toMatch(/outil observé|cahier|webinaire|capture/i);
  });
});
