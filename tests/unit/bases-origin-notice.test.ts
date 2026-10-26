import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { BasesView } from "@/app/e/[slug]/studio-rh/hypotheses/BasesView";
import type { ScenarioRow } from "@/lib/budget/store";
import type { BaseSnapshot } from "@/lib/budget/types";
import { BUDGET_TERMS } from "@/lib/glossary/budget";

vi.mock("@/app/e/[slug]/studio-rh/hypotheses/actions", () => ({ saveBasesAction: async () => undefined }));

it("conserve l'origine commune et ne replie jamais les éléments non repris dans la base", () => {
  const commonPage = readFileSync("src/app/e/[slug]/studio-rh/hypotheses/page.tsx", "utf8");
  const commonContext = commonPage.split('data-testid="hyp-context"')[1]?.split("</p>")[0] ?? "";
  expect(commonContext).toContain("Base dérivée du scénario");
  expect(commonContext).toContain("full.base.origin.scenarioName");
  expect(commonContext).toContain("full.base.origin.month");
  const base: BaseSnapshot = {
    currency: "EUR", refMonth: "2026-09", syncId: "lecture-fictive", readAt: "2026-10-01", contracts: [], actuals: [],
    refMasse: 0, refBaseCost: 0, etpNote: null,
    origin: { kind: "scenario", scenarioId: "scenario-parent-fictif", scenarioName: "Parent fictif", month: "2026-09", at: "2026-10-01", notCarried: [] },
  };
  const scenario = { id: "scenario-fictif", firstMonth: "2026-10", lastMonth: "2026-12" } as ScenarioRow;
  const render = (input: BaseSnapshot) => renderToStaticMarkup(h(BasesView, { slug: "fixture", scenario, base: input, hypotheses: [], canEdit: false }));
  expect(render(base)).not.toContain('data-testid="hyp-base-origin"');
  const withOmissions: BaseSnapshot = { ...base, origin: { ...base.origin!, notCarried: ["Prime 2026-12", "Recrutement 2027-01"] } };
  const html = render(withOmissions);
  const notice = html.split('data-testid="hyp-base-origin"')[1]?.split("</p>")[0] ?? "";
  expect(notice).toContain("Non repris car postérieurs à septembre 2026 : Prime décembre 2026 ; Recrutement janvier 2027.");
  expect(notice).toContain(`href="/e/fixture/glossaire#def-${BUDGET_TERMS.derivee}"`);
  expect(notice).not.toContain("Base dérivée du scénario");
  expect(base.origin!.notCarried).toEqual([]);
  expect(withOmissions.origin!.notCarried).toEqual(["Prime 2026-12", "Recrutement 2027-01"]);
});
