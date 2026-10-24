import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageTable } from "@/app/e/[slug]/donnees/dsn/CoverageTable";
import { ExercisesTable } from "@/app/e/[slug]/donnees/fec/ExercisesTable";
import { ConnectForm, DecisionButtons, FileUploadForm, SyncForm } from "@/app/e/[slug]/donnees/Forms";
import { Pill, pillClass } from "@/app/e/[slug]/donnees/ui";
import { KpiForm, type KpiFormProps } from "@/app/e/[slug]/parametres/KpiForm";
import { PayfitHistoryForm } from "@/app/e/[slug]/parametres/PayfitHistoryForm";
import { ProrataForm } from "@/app/e/[slug]/parametres/ProrataForm";
import { GlossaryLink } from "@/components/GlossaryLink";
import { GLOSSARY, glossaryEntry } from "@/lib/glossary";
import { DONNEES_TERMS, GLOSSARY_DONNEES } from "@/lib/glossary/donnees";

// Les actions serveur ne sont pas exécutées ici : les formulaires sont rendus tels quels, sur des valeurs fictives écrites à la main.
vi.mock("@/app/e/[slug]/donnees/actions", () => ({ connectSource: async () => undefined, decideSync: async () => undefined, launchSync: async () => undefined, uploadFiles: async () => undefined }));
vi.mock("@/app/e/[slug]/parametres/actions", () => ({ saveKpiSettings: async () => undefined, saveProrata: async () => undefined, savePayfitHistory: async () => undefined }));

const read = (path: string) => readFileSync(path, "utf8");
const ZONE_FILES = [
  "src/app/e/[slug]/page.tsx",
  "src/app/e/[slug]/donnees/page.tsx",
  "src/app/e/[slug]/donnees/[source]/page.tsx",
  "src/app/e/[slug]/donnees/synchro/[id]/page.tsx",
  "src/app/e/[slug]/donnees/dsn/page.tsx",
  "src/app/e/[slug]/donnees/dsn/CoverageTable.tsx",
  "src/app/e/[slug]/donnees/fec/page.tsx",
  "src/app/e/[slug]/donnees/fec/ExercisesTable.tsx",
  "src/app/e/[slug]/donnees/Forms.tsx",
  "src/app/e/[slug]/donnees/ui.tsx",
  "src/app/e/[slug]/parametres/page.tsx",
  "src/app/e/[slug]/parametres/KpiForm.tsx",
  "src/app/e/[slug]/parametres/PayfitHistoryForm.tsx",
  "src/app/e/[slug]/parametres/ProrataForm.tsx",
  "src/app/e/[slug]/parametres/HeadcountForm.tsx",
  "src/app/e/[slug]/parametres/PayrollGridForm.tsx",
  "src/app/e/[slug]/parametres/CategoryNaturesForm.tsx",
  "src/app/e/[slug]/parametres/ContractCategoriesForm.tsx",
  "src/app/e/[slug]/parametres/ServiceAxisForm.tsx",
  "src/app/e/[slug]/membres/page.tsx",
  "src/app/e/[slug]/membres/Forms.tsx",
  "src/app/e/[slug]/studio-rh/reporting-social/page.tsx",
];

