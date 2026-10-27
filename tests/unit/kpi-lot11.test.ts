import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AbsenceTypeNotes, AbsenteeismWindowDetail, EtpProratedDetail, KpiTile, etpProratedShown } from "@/app/e/[slug]/studio-rh/kpi/components";
import { KpiForm, type KpiFormProps } from "@/app/e/[slug]/parametres/KpiForm";
import { GlossaryLink } from "@/components/GlossaryLink";
import { GLOSSARY, glossaryEntry } from "@/lib/glossary";
import { GLOSSARY_KPI, KPI_TERMS } from "@/lib/glossary/kpi";
import { ABSENCE_ALL_MOTIFS_LABEL } from "@/lib/rh/kpi/absence-motifs";
import { ETP_PRORATED_LABEL, etpProratedQualifier } from "@/lib/rh/kpi/etp-prorata";
import type { ConfidentialiteSetting } from "@/lib/confidentialite";
import type { AbsenceMotifs, EtpProrated } from "@/lib/rh/kpi/types";
import { etpProratedNotes, motifRows, motifsRetenusLine, readingQualifiers, type MotifLineIn } from "@/lib/viz/kpi";

// Lot 11, écrans KPI RH, Paramètres et glossaire : ETP contractuel proratisé, absentéisme par motif, taux tous motifs.
// Valeurs fictives écrites à la main ; fmtPercent écrit une espace insécable avant « % ».
vi.mock("@/app/e/[slug]/parametres/actions", () => ({ saveKpiSettings: async () => undefined }));

const read = (path: string) => readFileSync(path, "utf8");
// Seuil de confidentialité de 1 personne : aucun groupe dénombré n'est masqué (les lignes de ces tests portent leurs personnes).
const SEUIL_1: ConfidentialiteSetting = { kind: "set", value: 1, updatedAt: null, updatedBy: null };
const render = (el: React.ReactElement) => {
  const html = renderToStaticMarkup(el);
  for (const bad of ["NaN", "undefined", "[object"]) expect(html).not.toContain(bad);
  return html;
};
// Texte lisible d'un fragment : balises retirées, apostrophes et espaces insécables ramenées à la forme simple.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("libellés exacts (lot 11)", () => {
  it("les deux libellés demandés par Lyes sont ceux du moteur et du glossaire", () => {
    expect(ETP_PRORATED_LABEL).toBe("ETP contractuel proratisé — quotité actuelle");
    expect(ABSENCE_ALL_MOTIFS_LABEL).toBe("Taux d'absence, tous motifs");
    expect(glossaryEntry("etp-prorated")!.term).toBe("ETP contractuel proratisé — quotité actuelle");
    expect(glossaryEntry("absence-all-motifs")!.term).toBe("Taux d'absence, tous motifs");
    expect(KPI_TERMS.etpProrated).toBe("etp-prorated");
    expect(KPI_TERMS.absenceAllMotifs).toBe("absence-all-motifs");
    expect(KPI_TERMS.absenceByMotif).toBe("absence-par-motif");
  });
});

describe("remarque de la tuile ETP proratisé", () => {
  // Le qualifieur long vient du moteur (PayFit : date de lecture ; DSN : quotité du mois) ; la tuile n'en montre qu'une ligne courte.
  const payfit = etpProratedQualifier({ data: { build: { source: "payfit", referenceDate: "2026-10-21" } } } as never);
  const dsn = etpProratedQualifier({ data: { build: { source: "dsn", referenceDate: "2026-10-21" } } } as never);
  it("PayFit : « quotité à la date de lecture ; ni ETP payé ni historique exact »", () => {
    expect(payfit).toContain("(21/10/2026)");
    expect(etpProratedNotes([payfit])).toEqual(["quotité à la date de lecture ; ni ETP payé ni historique exact"]);
  });
  it("DSN : quotité déclarée dans la DSN du mois", () => {
    expect(etpProratedNotes([dsn])).toEqual(["quotité déclarée dans la DSN du mois ; ni ETP payé ni historique exact"]);
  });
  it("les autres remarques du moteur (borne basse) sont conservées, dédoublonnées ; un texte inconnu n'est jamais perdu", () => {
    const lower = "1 contrat(s) présent(s) sans quotité : total en borne basse";
    expect(etpProratedNotes([payfit, lower, lower])).toEqual(["quotité à la date de lecture ; ni ETP payé ni historique exact", lower]);
    expect(etpProratedNotes(["autre remarque du moteur"])).toEqual(["autre remarque du moteur"]);
    expect(etpProratedNotes([])).toEqual([]);
  });
  it("la remarque dit toujours que ce n'est ni un ETP payé ni un historique exact", () => {
    for (const q of [payfit, dsn]) expect(etpProratedNotes([q])[0]).toContain("ni ETP payé ni historique exact");
  });
});

