import { sql } from "drizzle-orm";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db/client";
import { organization, user } from "@/db/schema";
import { listEvents } from "@/lib/events";
import type { Role } from "@/lib/roles";

// Paramètres de la Masse salariale croisée (P1) et chapitres « Prévu » 09 et 10. Base PostgreSQL de TEST uniquement (rôle non
// superutilisateur, comme rls.test.ts) : deux espaces et un utilisateur fictifs, créés ici et supprimés à la fin. La garde d'accès
// est simulée avec la vraie règle des rôles : un rôle inférieur au rôle demandé est refusé (404), comme requireWorkspace.
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

import { saveCroiseeSettings } from "@/app/e/[slug]/parametres/actions";
import { CroiseeForm, type CroiseeFormProps, type CroiseeOrigin } from "@/app/e/[slug]/parametres/CroiseeForm";
import { chapterDef } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/chapitres";
import ChJuridique, { JURIDIQUE_OUVERT, JURIDIQUE_RAISON } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChJuridique";
import ChRestructuration, { RESTRUCTURATION_OUVERT, RESTRUCTURATION_RAISON } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/ChRestructuration";
import type { CroiseeContext } from "@/app/e/[slug]/studio-rh/masse-salariale/croisee/context";
import { CROISEE_KEYS, croiseeSettingReason, getCroiseeSettings, setCroiseeSettings, type CroiseeSettingKey } from "@/lib/croisee-settings";
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
const EMPTY: Fields = { confidentialite: "", margeAlerte: "", horizonEcheances: "", seuils: "1", seuilLibelle: [""], seuilValeur: [""] };
const save = (fields: Fields) => saveCroiseeSettings(SLUG, undefined, form(fields));
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
afterAll(async () => {
  await db.delete(organization).where(sql`id in (${W}, ${B})`);
  await db.delete(user).where(sql`id = ${U}`);
  await pool.end();
});
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

  it("valeurs saisies : analysées et écrites telles quelles, un événement setting.changed par réglage", async () => {
    // Cas écrit à la main : espaces autour d'un nombre retirés, ligne vide ignorée, seuils triés par effectif, libellés nettoyés,
    // marge 0 saisie = valeur explicite.
    const r = await save({ confidentialite: " 5 ", margeAlerte: "0", horizonEcheances: "90", seuils: "1", seuilLibelle: ["Seuil B", "", " Seuil A "], seuilValeur: ["50", "", "11"] });
    expect(r).toEqual({ ok: OK });
    expect(revalidated).toEqual([[`/e/${SLUG}`, "layout"]]);
    const s = await getCroiseeSettings(W);
    expect(s.confidentialite).toMatchObject({ kind: "set", value: 5, updatedBy: U });
    expect(s.seuilsEffectif).toMatchObject({ kind: "set", value: [{ libelle: "Seuil A", valeur: 11 }, { libelle: "Seuil B", valeur: 50 }], updatedBy: U });
    expect(s.margeAlerte).toMatchObject({ kind: "set", value: 0 });
    expect(s.horizonEcheances).toMatchObject({ kind: "set", value: 90 });
    expect(s.confidentialite.kind === "set" && s.confidentialite.updatedAt).toBeInstanceOf(Date);
    expect(await changes()).toEqual([
      { key: "rh.croisee.confidentialite", value: 5 },
      { key: "rh.croisee.seuilsEffectif", value: [{ libelle: "Seuil A", valeur: 11 }, { libelle: "Seuil B", valeur: 50 }] },
      { key: "rh.croisee.margeAlerte", value: 0 },
      { key: "rh.croisee.horizonEcheances", value: 90 },
    ]);
    // L'autre espace ne voit rien (isolation par espace).
    const other = await getCroiseeSettings(B);
    for (const k of KEYS) expect(other[k], k).toEqual({ kind: "absent" });
  });

  it("même saisie une seconde fois : rien n'est réécrit ni tracé", async () => {
    const r = await save({ confidentialite: "5", margeAlerte: "0", horizonEcheances: "90", seuils: "1", seuilLibelle: ["Seuil A", "Seuil B"], seuilValeur: ["11", "50"] });
    expect(r).toEqual({ ok: NOTHING });
    expect(await changes()).toHaveLength(4);
  });

  it("valeur invalide : refus écrit, rien n'est enregistré (ni partiellement, ni corrigé en silence)", async () => {
    const before = await getCroiseeSettings(W);
    const valid: Fields = { confidentialite: "7", margeAlerte: "2", horizonEcheances: "120", seuils: "1", seuilLibelle: ["Seuil C"], seuilValeur: ["30"] };
    const conf = "Valeur invalide : seuil de confidentialité (nombre entier de personnes, au moins 1).";
    const marge = "Valeur invalide : marge d'alerte (nombre entier de salariés, 0 ou plus).";
    const horizon = "Valeur invalide : horizon des échéances (nombre entier de jours, au moins 1).";
    const cases: [Fields, string][] = [
      [{ confidentialite: "0" }, conf],
      [{ confidentialite: "2,5" }, conf],
      [{ confidentialite: "2.5" }, conf],
      [{ confidentialite: "-1" }, conf],
      [{ confidentialite: "cinq" }, conf],
      [{ confidentialite: "99999999999999999999" }, conf],
      [{ margeAlerte: "-1" }, marge],
      [{ horizonEcheances: "0" }, horizon],
      [{ horizonEcheances: "1.5" }, horizon],
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
    expect(await changes()).toHaveLength(4);
    expect(revalidated).toEqual([]);
  });

  it("rôle non administrateur : refusé avant toute lecture du formulaire, rien n'est écrit", async () => {
    for (const role of ["editor", "reader"]) {
      access.role = role;
      await expect(save({ ...EMPTY, confidentialite: "3" }), role).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(access.asked).toEqual(["admin", "admin"]);
    expect(await getCroiseeSettings(W)).toMatchObject({ confidentialite: { kind: "set", value: 5 } });
    expect(await changes()).toHaveLength(4);
  });

  it("champ vidé : réglage supprimé, retour à « non défini » (jamais 0) ; champ absent du formulaire : inchangé", async () => {
    // Confidentialité vidée, toutes les lignes de seuils vidées ; marge et horizon inchangés.
    expect(await save({ confidentialite: "", margeAlerte: "0", horizonEcheances: "90", seuils: "1", seuilLibelle: ["", ""], seuilValeur: ["", ""] })).toEqual({ ok: OK });
    let s = await getCroiseeSettings(W);
    expect(s.confidentialite).toEqual({ kind: "absent" });
    expect(s.seuilsEffectif).toEqual({ kind: "absent" });
    expect(croiseeSettingReason("confidentialite", s.confidentialite)).toBe("seuil de confidentialité non défini (Paramètres)");
    expect(croiseeSettingReason("seuilsEffectif", s.seuilsEffectif)).toBe("seuils d'effectif non définis (Paramètres)");
    expect(s.margeAlerte).toMatchObject({ kind: "set", value: 0 });
    expect((await changes()).slice(4)).toEqual([
      { key: "rh.croisee.confidentialite", value: null },
      { key: "rh.croisee.seuilsEffectif", value: null },
    ]);
    // Seul l'horizon est envoyé (vide) : il est supprimé ; la marge, absente du formulaire, reste à 0.
    expect(await save({ horizonEcheances: "" })).toEqual({ ok: OK });
    s = await getCroiseeSettings(W);
    expect(s.horizonEcheances).toEqual({ kind: "absent" });
    expect(s.margeAlerte).toMatchObject({ kind: "set", value: 0 });
    expect((await changes()).slice(6)).toEqual([{ key: "rh.croisee.horizonEcheances", value: null }]);
  });

  it("écriture directe : une valeur typée illisible refuse tout l'enregistrement avant la moindre écriture ; liste vide = suppression", async () => {
    const n = (await changes()).length;
    await expect(setCroiseeSettings(W, { confidentialite: 3, horizonEcheances: 0 }, U)).rejects.toThrow("Valeur invalide pour rh.croisee.horizonEcheances.");
    await expect(setCroiseeSettings(W, { margeAlerte: 2.5 }, U)).rejects.toThrow("Valeur invalide pour rh.croisee.margeAlerte.");
    await expect(setCroiseeSettings(W, { confidentialite: "5" as unknown as number }, U)).rejects.toThrow("Valeur invalide pour rh.croisee.confidentialite.");
    expect((await getCroiseeSettings(W)).confidentialite).toEqual({ kind: "absent" });
    expect(await setCroiseeSettings(W, {}, U)).toEqual([]);
    expect(await setCroiseeSettings(W, { seuilsEffectif: [{ libelle: "Seuil E", valeur: 25 }] }, U)).toEqual(["seuilsEffectif"]);
    expect(await setCroiseeSettings(W, { seuilsEffectif: [], margeAlerte: null }, U)).toEqual(["seuilsEffectif", "margeAlerte"]);
    const s = await getCroiseeSettings(W);
    for (const k of KEYS) expect(s[k], k).toEqual({ kind: "absent" });
    expect((await changes()).slice(n)).toEqual([
      { key: "rh.croisee.seuilsEffectif", value: [{ libelle: "Seuil E", valeur: 25 }] },
      { key: "rh.croisee.seuilsEffectif", value: null },
      { key: "rh.croisee.margeAlerte", value: null },
    ]);
  });
});