describe("Glossaire « Données » : entrées déplacées depuis les écrans", () => {
  it("chaque identifiant cité par les écrans existe, dans la famille « Données », avec un id kebab-case unique dans tout le glossaire", () => {
    const ids = Object.values(DONNEES_TERMS);
    expect(ids).toHaveLength(27);
    expect(GLOSSARY_DONNEES.map((e) => e.id).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      const e = glossaryEntry(id);
      expect(e, id).toBeDefined();
      expect(e!.family).toBe("Données");
      expect(GLOSSARY.filter((x) => x.id === id), id).toHaveLength(1);
    }
  });

  it("le lien « ? » porte « Définition : <terme> » : aucun terme ne contient un mot que les specs e2e cherchent dans les libellés de champs", () => {
    // getByLabel("Règle"), getByLabel("Rôle"), getByLabel("E-mail") : sous-chaîne, sans tenir compte de la casse.
    for (const e of GLOSSARY_DONNEES) expect(e.term, e.id).not.toMatch(/règle|rôle|e-mail|clé api payfit|clé api pennylane/i);
    // Les libellés /Fichiers DSN/ et /Fichiers FEC/ (casse respectée) ne doivent pas être doublés par un lien.
    for (const e of GLOSSARY_DONNEES) expect(e.term, e.id).not.toMatch(/Fichiers (DSN|FEC)/);
    const html = renderToStaticMarkup(h(GlossaryLink, { slug: "demo", term: DONNEES_TERMS.depotDsn }));
    expect(html).toContain('aria-label="Définition : Dépôt de fichiers DSN"');
    expect(html).toContain('href="/e/demo/glossaire#def-donnees-depot-dsn"');
  });

  it("les renvois « Voir aussi » désignent des entrées qui existent, jamais l'entrée elle-même", () => {
    const withSee = GLOSSARY_DONNEES.filter((e) => e.see);
    expect(withSee.length).toBeGreaterThan(0);
    for (const e of withSee) for (const id of e.see!) {
      expect(glossaryEntry(id), `${e.id} → ${id}`).toBeDefined();
      expect(id, e.id).not.toBe(e.id);
    }
    // Cas de référence écrit à la main : le paramètre ETP renvoie à la quotité d'un contrat, qui est dans la famille « KPI RH ».
    expect(glossaryEntry(DONNEES_TERMS.etp)!.see).toEqual(["etp-contract"]);
    expect(glossaryEntry("etp-contract")!.family).toBe("KPI RH");
  });

  it("le texte retiré des écrans est au glossaire (phrase repère de chaque explication déplacée)", () => {
    const repere: [string, string][] = [
      [DONNEES_TERMS.lecture, "Chaque lecture passe par un aperçu avant d'être appliquée"],
      [DONNEES_TERMS.lecture, "Rien n'est lu dans une source tant qu'une synchronisation n'est pas lancée"],
      [DONNEES_TERMS.sourceRetenue, "l'API fait foi si elle est connectée et qu'une lecture est appliquée"],
      [DONNEES_TERMS.cleApi, "contracts:time-information:read"],
      [DONNEES_TERMS.cleApi, "stockée chiffrée ; elle n'est plus jamais affichée"],
      [DONNEES_TERMS.periode, "24 mois au plus"],
      [DONNEES_TERMS.periode, "classes 6 et 7 et des comptes 421, 431 et 437"],
      [DONNEES_TERMS.depotDsn, "le NIR n'est jamais stocké en clair"],
      [DONNEES_TERMS.depotDsn, "numéro d'ordre, annule et remplace, fractions"],
      [DONNEES_TERMS.couvertureDsn, "Les cotisations et les arrêts de travail ne sont pas extraits"],
      [DONNEES_TERMS.depotFec, "article A47 A-1"],
      [DONNEES_TERMS.depotFec, "le remplace"],
      [DONNEES_TERMS.extraits, "dix premiers enregistrements"],
      [DONNEES_TERMS.extraits, "sans retraitement"],
      [DONNEES_TERMS.effectif, "Une personne avec plusieurs contrats compte une fois"],
      [DONNEES_TERMS.historique, "un contrat qui fait suite à un contrat non renvoyé compte comme une entrée"],
      [DONNEES_TERMS.historique, "plus de 12 mois"], // PAYFIT_ARCHIVED_RETENTION_MONTHS = 12
      [DONNEES_TERMS.historique, "avec une mention unique en tête d'écran"],
      [DONNEES_TERMS.kpi, "recalculées à chaque affichage, sans reconstruire le référentiel"],
      [DONNEES_TERMS.etp, "S21.G00.40.014 = 10"],
      [DONNEES_TERMS.etp, "arrondie à 2, 3 ou 4 décimales avant d'être additionnée"],
      [DONNEES_TERMS.turnover, "le jour J+1"],
      [DONNEES_TERMS.sortiesNonComptees, "PayFit ne le fournit pas"],
      [DONNEES_TERMS.sortiesNonComptees, "Aucune nature cochée : toutes les sorties comptent"],
      [DONNEES_TERMS.absenceTypes, "en DSN, les arrêts ne sont pas extraits"],
      [DONNEES_TERMS.absenceStatuts, "le taux d'absentéisme devient alors « ≥ x »"],
      [DONNEES_TERMS.absenceBase, "Aucun jour férié n'est connu"],
      [DONNEES_TERMS.grille, "641 brut (dont primes 6413, gratifications de stage 64137"],
      [DONNEES_TERMS.grille, "la rubrique dont un préfixe est le plus long"],
      [DONNEES_TERMS.axeService, "le seul axe présent dans le journal"],
      [DONNEES_TERMS.prorata, "aucun scénario ne peut être créé"],
      [DONNEES_TERMS.prorata, "la modifier ne change pas les scénarios existants"],
      [DONNEES_TERMS.categories, "PayFit code certains apprentis en CDD"],
      [DONNEES_TERMS.profils, "Éditeur : lance les lectures des sources, dépose les fichiers et saisit les hypothèses."],
      [DONNEES_TERMS.invitation, "Il expire au bout de 7 jours"],
      [DONNEES_TERMS.journal, "Les 30 derniers événements"],
      [DONNEES_TERMS.bdese, "ne valide aucune obligation légale"],
      [DONNEES_TERMS.bdese, "chapitre 07 est abrégé"],
    ];
    for (const [id, phrase] of repere) expect(glossaryEntry(id)!.definition, `${id} : ${phrase}`).toContain(phrase);
  });

  it("français de produit : ni vocabulaire interne, ni tutoiement, ni valeur mal formée", () => {
    for (const e of GLOSSARY_DONNEES) {
      const text = `${e.term} ${e.definition} ${e.formula ?? ""}`;
      expect(text, e.id).not.toMatch(/outil observé|cahier|webinaire|\bNaN\b|undefined|\[object/i);
      expect(text, e.id).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi)(?!\p{L})/iu);
      expect(e.definition.trim().length, e.id).toBeGreaterThan(40);
    }
  });
});