describe("tuile « ETP contractuel proratisé — quotité actuelle »", () => {
  const tile = (over: Record<string, unknown> = {}) =>
    render(
      h(KpiTile, {
        id: "etp-prorated", slug: "demo", label: ETP_PRORATED_LABEL, shown: { text: "1,52", kind: "value" }, title: "fraction exacte : 91/60", n1: "1,40", n1Title: "avril 2025",
        delta: "+0,12 ETP", term: KPI_TERMS.etpProrated, detail: "?detail=etp-prorated&mois=2026-04#kpi-detail", detailN1: "?detail=etp-prorated&mois=2025-04#kpi-detail",
        qualifiers: ["Mois : avril 2026", "quotité à la date de lecture ; ni ETP payé ni historique exact"], ...over,
      }),
    );
  it("libellé exact, valeur, N-1, écart, « ? » vers le glossaire, détails", () => {
    const html = tile();
    expect(html).toContain('data-testid="kpi-tile-etp-prorated"');
    expect(text(html)).toContain("ETP contractuel proratisé — quotité actuelle");
    expect(html).toContain('href="/e/demo/glossaire#def-etp-prorated"');
    expect(html).toContain('title="fraction exacte : 91/60"');
    expect(html).toContain("N-1 : 1,40");
    expect(html).toContain("Écart : +0,12 ETP");
    expect(html).toContain('data-testid="kpi-tile-etp-prorated-detail-n1"');
    expect(html).toContain("quotité à la date de lecture ; ni ETP payé ni historique exact");
    expect(html).toContain("Mois : avril 2026");
  });
  it("un ETP n'est pas un montant : ni rouge ni vert sur l'écart", () => {
    expect(tile()).not.toMatch(/trend-(good|bad)/);
  });
  it("n.d. : la raison reste affichée avec la remarque de lecture, jamais zéro", () => {
    const html = tile({ shown: { text: "n.d. — aucune quotité lisible : contrat C1 sans quotité", kind: "nd" }, title: undefined, n1: "n.d. — mois antérieur à la lecture", delta: "n.d. — valeur n.d." });
    expect(html).toContain("n.d. — aucune quotité lisible : contrat C1 sans quotité");
    expect(html).toContain("N-1 : n.d. — mois antérieur à la lecture");
    expect(html).toContain("ni ETP payé ni historique exact");
    expect(html).not.toMatch(/>0[,.]00</);
  });
  it("cellule du tableau : deux décimales, fraction exacte au survol, « ≥ » en borne basse, n.d. avec raison", () => {
    // 91/60 = 1,51666… → 1,52 ; 5/3 = 1,6667 → ≥ 1,67.
    const exact = { month: "2026-04", kind: "exact", ratio: { num: 91, den: 60 }, qualifiers: [] } as unknown as EtpProrated;
    const lower = { month: "2026-04", kind: "lower_bound", ratio: { num: 5, den: 3 }, qualifiers: [] } as unknown as EtpProrated;
    const none = { month: "2026-04", kind: "nd", nd: { code: "quota-missing", reason: "aucune quotité lisible" }, missing: [] } as unknown as EtpProrated;
    expect(etpProratedShown(exact)).toEqual({ text: "1,52", kind: "value", foot: "fraction exacte : 91/60" });
    expect(etpProratedShown(lower)).toEqual({ text: "≥ 1,67", kind: "lower", foot: "fraction exacte : 5/3" });
    expect(etpProratedShown(none)).toEqual({ text: "n.d. — aucune quotité lisible", kind: "nd" });
  });
});

