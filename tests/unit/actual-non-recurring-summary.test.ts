import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActualNonRecurringSummary } from "@/components/ActualNonRecurringSummary";
import type { ActualEvent, ActualNonRecurring } from "@/lib/payroll/non-recurring";
import { estimateActualOverlap } from "@/lib/payroll/actual-overlap";
import type { RcPayslipPeriod } from "@/lib/payroll/rc-payslips";
import type { LiveNonRecurring } from "@/lib/payroll/live-non-recurring";

const SYNC = "11111111-1111-4111-8111-111111111111";
const rows = (...values: { kind: ActualEvent["kind"]; amount: number | null; reason?: string | null }[]): ActualNonRecurring["rows"] => values.map((value, index) => ({
  event: { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, syncId: SYNC, month: "2026-02", kind: value.kind,
    chargedCents: value.amount, contractKeys: ["CONTRAT_PRIVE_FICTIF"], note: "SOURCE_PRIVEE_FICTIVE" },
  amount: value.amount, reason: value.reason ?? null,
}));
const href = "/e/espace-fictif/studio-rh/masse-salariale?annee=2026&de=01&a=10&service=service-fictif&repartition=mensuelle#actual-non-recurring";
const render = (selected: ActualNonRecurring["rows"] = [], unavailable = false) => renderToStaticMarkup(createElement(ActualNonRecurringSummary, { rows: selected, href, unavailable }));
const category = (html: string, kind: ActualEvent["kind"]) => html.match(new RegExp(`<div data-testid="actual-non-recurring-summary-${kind}">[\\s\\S]*?<\\/div>`))?.[0] ?? "";