describe("Données : pastilles d'état dans l'univers bleu / blanc / noir", () => {
  it("la pastille porte la classe de sa teinte et sa classe propre (sans passer par le vert ni l'ambre)", () => {
    expect(pillClass("applied")).toBe("status-pill dn-pill applied");
    expect(renderToStaticMarkup(h(Pill, { tone: "preview", children: "Aperçu à valider" }))).toBe('<span class="status-pill dn-pill preview">Aperçu à valider</span>');
  });

  it("couverture DSN : complète = appliquée (bleu plein), incomplète = à valider (bleu cerné), bloquée = échec (rouge) ; le libellé est écrit", () => {
    const row = (siret: string, month: string, status: "complete" | "incomplete" | "blocked") => ({ siret, month, status, selected: [], excluded: [], messages: [] });
    const html = renderToStaticMarkup(h(CoverageTable, { rows: [row("00000000000001", "2026-01", "complete"), row("00000000000001", "2026-02", "incomplete"), row("00000000000001", "2026-03", "blocked")] }));
    expect(html).toContain('<span class="status-pill dn-pill applied">Complète</span>');
    expect(html).toContain('<span class="status-pill dn-pill preview">Incomplète</span>');
    expect(html).toContain('<span class="status-pill dn-pill failed">Bloquée</span>');
    expect(html).not.toMatch(/green|amber|warn|#[0-9a-f]{3,6}/i);
  });

  it("exercices FEC : équilibré = bleu, non équilibré = rouge avec le nombre d'écritures", () => {
    const ex = (balanced: boolean, unbalancedEntries: number) => ({
      filename: "fec-fictif.txt", siren: "000000000", closingDate: null, firstDate: "2024-10-01", lastDate: "2025-09-30", lines: 4, entries: 2,
      totalDebitCents: 1384000, totalCreditCents: 1384000, balanced, unbalancedEntries, journals: [], encoding: "utf-8", delimiter: "tab", amountFormat: "x", warnings: [], replaces: [],
      syncId: "s1", pending: false,
    });
    const html = renderToStaticMarkup(h(ExercisesTable, { rows: [ex(true, 0), ex(false, 2)] }));
    expect(html).toContain('<span class="status-pill dn-pill applied">équilibré</span>');
    expect(html).toContain('<span class="status-pill dn-pill failed">non équilibré (2 écriture(s))</span>');
    expect(html.replace(/[\u202f\u00a0]/g, " ")).toContain("13 840,00"); // 1 384 000 centimes
  });

  it("feuille de style : toute couleur codée en dur est bleue ou grise ; le rouge n'apparaît que sur les lignes d'erreur (--danger)", () => {
    // Teinte (0 à 360) et saturation (0 à 1) d'une couleur #rrggbb, calculées à la main selon la formule HSL.
    const hs = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
      if (d === 0) return { hue: 0, sat: 0 };
      const sat = d / (1 - Math.abs(2 * l - 1));
      const hue = max === r ? 60 * (((g - b) / d + 6) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      return { hue, sat };
    };
    const inUniverse = (hex: string) => {
      const { hue, sat } = hs(hex);
      return sat < 0.2 || (hue >= 205 && hue <= 250);
    };
    // Cas de référence (teintes calculées à la main) : bleu de la charte, bleu clair, gris bleuté, puis les couleurs à bannir.
    for (const ok of ["#155cff", "#d6e3ff", "#9aa3b5", "#5b6270", "#fff", "#eef0f5"]) expect(inUniverse(ok.length === 4 ? "#ffffff" : ok), ok).toBe(true);
    for (const bad of ["#138a55", "#f59e0b", "#7c3aed", "#14b8a6", "#c4302b"]) expect(inUniverse(bad), bad).toBe(false);

    const css = read("src/styles/donnees.css").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const line of css.split("\n")) {
      for (const [hex] of line.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        if (!inUniverse(hex)) expect(line, hex).toMatch(/--danger/);
      }
    }
    for (const gone of ["var(--ok)", "var(--good", "var(--bad", "var(--warn", "amber", "green", "orange"]) expect(css, gone).not.toContain(gone);
  });

  it("aucune couleur codée en dur dans les écrans de la zone", () => {
    for (const f of ZONE_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/style=\{\{[^}]*color/);
    }
  });
});

