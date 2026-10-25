import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeriodModeFields, type PeriodModeFieldsProps } from "@/app/e/[slug]/studio-rh/kpi/PeriodModeFields";
import { PayfitNotice } from "@/app/e/[slug]/studio-rh/kpi/components";

const options: Omit<PeriodModeFieldsProps, "initialMode"> = {
  initialEnd: "2026-09",
  initialYear: "2025",
  ends: [{ value: "2026-09", label: "2026-09" }, { value: "2025-09", label: "2025-09 — borne basse" }],
  years: [{ value: "2026", label: "2026 — non close" }, { value: "2025", label: "2025" }],
};

describe("période des KPI : un choix temporel à la fois", () => {
  it("glissant : seule la fin est sélectionnable, l'année civile reste soumise en GET", () => {
    const html = renderToStaticMarkup(h(PeriodModeFields, { ...options, initialMode: "glissant" }));
    expect(html).toContain('id="fin" name="fin"');
    expect(html).toContain('<option value="2026-09" selected="">');
    expect(html).toContain('<input type="hidden" name="annee" value="2025"/>');
    expect(html).not.toContain('id="annee"');
    expect(html.match(/<select /g)).toHaveLength(2);
    expect(html).toContain("2025-09 — borne basse");
    expect(html.match(/name="fin"/g)).toHaveLength(1);
    expect(html.match(/name="annee"/g)).toHaveLength(1);
  });
  it("civil : seule l'année est sélectionnable, la fin glissante reste soumise en GET", () => {
    const html = renderToStaticMarkup(h(PeriodModeFields, { ...options, initialMode: "civil" }));
    expect(html).toContain('id="annee" name="annee"');
    expect(html).toContain('<option value="2025" selected="">');
    expect(html).toContain('<input type="hidden" name="fin" value="2026-09"/>');
    expect(html).not.toContain('id="fin"');
    expect(html.match(/<select /g)).toHaveLength(2);
    expect(html).toContain("2026 — non close");
    expect(html.match(/name="fin"/g)).toHaveLength(1);
    expect(html.match(/name="annee"/g)).toHaveLength(1);
  });
});

describe("limites PayFit : la date n'est pas répétée dans la précision des quotités", () => {
  it("conserve la date dans le résumé et les limites de l'historique dans le détail", () => {
    const ctx = {
      collab: {
        slug: "demo",
        payfitHistory: null,
        data: {
          coverage: [{ month: "2025-09", presenceStatus: "lower_bound" }],
          build: { source: "payfit", referenceDate: "2026-10-24" },
        },
      },
    } as never;
    const html = renderToStaticMarkup(h(PayfitNotice, { ctx }));
    expect(html.match(/24\/10\/2026/g)).toHaveLength(1);
    expect(html).toContain("quotités à la date de lecture (24/10/2026)");
    expect(html).toContain("Quotités non historisées par PayFit : la même quotité sert pour tous les mois, N-1 compris.");
    expect(html).toContain("Contrats archivés non renvoyés par PayFit");
    expect(html).toContain("effectif et ETP exacts à partir du 24/10/2025");
    expect(html).toContain("turnover et absentéisme n.d. sur toute période qui en contient un");
    expect(html).toContain('href="/e/demo/glossaire#def-kpi-limites-lecture"');
  });
});
