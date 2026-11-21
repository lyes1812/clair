import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublisherView } from "@/app/e/[slug]/studio-rh/kpi/PublisherView";
import { PrintAction } from "@/app/e/[slug]/studio-rh/reporting-social/PrintAction";
import type { PublisherReport } from "@/lib/reporting/publisher";
import { previousWindow, rollingWindow } from "@/lib/rh/kpi/period";
vi.mock("@/db/client", () => ({ db: {} }));

function report(): PublisherReport {
  const window = rollingWindow("2026-09");
  const nd = { text: "n.d.", kind: "nd" as const, reason: "Motif d’absence fictif non disponible.", qualifiers: [] };
  const value = { text: "complet", kind: "value" as const, reason: null, qualifiers: [] };
  return {
    kind: "ready", reason: null, selection: { blocks: ["absenteisme"], monthly: false, submitted: true, notices: [] },
    window, previousWindow: previousWindow(window), period: { mode: "glissant", fin: "2026-09", year: 2025, closed: ["2026-09"], years: [{ year: 2025, closed: true }] },
    source: { kind: "dsn", referenceDate: "2026-10-21", readAt: "2026-10-21T09:00:00Z", changedAt: null },
    limits: [], notices: [], metrics: [{ id: "absenteisme", label: "Absentéisme", term: "absenteeism", unit: "rate", period: window.label, current: nd, previous: nd }],
    previous: { available: false, reason: "N-1 incomplet pour le bloc choisi." }, columns: ["absenteeism"],
    rows: [{ month: "2026-09", coverage: value, headcount: value, etp: value, entries: value, exits: value, absenteeism: nd }],
    definitions: [{ id: "absenteeism", term: "Absentéisme", definition: "Définition fictive de l’indicateur.\n\nRègle fictive de couverture.", formula: "jours d’absence ÷ jours théoriques" }],
    parameters: [{ label: "Motifs retenus pour l’absentéisme", value: "Motif fictif", origin: "Valeur fictive configurée." }],
  };
}
const render = (data = report()) => renderToStaticMarkup(createElement(PublisherView, { report: data, slug: "espace-fictif", workspaceName: "Structure fictive" }));

describe("Publisher : aperçu et document imprimé", () => {
  it("rend seulement le bloc choisi, son n.d., ses définitions et sources obligatoires sans détail mensuel", () => {
    const html = render();
    expect(html).toContain('data-testid="publisher-block-absenteisme"');
    expect(html).not.toContain('data-testid="publisher-block-effectifs"');
    expect(html).not.toContain('data-testid="publisher-block-mouvements"');
    expect(html).not.toContain('data-testid="publisher-rh-table"');
    expect(html).toContain("Motif d’absence fictif non disponible.");
    expect(html).toContain("Définition fictive de l’indicateur.");
    expect(html).toContain("Valeur fictive configurée.");
    expect(html).toContain('data-testid="publisher-provenance"');
    expect(html).toContain('data-testid="rs-print"');
    expect(html).toContain("Prévisualise pour appliquer tes choix.");
    expect(html).not.toContain("Masse salariale");
    expect(html).not.toContain("data-money-cents");
  });
  it("le détail mensuel expose seulement les colonnes des blocs retenus", () => {
    const data = report(); data.selection.monthly = true;
    const html = render(data);
    expect(html).toContain('data-testid="publisher-rh-table"');
    expect(html).toContain("Couverture RH");
    expect(html).not.toContain('<th scope="col" class="num">Entrées</th>');
    expect(html).not.toContain('<th scope="col" class="num">ETP fin de mois</th>');
    expect(html).toContain('<th scope="col" class="num">Absentéisme</th>');
  });
  it("une composition vide ou des paramètres invalides ne permettent pas d'imprimer de faux repères", () => {
    const data = report();
    data.kind = "empty"; data.reason = "Choisis au moins un bloc."; data.selection.blocks = []; data.metrics = [];
    const html = render(data);
    expect(html).toContain("Aucun bloc sélectionné");
    expect(html).not.toContain('data-testid="rs-print"');
    expect(html).not.toContain('data-testid="rs-metric-');
    data.kind = "settings-invalid"; data.reason = "Paramètres des KPI illisibles.";
    expect(render(data)).toContain("/e/espace-fictif/parametres#kpi");
    expect(render(data)).not.toContain('data-testid="rs-print"');
  });
  it("l'action d'impression commune accepte le garde sans changer son comportement par défaut", () => {
    const enabled = renderToStaticMarkup(createElement(PrintAction));
    const disabled = renderToStaticMarkup(createElement(PrintAction, { disabled: true, describedBy: "publisher-draft-status" }));
    expect(enabled).not.toContain("disabled=");
    expect(disabled).toContain('disabled=""');
    expect(disabled).toContain('aria-describedby="publisher-draft-status"');
    expect(disabled).toContain("Imprimer / Enregistrer en PDF");
  });
});