describe("Données : écrans sans narratif, avec renvoi au glossaire", () => {
  it("les paragraphes explicatifs retirés ne sont plus dans les écrans", () => {
    const gone: Record<string, string[]> = {
      "src/app/e/[slug]/parametres/page.tsx": [
        "pm-lead", "Chaque règle est écrite ici", "PayFit ne renvoie plus", "Effectif à une date", "Règles appliquées par Studio RH", "641 brut",
        "lit le journal comptable de paie", "projette chaque contrat", "Pour les cas que la nature ne distingue pas", "PRORATA_LABELS", "PAYFIT_ARCHIVED_RETENTION_MONTHS",
      ],
      "src/app/e/[slug]/parametres/KpiForm.tsx": ["S21.G00.40.014", "Le motif DSN", "arrondie avant la somme", "aucun jour férié", "Une absence sans statut", "ex. CDD"],
      "src/app/e/[slug]/parametres/PayfitHistoryForm.tsx": ["mention unique", "sorties, turnover, absentéisme"],
      "src/app/e/[slug]/donnees/page.tsx": ["Rien n'est lu tant qu'une synchronisation"],
      "src/app/e/[slug]/donnees/Forms.tsx": ["stockée chiffrée", "Créez dans PayFit", "Rien n'est modifié avant", "n'est pas importé deux fois", "SYNC_HELP"],
      "src/app/e/[slug]/donnees/dsn/page.tsx": ["numéro d'ordre", "individus, contrats, rémunérations"],
      "src/app/e/[slug]/donnees/fec/page.tsx": ["A47", "en centimes exacts"],
      "src/app/e/[slug]/donnees/synchro/[id]/page.tsx": ["Les dix premiers enregistrements", "Montants tels que lus à la source", "s'ajoutent aux dépôts déjà appliqués", "que les modules Studio RH utiliseront"],
      "src/app/e/[slug]/membres/page.tsx": ["ROLE_NOTES", "mb-roles", "Trois rôles par espace", "Pas d'envoi d'e-mail en V1", "affiché dans le menu et en tête"],
      "src/app/e/[slug]/studio-rh/reporting-social/page.tsx": ["rs-banner", "aucun contenu n'est encore construit", "avec la provenance de chaque donnée"],
    };
    for (const [f, phrases] of Object.entries(gone)) {
      const src = read(f);
      for (const p of phrases) expect(src, `${f} : ${p}`).not.toContain(p);
    }
    expect(read("src/styles/donnees.css")).not.toMatch(/\.pm-lead|\.mb-roles|\.rs-banner/);
  });

  it("titres suivis d'un « ? » : l'identifiant qui nomme une section ne porte que le titre, jamais le lien", () => {
    const rs = read("src/app/e/[slug]/studio-rh/reporting-social/page.tsx");
    expect(rs).toContain('<span id="rs-chapitres">Chapitres</span><GlossaryLink');
    expect(rs).not.toContain('<h2 id="rs-chapitres">');
    // Les trois extraits de la page d'une lecture renvoient à la même entrée du glossaire.
    const sync = read("src/app/e/[slug]/donnees/synchro/[id]/page.tsx");
    for (const title of ["Collaborateurs (extrait)", "Contrats déclarés (extrait)", "Contrats (extrait)"]) {
      expect(sync, title).toContain(`<h2>${title}<GlossaryLink slug={slug} term={DONNEES_TERMS.extraits} /></h2>`);
    }
  });

  it("chaque identifiant de DONNEES_TERMS est employé par au moins un écran, par la clé (jamais par un texte recopié)", () => {
    const all = ZONE_FILES.map(read).join("\n");
    for (const key of Object.keys(DONNEES_TERMS)) expect(all, key).toContain(`DONNEES_TERMS.${key}`);
    expect(all).not.toMatch(/term="(donnees|param|membres|reporting)-/);
    // Les écrans de chiffres du glossaire n'ont pas d'ancre « def- » locale : le « ? » mène au glossaire.
    expect(all).not.toContain('id="def-');
  });

  it("formulaire des KPI : libellés courts, « ? » rendus par la page, identifiants de test conservés", () => {
    const props: KpiFormProps = {
      slug: "demo",
      values: { fullTimeIsOne: true, capAtOne: true, forfaitJoursIsOne: true, etpDecimals: 4, turnoverFormula: "half_sum", excludedExitNatures: [], neutralizeContinuity: true, absenceTypes: ["fr_maladie_ordinaire"], absenceStatuses: ["approved"], dayBasis: "calendar" },
      origins: {}, kinds: { fullTimeIsOne: "validated", capAtOne: "validated", forfaitJoursIsOne: "validated", etpDecimals: "validated", turnoverFormula: "validated", neutralizeContinuity: "validated", excludedExitNatures: "validated", absenceTypes: "validated", absenceStatuses: "validated", dayBasis: "validated" },
      notes: { etp: "Valeurs par défaut validées le 22/10/2026.", turnover: null, absence: null },
      natures: [{ code: "01", label: "CDI" }, { code: "02", label: "CDD" }],
      types: [{ type: "fr_maladie_ordinaire", label: "Maladie ordinaire", count: 3, inRead: true }, { type: "test_conge", label: null, count: 0, inRead: false }],
      readLabel: "lecture du 21/10/2026",
      statuses: [{ code: "approved", label: "approuvée" }],
      disabled: false,
      helps: Object.fromEntries((["etp", "turnover", "sortiesNonComptees", "absenceTypes", "absenceStatuts", "absenceBase"] as const).map((k) => [k, h(GlossaryLink, { slug: "demo", term: DONNEES_TERMS[k] })])),
    };
    const html = renderToStaticMarkup(h(KpiForm, props));
    for (const id of ["param-etp", "param-turnover", "param-sorties-non-comptees", "param-absence-types", "param-absence-statuts", "param-absence-base"]) {
      expect(html, id).toContain(`href="/e/demo/glossaire#def-${id}"`);
    }
    for (const t of ["setting-kpi-etp-full-time", "setting-kpi-etp-cap", "setting-kpi-etp-forfait-jours", "setting-kpi-etp-decimals", "setting-kpi-turnover-formula", "setting-kpi-turnover-continuity", "setting-kpi-save"]) {
      expect(html, t).toContain(`data-testid="${t}"`);
    }
    expect(html.match(/data-testid="setting-kpi-absence-types"/g)).toHaveLength(2);
    expect(html).toContain('data-testid="setting-kpi-types-missing"');
    expect(html).toContain('data-testid="setting-kpi-defaults-etp"');
    expect(html).toContain("Types de la lecture du 21/10/2026.");
    expect(html).toContain("Un contrat à temps plein vaut 1 ETP, quelle que soit sa durée");
    // Le « ? » reste hors du libellé qui nomme le groupe (aria-labelledby).
    expect(html).toMatch(/<span class="pm-item-title" id="kpi-types-title">Types d&#x27;absence comptés<\/span><a /);
    for (const gone of ["S21.G00", "Le motif DSN", "arrondie avant la somme", "jour férié", "sans statut n'est jamais", "J+1"]) expect(html, gone).not.toContain(gone);

    // Les libellés restent exacts : le forfait jours dit ses deux conditions, la limite DSN reste dite sans lecture PayFit.
    expect(html).toContain("PayFit : un contrat au forfait jours sans quotité ni indicateur « temps plein » vaut 1 ETP");
    const sans = renderToStaticMarkup(h(KpiForm, { ...props, readLabel: null, helps: undefined, disabled: true }));
    expect(sans).toContain('data-testid="setting-kpi-types-empty"');
    expect(sans).toContain("Aucune lecture PayFit appliquée : aucun type à choisir.");
    expect(sans).toContain("DSN : arrêts non extraits.");
    expect(sans).not.toContain("glossaire#");
    expect(sans).not.toContain('data-testid="setting-kpi-save"'); // formulaire en lecture seule
  });

  it("historique PayFit et prorata : choix courts, identifiants de test conservés", () => {
    const hist = renderToStaticMarkup(h(PayfitHistoryForm, { slug: "demo", mode: "raw", disabled: false }));
    expect(hist).toContain("Brut : chiffres tels que l&#x27;API PayFit les renvoie");
    expect(hist).toContain("Signalé : mois antérieurs à la limite affichés « ≥ » ou n.d.");
    for (const t of ["setting-payfit-history-raw", "setting-payfit-history-flagged", "setting-payfit-history-save"]) expect(hist, t).toContain(`data-testid="${t}"`);
    expect(hist).not.toContain("mention unique");

    const labels = { calendaire: "Jours calendaires : jours payés ÷ jours du mois", ouvres: "Jours ouvrés : jours ouvrés payés ÷ jours ouvrés du mois", aucun: "Aucun prorata : un mois commencé ou terminé compte entier" } as const;
    const pro = renderToStaticMarkup(h(ProrataForm, { slug: "demo", current: null, labels, disabled: false }));
    for (const t of ["setting-projection-calendaire", "setting-projection-ouvres", "setting-projection-aucun", "setting-projection-save"]) expect(pro, t).toContain(`data-testid="${t}"`);
    expect(pro).not.toContain("checked"); // aucune règle par défaut : rien n'est coché tant qu'elle n'est pas choisie
  });

  it("formulaires de Données : droits de la clé, limites des dépôts, décision en une ligne ; libellés cherchés par les specs conservés", () => {
    const pf = renderToStaticMarkup(h(ConnectForm, { slug: "demo", source: "payfit", label: "PayFit", connected: false }));
    expect(pf).toContain("Clé API PayFit");
    expect(pf).toContain("accounting:read, collaborators:read, contracts:read, contracts:time-information:read, time:read");
    expect(pf).toContain("Vérifier et enregistrer");
    expect(pf).not.toContain("chiffrée");
    const pl = renderToStaticMarkup(h(ConnectForm, { slug: "demo", source: "pennylane", label: "Pennylane", connected: true }));
    expect(pl).toContain("Remplacer la clé API Pennylane");
    expect(pl).toContain("Identifiant de société (facultatif)");

    const sync = renderToStaticMarkup(h(SyncForm, { slug: "demo", source: "payfit", defaultFrom: "2024-10", defaultTo: "2025-03" }));
    expect(sync).toContain("6 mois seront lus."); // octobre 2024 → mars 2025 = 3 + 3
    expect(sync).not.toContain("dn-help");

    const dsn = renderToStaticMarkup(h(FileUploadForm, { slug: "demo", kind: "dsn" }));
    expect(dsn).toContain(">Fichiers DSN</label>");
    expect(dsn).toContain("Norme P25V01 ou P26V01 · 24 fichiers et 4 Mo par fichier au plus.");
    expect(dsn).toContain("Déposer et prévisualiser");
    const fec = renderToStaticMarkup(h(FileUploadForm, { slug: "demo", kind: "fec" }));
    expect(fec).toContain(">Fichiers FEC</label>");
    expect(fec).toContain("6 fichiers et 32 Mo par fichier au plus.");

    const dec = renderToStaticMarkup(h(DecisionButtons, { slug: "demo", syncId: "s1" }));
    expect(dec).toContain("Appliquer rend la lecture active. Abandonner jette l&#x27;aperçu.");
    expect(dec).toContain("Appliquer cette lecture");
    const add = renderToStaticMarkup(h(DecisionButtons, { slug: "demo", syncId: "s1", additive: true }));
    expect(add).toContain("Appliquer ajoute ces fichiers à la couverture.");
  });
});