describe("résumé des éléments non récurrents — données fictives", () => {
  it("conserve les quatre catégories à vide sans transformer l’absence d’identification en zéro", () => {
    const html = render();
    for (const kind of ["licenciement", "rupture-conventionnelle", "tuilage", "autre"] as const) expect(category(html, kind)).toContain("Aucun élément identifié");
    expect(html).not.toContain("data-money-cents");
    expect(html).toContain("Vigilance");
    expect(html).toContain("Aucun élément identifié ne signifie pas");
    expect(html).toContain("Coûts identifiés sur la période affichée");
    expect(html).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
  });

  it("affiche les montants agrégés RC et tuilage résolus et le zéro explicitement identifié", () => {
    const html = render(rows({ kind: "rupture-conventionnelle", amount: 12000 }, { kind: "rupture-conventionnelle", amount: 23000 }, { kind: "tuilage", amount: 7000 }, { kind: "licenciement", amount: 0 }));
    expect(category(html, "rupture-conventionnelle")).toContain('data-money-cents="35000"');
    expect(category(html, "rupture-conventionnelle")).toContain("2 éléments identifiés");
    expect(category(html, "tuilage")).toContain('data-money-cents="7000"');
    expect(category(html, "licenciement")).toContain('data-money-cents="0"');
    expect(html).not.toMatch(/CONTRAT_PRIVE_FICTIF|SOURCE_PRIVEE_FICTIVE|11111111-1111|00000000-0000/);
  });

  it("une RC incomplète reste n.d. sans exposer le sous-total connu ; le tuilage résolu reste lisible", () => {
    const html = render(rows({ kind: "rupture-conventionnelle", amount: 12000 }, { kind: "rupture-conventionnelle", amount: null, reason: "Montant chargé non saisi ; saisir un montant ou un zéro explicite." }, { kind: "tuilage", amount: 7000 }));
    const rc = category(html, "rupture-conventionnelle");
    expect(rc).toContain("n.d."); expect(rc).toContain("Montant à renseigner");
    expect(rc).not.toContain("data-money-cents");
    expect(category(html, "tuilage")).toContain('data-money-cents="7000"');
  });

  it("signale une ancienne lecture et conserve le montant n.d., sans réutiliser chargedCents", () => {
    const selected = rows({ kind: "rupture-conventionnelle", amount: null, reason: "Événement rattaché à une autre lecture de paie ; vérifier son rattachement avant de le reprendre." });
    selected[0].event.chargedCents = 67890;
    const html = render(selected);
    expect(category(html, "rupture-conventionnelle")).toContain("Lecture à vérifier");
    expect(html).not.toContain('data-money-cents="67890"');
    expect(html).toContain("Vérifier son rattachement dans le détail");
  });

  it("qualifie un tuilage estimé sans transmettre ses rôles, dates ou lignes de provenance", () => {
    const estimated = estimateActualOverlap({ month: "2026-02", syncId: SYNC,
      incoming: { contractKey: "ENTRANT_PRIVE_FICTIF", syncId: SYNC, startDate: "2026-02-11", endDate: null },
      outgoing: { contractKey: "SORTANT_PRIVE_FICTIF", syncId: SYNC, startDate: "2020-01-01", endDate: "2026-02-19" },
      payroll: { syncId: SYNC, month: "2026-02", contractKey: "ENTRANT_PRIVE_FICTIF", chargedCents: 140000, lineKeys: ["LIGNE_PRIVEE_FICTIVE"] } });
    if (estimated.kind !== "value") throw new Error("Fixture refusée");
    const selected = rows({ kind: "tuilage", amount: estimated.amountCents });
    selected[0].event.calculation = estimated.calculation;
    const html = render(selected);
    expect(category(html, "tuilage")).toContain("Estimation calendaire");
    expect(html).toContain("cette ventilation n’est pas observée dans la paie");
    expect(html).not.toMatch(/ENTRANT_PRIVE|SORTANT_PRIVE|LIGNE_PRIVEE|2026-02-11|2026-02-19/);
  });

  it("la lecture indisponible reste distincte d’une absence d’identification et les raisons brutes restent privées", () => {
    const html = render([], true);
    expect(html).toContain("Lecture indisponible");
    expect(html).not.toContain("Aucun élément identifié");
    const invalid = render(rows({ kind: "autre", amount: null, reason: "SOURCE_LIGNE_PRIVEE_FICTIVE" }));
    expect(invalid).toContain("À vérifier");
    expect(invalid).not.toContain("SOURCE_LIGNE_PRIVEE_FICTIVE");
  });

  it("reprend les entrées fusionnées pour le coût chargé et le compte, sans doubler la déclaration RC avec son bulletin", () => {
    const declared = rows({ kind: "rupture-conventionnelle", amount: null, reason: "Montant chargé non saisi ; saisir un montant ou un zéro explicite." });
    const rc: RcPayslipPeriod = { status: "value", amountCents: 125000, identifiedCount: 1, mergedCount: 1, reviewCount: 0, reason: null, rows: [], costStatus: "value", chargedCents: 140000, employerChargesCents: 15000, costReason: null };
    const live: LiveNonRecurring = { rows: declared, sourceRows: [], entries: [{ month: "2026-02", kind: "rupture-conventionnelle", amount: 140000, reason: null, estimated: false }], count: 1, raw: 400000, nonRecurring: 140000, adjusted: 260000, reasons: [] };
    const html = renderToStaticMarkup(createElement(ActualNonRecurringSummary, { rows: declared, live, rc, href }));
    const result = category(html, "rupture-conventionnelle");
    expect(result).toContain("Coût chargé RC");
    expect(result).toContain('data-money-cents="140000"');
    expect(result).toContain('data-money-cents="125000"');
    expect(result).toContain("Indemnité RC · bulletin");
    expect(result).toContain("1 élément identifié");
    expect(result).not.toContain("Montant à renseigner");
    expect(result).not.toContain("2 éléments");
    expect(html).not.toMatch(/CONTRAT_PRIVE|SOURCE_PRIVEE|11111111-1111|00000000-0000/);
  });

  it("ne masque pas le nominal connu lorsque le coût chargé fusionné reste ambigu", () => {
    const rc: RcPayslipPeriod = { status: "value", amountCents: 125000, identifiedCount: 1, mergedCount: 1, reviewCount: 0, reason: null, rows: [], costStatus: "review", chargedCents: null, employerChargesCents: null, costReason: "Contributions patronales propres à la RC non isolées." };
    const live: LiveNonRecurring = { rows: [], sourceRows: [], entries: [{ month: "2026-02", kind: "rupture-conventionnelle", amount: null, reason: "Coût chargé de RC non confirmé par les bulletins", estimated: false }], count: 1, raw: 400000, nonRecurring: null, adjusted: null, reasons: [] };
    const html = renderToStaticMarkup(createElement(ActualNonRecurringSummary, { rows: [], live, rc, href }));
    const result = category(html, "rupture-conventionnelle");
    expect(result).toContain('data-money-cents="125000"');
    expect(result).toContain("Coût chargé à vérifier");
    expect(result).toContain("n.d.");
    expect(html).toContain("Contributions patronales propres à la RC non isolées");
    expect(html).toContain("Vigilance");
  });
});
