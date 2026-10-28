import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseSnapshot } from "@/lib/budget/types";
import type { ActualEvent } from "@/lib/payroll/non-recurring";

// Hypothèses budgétaires › Résultat › Atterrissage : les lignes issues des déclarations du Réel suivent le seuil de confidentialité
// avec les statuts de la Masse salariale (même fonction maskNonRecurring, fenêtre janvier → mois de la base figée) ; la liste élément
// par élément est réservée aux éditeurs ; le total « déjà en comptabilité » reste affiché. Données entièrement fictives.
//
// Cas de référence écrit à la main, seuil 3 personnes distinctes. Référentiel : payfit:C1 → P1, C2 → P2, C3 → P3, C4 → P4.
// Déclarations du Réel (lecture S, base figée fin mars 2026) : licenciement février 2026, C1, 10 000,00 € ; ruptures conventionnelles
// janvier 2026, C2, C3, C4, 2 000,00 € chacune.
//   Colonne de janvier : Ruptures 3 personnes, seule nature non vide : affichée.
//   Colonne de février : Licenciements 1 personne, seule nature non vide → masqué ; aucune autre nature n'apporte de personne :
//     relation impossible, toute la répartition de février est n.d. (Ruptures de février comprise, 0 élément).
//   Colonne de mars : vide.
//   Fenêtre janvier → mars : Licenciements n.d. (février masqué) ; Ruptures n.d. (février secondaire).
//   Atterrissage : « Licenciements réalisés » et « Ruptures conventionnelles réalisées » n.d. ; « déjà en comptabilité » 10 000 + 6 000
//   = 16 000,00 € affiché (total de l'entreprise, comme la tuile « Coûts identifiés »).
const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SYNC = "11111111-1111-4111-8111-111111111111";
let n = 0;
const ev = (kind: ActualEvent["kind"], month: string, keys: string[], cents: number): ActualEvent => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, syncId: SYNC, month, kind, chargedCents: cents, contractKeys: keys, note: "NOTE_FICTIVE_PRIVEE",
});
const LIC = ev("licenciement", "2026-02", ["payfit:C1"], 1_000_000);
const RC = ["C2", "C3", "C4"].map((x) => ev("rupture-conventionnelle", "2026-01", [`payfit:${x}`], 200_000));
const CONTRACTS = ["C1", "C2", "C3", "C4"].map((x, i) => ({ contractKey: `payfit:${x}`, externalId: x, personKey: `P${i + 1}` }));
const MONTHS = ["2026-01", "2026-02", "2026-03"];
const SET3 = { kind: "set" as const, value: 3, updatedAt: null, updatedBy: null };
const R3 = "non affiché (seuil de confidentialité : 3 personnes)";
const BASE: BaseSnapshot = {
  currency: "EUR", refMonth: "2026-03", syncId: SYNC, readAt: "2026-04-01",
  contracts: [{ contractKey: "payfit:C9", externalId: "C9", label: "Poste fictif", service: null, serviceNd: null, startDate: "2024-01-01", endDate: null, counted: true, etp4: 10_000, etpNd: null, base: { salaryCents: 300_000, refBrutCents: 300_000, refCotisationsCents: 0 }, baseNd: null }],
  actuals: MONTHS.map((month) => ({ month, kind: "value" as const, brut: 3_000_000, cotisations: 0, masse: 3_000_000, headcount: 5, etp4: 50_000, etpNd: null })),
  refMasse: 3_000_000, refBaseCost: 300_000, etpNote: null,
};
const conv = { prorata: "calendaire" as const };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const row = (html: string, label: string) => text(html.match(new RegExp(`<tr data-row="${label}">[\\s\\S]*?</tr>`))![0]);