describe("détail de l'ETP proratisé : contrats comptés, jours sous contrat, part proratisée", () => {
  // Avril 2026, jours calendaires (30 j) : A 1 ETP tout le mois (30 j), B 0,5 ETP du 16 au 30 (15 j), C 0,8 ETP jusqu'au 10 (10 j).
  // Pondérations : 10000 × 30 = 300000 ; 5000 × 15 = 75000 ; 8000 × 10 = 80000 ; total 455000 ÷ 300000 = 91/60 = 1,52 (1,5167).
  // Parts : 1,0000 ; 0,2500 ; 0,2667 (80000 ÷ 300000 = 0,26667).
  const contribution = (key: string, etp4: number, from: string, to: string, days: number) => ({
    contractKey: key, externalId: key.toUpperCase(), personKey: null, establishmentId: "E1", nature: "01", kind: "etp", etp4, basis: "payfit_fte",
    source: { source: "payfit", fteAtRead: etp4 / 10000, isFullTimeAtRead: false, weeklyHoursAtRead: null, modalityAtRead: null },
    checks: [], provenance: null, from, to, days, weighted: etp4 * days,
  });
  const maps = { persons: new Map(), contracts: new Map() } as never;
  const v = {
    month: "2026-04", kind: "exact", ratio: { num: 455000, den: 300000 }, dayBasis: "calendar", monthDays: 30, missing: [], qualifiers: ["ETP contractuel proratisé : quotité à la date de lecture (21/10/2026), proratisée sur les jours sous contrat du mois ; ni ETP payé ni historique exact"],
    contributions: [contribution("a", 10000, "2026-04-01", "2026-04-30", 30), contribution("b", 5000, "2026-04-16", "2026-04-30", 15), contribution("c", 8000, "2026-04-01", "2026-04-10", 10)],
  } as unknown as EtpProrated;
  const detail = (value: EtpProrated) => render(h(EtpProratedDetail, { v: value, maps, slug: "demo", decimals: 4, refDate: "2026-10-21" }));

  it("une ligne par contrat compté, avec ses jours, sa quotité et sa part", () => {
    const html = detail(v);
    expect(html).toContain('data-testid="kpi-detail-contracts"');
    expect(html.match(/data-contract="/g)).toHaveLength(3);
    const t = text(html);
    expect(t).toContain("Jours sous contrat");
    expect(t).toContain("30 j");
    expect(t).toContain("15 j");
    expect(t).toContain("10 j");
    expect(html).toContain(">1,0000<");
    expect(html).toContain(">0,2500<");
    expect(html).toContain(">0,2667<");
    expect(t).toContain("16/04/2026");
  });
  it("total : 455 000 ÷ (10 000 × 30 j) = 91/60 = 1,52 ETP, avec le qualifieur de lecture", () => {
    const t = text(detail(v));
    expect(t).toContain("Σ (quotité × jours) = 455 000 dix-millièmes d'ETP-jours ÷ (10 000 × 30 j, jours calendaires) = 91/60 = 1,52 ETP (3 contrats)");
    expect(t).toContain("ni ETP payé ni historique exact");
  });
  it("un contrat sans date de début est listé, non compté : total en borne basse (≥), raison écrite", () => {
    const html = detail({
      ...v, kind: "lower_bound",
      missing: [{ kind: "missing", contractKey: "d", externalId: "D", personKey: null, establishmentId: null, nature: "01", source: null, nd: { code: "no-start-date", reason: "contrat sans date de début : jours sous contrat inconnus" } }],
    } as unknown as EtpProrated);
    expect(html).toContain('data-testid="kpi-detail-missing"');
    expect(text(html)).toContain("n.d. — contrat sans date de début : jours sous contrat inconnus");
    expect(text(html)).toContain("≥ 91/60 = 1,52 ETP");
  });
  it("n.d. : raison seule, aucun tableau, jamais zéro", () => {
    const html = detail({ month: "2026-04", kind: "nd", nd: { code: "quota-missing", reason: "aucune quotité lisible : contrat C1 sans quotité" }, missing: [] } as unknown as EtpProrated);
    expect(html).not.toContain('data-testid="kpi-detail-contracts"');
    expect(text(html)).toContain("n.d. — aucune quotité lisible : contrat C1 sans quotité");
    expect(html).not.toContain("0,00");
  });
});

describe("motifs retenus sous la valeur de la tuile Absentéisme", () => {
  it("libellés français des motifs retenus ; un code sans libellé est montré tel que reçu ; aucun motif : « aucun »", () => {
    expect(motifsRetenusLine(["fr_maladie_ordinaire"])).toBe("Motifs retenus : Maladie ordinaire (fr_maladie_ordinaire)");
    expect(motifsRetenusLine(["fr_maladie_ordinaire", "test_sickness"])).toBe("Motifs retenus : Maladie ordinaire (fr_maladie_ordinaire), test_sickness");
    expect(motifsRetenusLine([])).toBe("Motifs retenus : aucun");
  });
  it("la ligne passe par les remarques de la tuile (elle n'est pas filtrée comme une explication)", () => {
    expect(readingQualifiers([motifsRetenusLine(["test_sickness"])])).toEqual(["Motifs retenus : test_sickness"]);
  });
  it("tuile : la ligne est sous la valeur, le nom de la tuile reste « Absentéisme »", () => {
    const html = render(
      h(KpiTile, {
        id: "absenteeism", slug: "demo", label: "Absentéisme", shown: { text: "8,33 %", kind: "value" }, n1: "n.d.", delta: "n.d.", term: "absenteeism", detail: "?d", detailN1: "?n",
        qualifiers: [motifsRetenusLine(["test_sickness"])],
      }),
    );
    expect(text(html)).toContain("Absentéisme");
    expect(text(html)).toContain("Motifs retenus : test_sickness");
    expect(html.indexOf("8,33 %")).toBeLessThan(html.indexOf("Motifs retenus"));
  });
  it("bloc replié des motifs de la lecture : retenus, non retenus, retenus absents ; plus de « types »", () => {
    const sizes = { test_sickness: { persons: ["P1"], unlinked: 0 }, test_paid_leave: { persons: ["P1", "P2"], unlinked: 0 } };
    const html = render(h(AbsenceTypeNotes, { chosen: [{ type: "test_sickness", count: 3 }], other: [{ type: "test_paid_leave", count: 5 }], missing: [{ type: "fr_maladie_ordinaire" }], slug: "demo", mask: { setting: SEUIL_1, sizes } }));
    const t = text(html);
    expect(t).toContain("Retenus : test_sickness (3)");
    expect(t).toContain("Présents dans la lecture, non retenus : test_paid_leave (5)");
    expect(t).toContain("Retenus absents de la lecture : Maladie ordinaire");
    expect(t).not.toMatch(/Types? (comptés?|d'absence)/);
  });
});

describe("tableau par motif : adaptateur (cas écrits à la main)", () => {
  // 2 contrats, avril 2026, 120 demi-journées théoriques : maladie 10 (5 j) → 10/120 = 8,33 % ; congés 18 (9 j) → 15,00 % ;
  // motif incertain 2 (1 j) en borne basse → ≥ 1,67 % ; un motif n.d. garde sa raison.
  const lines: MotifLineIn[] = [
    { type: "fr_maladie_ordinaire", count: 2, inWindow: 1, chosen: true, kind: "exact", half: 10, ratio: { num: 10, den: 120 } },
    { type: "test_paid_leave", count: 3, inWindow: 2, chosen: false, kind: "exact", half: 18, ratio: { num: 18, den: 120 } },
    { type: "test_uncertain", count: 1, inWindow: 1, chosen: false, kind: "lower_bound", half: 2, ratio: { num: 2, den: 120 } },
    { type: "test_orphan", count: 1, inWindow: 1, chosen: false, kind: "nd", half: null, ratio: null, nd: { reason: "absence rattachée à un contrat inconnu" } },
  ];
  const sp = (t: string) => t.replace(/ /g, " ");
  it("une ligne par motif, retenu oui / non, demi-journées et taux ; libellé français quand il est connu", () => {
    const rows = motifRows(lines);
    expect(rows.map((r) => [r.type, r.label, r.count, r.inWindow, r.retained])).toEqual([
      ["fr_maladie_ordinaire", "Maladie ordinaire", 2, 1, true],
      ["test_paid_leave", null, 3, 2, false],
      ["test_uncertain", null, 1, 1, false],
      ["test_orphan", null, 1, 1, false],
    ]);
    expect([sp(rows[0].halfText), sp(rows[0].rateText)]).toEqual(["10 (5 j)", "8,33 %"]);
    expect([sp(rows[1].halfText), sp(rows[1].rateText)]).toEqual(["18 (9 j)", "15,00 %"]);
  });
  it("borne basse : « ≥ » devant les deux valeurs", () => {
    const r = motifRows(lines)[2];
    expect([r.kind, sp(r.halfText), sp(r.rateText)]).toEqual(["lower_bound", "≥ 2 (1 j)", "≥ 1,67 %"]);
  });
  it("n.d. : jamais zéro, la raison est conservée", () => {
    const r = motifRows(lines)[3];
    expect(r).toMatchObject({ kind: "nd", halfText: "n.d.", rateText: "n.d.", reason: "absence rattachée à un contrat inconnu" });
    expect(`${r.halfText} ${r.rateText}`).not.toMatch(/\d/);
  });
});

describe("détail de l'absentéisme : tableau par motif et taux tous motifs, à part", () => {
  const sp = (t: string) => t.replace(/ /g, " ");
  const win = { from: "2026-04", to: "2026-04", label: "avril 2026", months: ["2026-04"] };
  const motifs: AbsenceMotifs = {
    window: win as never,
    label: ABSENCE_ALL_MOTIFS_LABEL,
    lines: [
      { type: "fr_maladie_ordinaire", count: 2, inWindow: 1, chosen: true, kind: "exact", half: 10, ratio: { num: 10, den: 120 }, qualifiers: [], persons: ["P1"], unlinked: 0 },
      { type: "test_paid_leave", count: 3, inWindow: 2, chosen: false, kind: "exact", half: 18, ratio: { num: 18, den: 120 }, qualifiers: [], persons: ["P1", "P2"], unlinked: 0 },
      { type: "test_orphan", count: 1, inWindow: 1, chosen: false, kind: "nd", half: null, ratio: null, nd: { code: "absence-unknown-contract", reason: "absence rattachée à un contrat inconnu", months: [], keys: [] } as never },
    ],
    // Tous motifs : 10 demi-journées de maladie ∪ 18 de congés avec 6 en commun = 22 (comptées une fois) ; 22/120 = 18,33 %.
    all: { kind: "exact", ratio: { num: 22, den: 120 }, months: [], qualifiers: [] },
    emptyReason: null,
  };
  const v = { kind: "exact", ratio: { num: 10, den: 120 }, months: [], qualifiers: [] } as never;
  const theoretical = { kind: "exact", half: 120, months: [], contributions: [] } as never;
  // Seuil de 1 personne : le tableau est celui du lot 11 (le masquage est testé dans kpi-confidentialite.test.ts).
  const detail = (m?: AbsenceMotifs, slug: string | null = "demo") => render(h(AbsenteeismWindowDetail, { v, theoretical, detailHref: () => "?", motifs: m, slug: slug ?? undefined, confidentialite: SEUIL_1 }));

  it("tous les motifs présents : libellé et code, nombres d'absences, retenu oui / non, demi-journées, taux", () => {
    const html = detail(motifs);
    expect(html).toContain('data-testid="kpi-detail-motifs"');
    expect(html.match(/data-motif="/g)).toHaveLength(3);
    expect(html).toContain('data-motif="fr_maladie_ordinaire" data-retained="oui"');
    expect(html).toContain('data-motif="test_paid_leave" data-retained="non"');
    const t = sp(text(html));
    expect(t).toContain("Maladie ordinaire fr_maladie_ordinaire 2 1 oui 10 (5 j) 8,33 %");
    expect(t).toContain("test_paid_leave 3 2 non 18 (9 j) 15,00 %");
    expect(t).toContain("Absences de la lecture");
    expect(t).toContain("Absences de la période");
  });
  it("motif n.d. : la raison est écrite dans la ligne, aucun zéro à la place", () => {
    const row = /<tr data-motif="test_orphan"[\s\S]*?<\/tr>/.exec(detail(motifs))![0];
    expect(text(row)).toContain("n.d. — absence rattachée à un contrat inconnu");
    expect(text(row)).not.toMatch(/0,00|\b0 \(/);
  });
  it("taux tous motifs : bloc séparé du tableau, nommé par le libellé exact, avec son « ? », sans le mot « absentéisme »", () => {
    const html = detail(motifs);
    const table = /<table[\s\S]*?<\/table>/.exec(html)![0];
    expect(table).not.toContain("tous motifs");
    expect(table).not.toContain("18,33");
    const block = html.slice(html.indexOf('data-testid="kpi-detail-motifs-all-block"'));
    expect(text(block)).toContain("Taux d'absence, tous motifs");
    expect(sp(text(block))).toContain("22 demi-journées = 11 j ÷ 60 j = 18,33 %");
    expect(block).toContain('href="/e/demo/glossaire#def-absence-all-motifs"');
    expect(text(block)).not.toMatch(/bsentéisme/i);
    // Le total de l'absentéisme (motifs retenus) reste celui de la tuile : 8,33 %, jamais 18,33 %.
    const main = /<p[^>]*data-testid="kpi-detail-total"[\s\S]*?<\/p>/.exec(html)![0];
    expect(sp(text(main))).toContain("= 8,33 %");
    expect(main).not.toContain("18,33");
    expect(html).toContain('href="/e/demo/glossaire#def-absence-par-motif"');
  });
  it("taux tous motifs n.d. : sa raison est écrite, jamais un zéro", () => {
    const html = detail({ ...motifs, all: { kind: "nd", nd: { code: "absence-unknown-contract", reason: "absence rattachée à un contrat inconnu" } as never, months: [] } });
    const p = /<p[^>]*data-testid="kpi-detail-motifs-all"[\s\S]*?<\/p>/.exec(html)![0];
    expect(text(p)).toBe("n.d. — absence rattachée à un contrat inconnu");
  });
  it("aucun motif dans la lecture : ni tableau ni zéro, la raison du moteur et le taux tous motifs n.d.", () => {
    const reason = "aucune absence dans la lecture : aucun motif à détailler";
    const html = detail({ ...motifs, lines: [], all: { kind: "nd", nd: { code: "no-absence-motif", reason } as never, months: [] }, emptyReason: reason });
    expect(html).not.toContain('data-testid="kpi-detail-motifs"');
    expect(text(/<p[^>]*data-testid="kpi-detail-motifs-empty"[\s\S]*?<\/p>/.exec(html)![0])).toBe(`n.d. — ${reason}`);
    expect(text(/<p[^>]*data-testid="kpi-detail-motifs-all"[\s\S]*?<\/p>/.exec(html)![0])).toBe(`n.d. — ${reason}`);
  });
  it("sans motifs (ou sans espace) : le détail historique est inchangé, aucune section ajoutée", () => {
    for (const html of [detail(undefined), detail(motifs, null)]) {
      expect(html).not.toContain("kpi-detail-motifs");
      expect(html).toContain('data-testid="kpi-detail-total"');
    }
  });
});

describe("écran KPI RH : assemblage (lecture du code de la page)", () => {
  const page = read("src/app/e/[slug]/studio-rh/kpi/page.tsx");
  it("la tuile proratisée est à côté de « ETP fin de mois », qui reste, avec le libellé exact (constante)", () => {
    const end = page.indexOf('id="etp-end"');
    const pr = page.indexOf('id="etp-prorated"');
    const avg = page.indexOf('id="etp-avg"');
    expect(end).toBeGreaterThan(0);
    expect(pr).toBeGreaterThan(end);
    expect(avg).toBeGreaterThan(pr);
    expect(page).toContain("label={ETP_PRORATED_LABEL}");
    expect(page).toContain('label={`ETP contractuel fin ${monthLabel(w.to)}`}');
    expect(page).toContain('"etp-prorated": ETP_PRORATED_LABEL');
  });
  it("colonne « ETP proratisé — quotité actuelle » après « ETP fin de mois », détail cliquable de chaque mois, aucune valeur de période", () => {
    expect(page.indexOf('<th className="num wrap">ETP fin de mois</th>')).toBeLessThan(page.indexOf('<th className="num wrap">ETP proratisé — quotité actuelle</th>'));
    expect(page).not.toContain('<th className="num wrap">ETP proratisé</th>');
    expect(page).toContain('href={detailHref("etp-prorated", r.month)}');
    expect(page).toContain('<td data-col="etp-prorated" />');
    expect(page).toContain('detail.id === "etp-prorated" && <EtpProratedDetail');
  });
  it("l'absentéisme garde son nom, ajoute la ligne des motifs retenus, et son détail de période reçoit absenceByMotif", () => {
    expect(page).toContain('label="Absentéisme"');
    expect(page).toContain("motifsRetenusLine(dash.params.absenceTypes)");
    expect(page).toContain("motifs={absenceByMotif(input, detail.window)}");
  });
  it("ni rouge ni vert, aucune formule de calcul ajoutée sur l'écran", () => {
    expect(page).not.toMatch(/trend-(good|bad)|costTone|trendClass/);
  });
});

describe("Paramètres › Définitions des KPI : motifs retenus", () => {
  const props = (over: Partial<KpiFormProps> = {}, absenceTypes: string[] = []): KpiFormProps => ({
    slug: "demo",
    values: { fullTimeIsOne: true, capAtOne: true, forfaitJoursIsOne: true, etpDecimals: 4, turnoverFormula: "half_sum", excludedExitNatures: [], neutralizeContinuity: true, absenceTypes, absenceStatuses: ["approved"], dayBasis: "calendar" },
    origins: {},
    kinds: { fullTimeIsOne: "validated", capAtOne: "validated", forfaitJoursIsOne: "validated", etpDecimals: "validated", turnoverFormula: "validated", neutralizeContinuity: "validated", excludedExitNatures: "validated", absenceTypes: "validated", absenceStatuses: "validated", dayBasis: "validated" },
    notes: { etp: null, turnover: null, absence: null },
    natures: [{ code: "01", label: "CDI" }],
    types: [
      { type: "fr_maladie_ordinaire", label: "Maladie ordinaire", count: 3, inRead: true },
      { type: "test_paid_leave", label: null, count: 1, inRead: true },
      { type: "test_sickness", label: null, count: 2, inRead: true },
    ],
    readLabel: "lecture du 21/10/2026",
    statuses: [{ code: "approved", label: "approuvée" }],
    disabled: false,
    helps: { absenceTypes: h(GlossaryLink, { slug: "demo", term: KPI_TERMS.absenceTypes }) },
    ...over,
  });
  const inputs = (html: string) => [...html.matchAll(/<input [^>]*name="absenceTypes"[^>]*>/g)].map((m) => m[0]);

  it("le champ s'intitule « Motifs retenus pour l'absentéisme » et liste tous les motifs de la lecture (libellé, code, nombre)", () => {
    const html = render(h(KpiForm, props()));
    expect(html).toContain('id="kpi-types-title">Motifs retenus pour l&#x27;absentéisme</span>');
    expect(inputs(html)).toHaveLength(3);
    const t = text(html);
    expect(t).toContain("Maladie ordinaire fr_maladie_ordinaire 3 absences");
    expect(t).toContain("Motif sans libellé connu test_paid_leave 1 absence");
    expect(t).toContain("Motif sans libellé connu test_sickness 2 absences");
    expect(html).toContain('href="/e/demo/glossaire#def-kpi-types-absence"');
  });
  it("aucune case n'est cochée d'office par un nom : seules les valeurs enregistrées le sont", () => {
    expect(inputs(render(h(KpiForm, props()))).filter((i) => /checked/.test(i))).toHaveLength(0);
    const one = inputs(render(h(KpiForm, props({}, ["test_sickness"])))).filter((i) => /checked/.test(i));
    expect(one).toHaveLength(1);
    expect(one[0]).toContain('value="test_sickness"');
  });
  it("phrase d'aide en une ligne : cocher explicitement ; aucune consigne propre à un espace dans le produit", () => {
    const html = render(h(KpiForm, props()));
    expect(text(html)).toContain("Cocher explicitement les motifs à compter ; les autres restent visibles dans le détail.");
    expect(text(html)).not.toMatch(/maladie et accidents|congés et RTT|à laisser décochés/i);
  });
  it("aucun motif retenu : l'absentéisme n.d. est dit ; aucune lecture appliquée : rien à choisir, avec la raison", () => {
    expect(text(render(h(KpiForm, props())))).toContain("Aucun motif retenu : absentéisme n.d.");
    const none = render(h(KpiForm, props({ readLabel: null, types: [], helps: undefined })));
    expect(text(none)).toContain("Aucune lecture PayFit appliquée : aucun motif à choisir. DSN : arrêts non extraits.");
    expect(none).toContain('data-testid="setting-kpi-types-empty"');
  });
  it("le réglage des jours dit qu'il sert aussi au prorata de l'ETP proratisé", () => {
    expect(text(render(h(KpiForm, props())))).toContain("Base de comptage des jours : absentéisme et prorata de l'ETP proratisé");
  });
  it("les identifiants de test existants sont conservés", () => {
    const html = render(h(KpiForm, props({ types: [...props().types, { type: "test_gone", label: null, count: 0, inRead: false }] }, ["test_gone"])));
    for (const t of ["setting-kpi-absence-types", "setting-kpi-types-missing", "setting-kpi-absence-statuses", "setting-kpi-absence-basis", "setting-kpi-save"]) expect(html, t).toContain(`data-testid="${t}"`);
  });
});

describe("glossaire : ETP proratisé, taux tous motifs, absentéisme (lot 11)", () => {
  const entry = (id: string) => glossaryEntry(id)!;
  it("trois nouvelles entrées dans « KPI RH », ids stables, un seul exemplaire dans tout le glossaire, formule en une ligne", () => {
    for (const id of ["etp-prorated", "absence-all-motifs", "absence-par-motif"]) {
      expect(entry(id).family, id).toBe("KPI RH");
      expect(GLOSSARY_KPI.filter((e) => e.id === id), id).toHaveLength(1);
      expect(GLOSSARY.filter((e) => e.id === id), id).toHaveLength(1);
      expect(entry(id).formula ?? "", id).not.toContain("\n");
    }
    expect(entry("etp-prorated").formula).toBe("Σ (quotité × jours sous contrat du mois) ÷ jours du mois");
  });
  it("ETP proratisé : ni ETP payé ni historique exact, quotité à la date de lecture, base de jours = réglage", () => {
    const d = entry("etp-prorated").definition;
    expect(d).toContain("Ce n'est ni un ETP payé ni un historique exact");
    expect(d).toContain("la quotité à la date de lecture");
    expect(d).toContain("la base de jours choisie dans Paramètres");
    expect(d).toContain("la même que pour l'absentéisme");
    expect(d).toContain("0,5 × 15 ÷ 30 = 0,25 ETP"); // exemple écrit à la main : 15 ÷ 30 = 0,5 ; × 0,5 = 0,25
    expect(d).toContain("Il complète l'ETP contractuel fin de mois sans le remplacer");
    expect(d).toContain("borne basse");
  });
  it("taux tous motifs : tous les motifs présents, demi-journées chevauchantes comptées une fois, ne remplace pas l'absentéisme", () => {
    const d = entry("absence-all-motifs").definition;
    expect(d).toContain("tous les motifs d'absence présents dans la lecture PayFit");
    expect(d).toContain("Ce n'est pas l'absentéisme");
    expect(d).toContain("ce taux ne la remplace pas");
    expect(d).toContain("comptée une seule fois");
    expect(d).toContain("la somme des taux par motif peut donc dépasser ce taux");
    expect(entry("absence-all-motifs").formula).toBe("demi-journées d'absence de tous les motifs ÷ demi-journées théoriques");
  });
  it("absentéisme : les motifs retenus sont ceux que l'espace a choisis ; aucun nom de motif dans la règle du produit", () => {
    const d = entry("absenteeism").definition;
    expect(d).toContain("Motifs retenus : ceux que l'espace a choisis dans Paramètres › Définitions des KPI");
    expect(d).toContain("le calcul ne reconnaît aucun motif par son nom");
    expect(d).toContain("Tous les motifs présents dans la lecture restent visibles dans le détail de l'absentéisme");
    expect(d).not.toMatch(/fr_maladie_ordinaire|par défaut : maladie|congés et RTT/);
    expect(entry("absenteeism").formula).toBe("jours d'absence ÷ jours théoriques"); // l'ancien taux n'est pas rebaptisé
    expect(entry("absenteeism").term).toBe("Absentéisme");
  });
  it("motifs retenus : terme et définition à jour (nombre d'absences de la lecture, motif sans libellé affiché tel que reçu)", () => {
    const e = entry("kpi-types-absence");
    expect(e.term).toBe("Motifs retenus pour l'absentéisme");
    // Cohérent avec « Absentéisme » : à défaut de choix enregistré, la valeur par défaut validée s'applique (aucune contradiction).
    expect(e.definition).toContain("À défaut de choix enregistré, la valeur par défaut validée s'applique (son origine est indiquée dans Paramètres)");
    expect(e.definition).toContain("l'administrateur coche explicitement les motifs à compter");
    expect(e.definition).not.toContain("d'office");
    expect(entry("absenteeism").definition).toContain("la valeur par défaut validée s'applique (son origine est indiquée dans Paramètres)");
    expect(e.definition).toContain("nombre d'absences dans toute la lecture");
    expect(e.definition).toContain("affiché tel que reçu de PayFit");
  });
  it("l'ETP moyen renvoie à l'indicateur proratisé sans en reprendre le calcul ; les voisins existent", () => {
    expect(entry("etp-average").definition).toContain("n'est pas appliqué à l'ETP moyen");
    expect(entry("etp-month-end").see).toContain("etp-prorated");
    for (const id of ["etp-prorated", "absence-all-motifs", "absence-par-motif", "absenteeism", "kpi-types-absence"]) {
      for (const s of entry(id).see ?? []) expect(glossaryEntry(s), `${id} → ${s}`).toBeDefined();
    }
  });
  it("français de produit : ni tutoiement ni vocabulaire interne dans les entrées touchées", () => {
    for (const id of ["etp-prorated", "absence-all-motifs", "absence-par-motif", "absenteeism", "kpi-types-absence", "etp-average"]) {
      expect(`${entry(id).term} ${entry(id).definition}`, id).not.toMatch(/outil observé|webinaire|\bcahier\b|compte pilote|\btu\b|\btoi\b|\bton\b|\bta\b/i);
    }
  });
});

describe("feuille de style : univers bleu / blanc / noir conservé", () => {
  it("aucune teinte de tendance ni couleur codée en dur ajoutée pour le bloc des motifs", () => {
    const css = read("src/styles/kpi.css");
    expect(css).toContain(".kpi-motif-all");
    const block = css.slice(css.indexOf(".kpi-motif-all"), css.indexOf(".kpi-motif-all") + 160);
    expect(block).not.toMatch(/#[0-9a-f]{3,6}|--bad|--good|rgba?\(/i);
  });
});