// --- Formulaire (rendu serveur, valeurs fictives écrites à la main) -----------------------------------------------------------
const ABSENT: Record<CroiseeSettingKey, CroiseeOrigin> = { confidentialite: { kind: "absent" }, seuilsEffectif: { kind: "absent" }, margeAlerte: { kind: "absent" }, horizonEcheances: { kind: "absent" } };
const props = (over: Partial<CroiseeFormProps> = {}): CroiseeFormProps => ({
  slug: "demo",
  values: { confidentialite: null, seuilsEffectif: [], margeAlerte: null, horizonEcheances: null },
  origins: ABSENT,
  limits: { seuilsMax: 20, libelleMax: 80 },
  disabled: false,
  ...over,
});
// Balises <input> visibles (hors champ caché) : nom et valeur affichée.
const inputs = (html: string) =>
  [...html.matchAll(/<input [^>]*>/g)].map((m) => m[0]).filter((t) => !t.includes('type="hidden"')).map((t) => ({ name: t.match(/ name="([^"]*)"/)?.[1], value: t.match(/ value="([^"]*)"/)?.[1] }));
const origin = (html: string, id: string) => html.match(new RegExp(`<span class="desc pm-origin"( data-missing="true")? data-testid="setting-croisee-origin-${id}">([^<]*)</span>`));