// --- Page serveur réelle (lectures en base simulées) ------------------------------------------------------------------------------
const state = vi.hoisted(() => ({ role: "reader" as "reader" | "editor", events: [] as unknown[], conf: null as unknown, confCalls: [] as unknown[] }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ session: {}, workspace: { id: WS, name: "Fictif", slug: "fictif", role: state.role } }) }));
vi.mock("@/lib/budget/store", async (orig) => {
  // Construit à l'appel (le module simulé est chargé avant les constantes du fichier).
  const scen = () => ({
    id: SID, workspaceId: WS, baseId: SID, name: "Révisé fictif", kind: "revise" as const, firstMonth: "2026-04", lastMonth: "2026-12",
    conventions: { prorata: "calendaire" as const }, status: "fige" as const, duplicatedFrom: null, createdBy: null,
    createdAt: new Date("2026-04-02T08:00:00Z"), frozenBy: null, frozenAt: new Date("2026-04-02T09:00:00Z"),
  });
  return {
    ...(await orig<typeof import("@/lib/budget/store")>()),
    getScenario: async () => ({ scenario: scen(), base: BASE, baseHash: "x", hypotheses: [] }),
    listScenarios: async () => [{ scenario: scen(), refMonth: "2026-03" }],
    listBudgets: async () => [],
  };
});
vi.mock("@/lib/payroll/non-recurring-store", () => ({ listActualEvents: async () => state.events }));
vi.mock("@/lib/confidentialite", async (orig) => ({
  ...(await orig<typeof import("@/lib/confidentialite")>()),
  getConfidentialite: async (id: string) => {
    state.confCalls.push(id);
    return state.conf;
  },
}));
vi.mock("@/lib/rh/view", async (orig) => ({ ...(await orig<typeof import("@/lib/rh/view")>()), loadCollabContext: async () => ({ data: { contracts: CONTRACTS } }) }));

import { ACTUAL_SHOWN, ActualNonRecurringCount, LandingView, type ActualHidden } from "@/app/e/[slug]/studio-rh/hypotheses/LandingView";
import { measures, sensitivities } from "@/lib/budget/lot3";
import { buildActualNonRecurring } from "@/lib/payroll/non-recurring";
import { declaredLink, maskNonRecurring, NON_RECURRING_KINDS } from "@/lib/payroll/non-recurring-mask";

const hiddenOf = (events: ActualEvent[]): ActualHidden => {
  const m = maskNonRecurring(events.map((event) => ({ event })), MONTHS, declaredLink(CONTRACTS), SET3);
  return Object.fromEntries(NON_RECURRING_KINDS.map((k) => [k, m[k].reason])) as ActualHidden;
};
const landingHtml = (events: ActualEvent[], actualHidden: ActualHidden) => {
  const { reference, landing, rows } = sensitivities(BASE, "2026-04", "2026-12", [], conv, "2026", [], { kind: "value", events });
  return renderToStaticMarkup(h(LandingView, { hrefBase: "/e/demo/studio-rh/hypotheses", scenarioId: SID, year: "2026", landing, retraite: reference, measures: measures(BASE, "2026-04", "2026-12", [], conv, "2026"), sens: rows, options: [], chosen: [], affichage: "tableau", actualHidden }));
};