describe("Paramètres › Masse salariale croisée : formulaire", () => {
  it("rien d'enregistré : champs vides, aucune valeur suggérée, « Non défini. » pour chaque réglage", () => {
    const html = renderToStaticMarkup(h(CroiseeForm, props()));
    for (const id of ["confidentialite", "seuils", "marge", "horizon"]) expect(origin(html, id)?.[2], id).toBe("Non défini.");
    const fields = inputs(html);
    expect(fields.map((f) => f.name)).toEqual(["confidentialite", "horizonEcheances", "seuilLibelle", "seuilValeur", "margeAlerte"]);
    for (const f of fields) expect(f.value, f.name).toBe("");
    expect(html).not.toContain("placeholder");
    for (const t of ["setting-croisee-confidentialite", "setting-croisee-marge", "setting-croisee-horizon", "setting-croisee-save", "setting-croisee-seuil-add", "setting-croisee-seuils"]) expect(html, t).toContain(`data-testid="${t}"`);
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
        values: { confidentialite: 5, seuilsEffectif: [{ libelle: "Seuil A", valeur: 11 }, { libelle: "Seuil B", valeur: 50 }], margeAlerte: 0, horizonEcheances: 90 },
        origins: { confidentialite: set, seuilsEffectif: set, margeAlerte: set, horizonEcheances: { kind: "set", at: null } },
        disabled: true,
      })),
    );
    for (const id of ["confidentialite", "seuils", "marge"]) expect(origin(html, id)?.[2], id).toBe(`Modifié le ${at} par un administrateur.`);
    expect(origin(html, "horizon")?.[2]).toBe("Modifié le n.d. par un administrateur.");
    expect(inputs(html)).toEqual([
      { name: "confidentialite", value: "5" },
      { name: "horizonEcheances", value: "90" },
      { name: "seuilLibelle", value: "Seuil A" },
      { name: "seuilValeur", value: "11" },
      { name: "seuilLibelle", value: "Seuil B" },
      { name: "seuilValeur", value: "50" },
      { name: "margeAlerte", value: "0" },
    ]);
    expect(html.match(/<fieldset class="pm-card[^"]*" disabled="">/g)).toHaveLength(3);
    for (const t of ["setting-croisee-save", "setting-croisee-seuil-add", "setting-croisee-seuil-remove"]) expect(html, t).not.toContain(`data-testid="${t}"`);
  });

  it("valeur illisible : signalée, champ vide (jamais remplacé par une valeur de repli)", () => {
    const html = renderToStaticMarkup(h(CroiseeForm, props({ origins: { ...ABSENT, confidentialite: { kind: "invalid" } } })));
    const o = origin(html, "confidentialite");
    expect(o?.[1]).toBe(' data-missing="true"');
    expect(o?.[2]).toBe("Valeur enregistrée illisible : à ré-enregistrer.");
    expect(inputs(html).find((f) => f.name === "confidentialite")).toEqual({ name: "confidentialite", value: "" });
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