describe("Atterrissage : lignes du Réel au statut de la Masse salariale", () => {
  it("même fonction, même fenêtre : les statuts de l'Atterrissage sont ceux de la Masse salariale, quelle que soit la lecture", () => {
    const events = [LIC, ...RC];
    // Masse salariale, période janvier → mars, lecture courante différente de celle de la base : mêmes statuts (la cellule ne lit que
    // les éléments eux-mêmes).
    const masse = maskNonRecurring(buildActualNonRecurring(null, events, MONTHS, "22222222-2222-4222-8222-222222222222").rows, MONTHS, declaredLink(CONTRACTS), SET3);
    expect(Object.fromEntries(NON_RECURRING_KINDS.map((k) => [k, masse[k].reason]))).toEqual(hiddenOf(events));
    expect(hiddenOf(events)).toEqual({ licenciement: R3, "rupture-conventionnelle": R3, tuilage: R3, autre: R3 });
  });

  it("lignes masquées : n.d. avec la raison sous le tableau ; total « déjà en comptabilité » (16 000,00 €) affiché", () => {
    const events = [LIC, ...RC];
    const html = landingHtml(events, hiddenOf(events));
    expect(row(html, "Licenciements réalisés")).toBe("Licenciements réalisés n.d. 0 € n.d.");
    expect(row(html, "Ruptures conventionnelles réalisées")).toBe("Ruptures conventionnelles réalisées n.d. 0 € n.d.");
    expect(text(html.match(/data-testid="atr-nonrec-nd"[\s\S]*?<\/p>/)![0])).toContain(`Licenciements réalisés, Ruptures conventionnelles réalisées : ${R3}`);
    expect(text(html.match(/data-testid="atr-nonrec-total"[\s\S]*?<\/tr>/)![0])).toMatch(/Total retiré de l'atterrissage 16\s000 € 0 € 16\s000 €/);
    expect(text(html.match(/data-testid="atr-tile-retire"[\s\S]*?<\/div>/)![0])).toMatch(/déjà en comptabilité 16\s000 €/);
    expect(html).not.toMatch(/10\s000 €<\/td>|6\s000 €<\/td>/);
  });

  it("ruptures seules (3 personnes en janvier, février et mars vides) : ligne affichée, 6 000,00 €", () => {
    const html = landingHtml(RC, hiddenOf(RC));
    expect(hiddenOf(RC)).toEqual({ licenciement: null, "rupture-conventionnelle": null, tuilage: null, autre: null });
    expect(row(html, "Ruptures conventionnelles réalisées")).toMatch(/^Ruptures conventionnelles réalisées 6\s000 € 0 € 6\s000 €$/);
    expect(html).not.toContain('data-testid="atr-nonrec-nd"');
  });

  it("lecteur : seulement le nombre de déclarations à reprendre", () => {
    const html = text(renderToStaticMarkup(h(ActualNonRecurringCount, { count: 4, from: "2026-01", to: "2026-03" })));
    expect(html).toBe("Coûts passés identifiés dans Réel : 4 déclarations à reprendre, janvier 2026 → mars 2026. Le détail par élément est réservé aux éditeurs.");
    expect(renderToStaticMarkup(h(ActualNonRecurringCount, { count: 0, from: "2026-01", to: "2026-03" }))).toBe("");
    expect(ACTUAL_SHOWN).toEqual({ licenciement: null, "rupture-conventionnelle": null, tuilage: null, autre: null });
  });
});

describe("Hypothèses › Résultat › Atterrissage, page serveur réelle", () => {
  beforeEach(() => {
    state.events = [LIC, ...RC];
    state.conf = SET3;
    state.confCalls = [];
  });
  const render = async () => {
    const { default: Page } = await import("@/app/e/[slug]/studio-rh/hypotheses/page");
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "fictif" }), searchParams: Promise.resolve({ scenario: SID, vue: "resultat", sous: "atterrissage", affichage: "tableau" }) }));
  };

  it("lecteur : lignes du Réel n.d., nombre de déclarations seulement, total « déjà en comptabilité » affiché", async () => {
    state.role = "reader";
    const html = await render();
    expect(state.confCalls).toEqual([WS]);
    expect(row(html, "Licenciements réalisés")).toBe("Licenciements réalisés n.d. 0 € n.d.");
    expect(row(html, "Ruptures conventionnelles réalisées")).toBe("Ruptures conventionnelles réalisées n.d. 0 € n.d.");
    expect(html).not.toContain('data-testid="atr-actual-status"');
    expect(text(html.match(/data-testid="atr-actual-count"[\s\S]*?<\/p>/)![0])).toContain("4 déclarations à reprendre, janvier 2026 → mars 2026");
    expect(text(html)).not.toMatch(/Licenciement · |Rupture conventionnelle · /);
    expect(text(html.match(/data-testid="atr-actual-confidentialite"[\s\S]*?<\/p>/)![0])).toContain("seuil de 3 personnes");
    expect(text(html.match(/data-testid="atr-tile-retire"[\s\S]*?<\/div>/)![0])).toMatch(/déjà en comptabilité 16\s000 €/);
    expect(html).not.toMatch(/NOTE_FICTIVE_PRIVEE|payfit:C/);
  });

  it("éditeur : la liste élément par élément est conservée ; les lignes restent soumises au seuil", async () => {
    state.role = "editor";
    const html = await render();
    expect(html).not.toContain('data-testid="atr-actual-count"');
    const status = text(html.match(/data-testid="atr-actual-status"[\s\S]*?<\/ul>/)![0]);
    expect(status.match(/Rupture conventionnelle · [Jj]anvier 2026/g)).toHaveLength(3);
    expect(status).toMatch(/Licenciement · [Ff]évrier 2026/);
    expect(row(html, "Licenciements réalisés")).toBe("Licenciements réalisés n.d. 0 € n.d.");
  });

  it("seuil non défini : lignes du Réel n.d. avec la raison du paramètre et le lien vers les Paramètres", async () => {
    state.role = "reader";
    state.conf = { kind: "absent" };
    const html = await render();
    expect(row(html, "Licenciements réalisés")).toBe("Licenciements réalisés n.d. 0 € n.d.");
    expect(text(html.match(/data-testid="atr-nonrec-nd"[\s\S]*?<\/p>/)![0])).toContain("seuil de confidentialité non défini (Paramètres)");
    expect(html).toContain('href="/e/fictif/parametres#confidentialite"');
  });

  it("aucune déclaration sur la fenêtre : ni seuil lu, ni ligne de confidentialité", async () => {
    state.role = "reader";
    state.events = [];
    const html = await render();
    expect(state.confCalls).toEqual([]);
    expect(html).not.toContain('data-testid="atr-actual-confidentialite"');
    expect(html).not.toContain('data-testid="atr-actual-count"');
  });
});
