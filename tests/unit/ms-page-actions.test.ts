import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/e/espace-fictif/studio-rh/masse-salariale", useSearchParams: () => new URLSearchParams() }));

import { MegaMenu } from "@/components/MegaMenu";
import { MsPageActions } from "@/components/MsPageActions";
import type { MenuFamily } from "@/lib/menu";

const slug = "espace-fictif";
const exportHref = `/e/${slug}/studio-rh/masse-salariale/export?annee=2026&de=01&a=09&service=TEST-SVC-A&format=xlsx`;
type Props = { children?: ReactNode; "data-testid"?: string; onClick?: () => void; families?: MenuFamily[] };
function find(node: ReactNode, match: (element: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Props>(child)) continue;
    if (match(child)) return child;
    const nested = find(child.props.children, match);
    if (nested) return nested;
  }
}
const print = () => find(MsPageActions({ slug, exportHref }), (element) => element.props["data-testid"] === "ms-export-pdf")!.props.onClick!();

afterEach(() => vi.unstubAllGlobals());

describe("Actions de la Synthèse Masse salariale", () => {
  it("conserve les cinq familles, les 38 entrées et leurs destinations d’espace", () => {
    const actions = MsPageActions({ slug, exportHref });
    const menu = find(actions, (element) => element.type === MegaMenu)!;
    const families = menu.props.families!;
    expect(families.map((family) => family.label)).toEqual(["Collaborateurs", "KPI RH", "Masse salariale", "Hypothèses budgétaires", "Reporting social"]);
    const entries = families.flatMap((family) => family.entries);
    expect(entries).toHaveLength(38);
    expect(new Set(entries.map((entry) => entry.href)).size).toBe(38);
    expect(entries.every((entry) => entry.href.startsWith(`/e/${slug}/studio-rh/`))).toBe(true);
    for (const [label, path] of [
      ["Tree-View", "collaborateurs/tree"],
      ["Collaborateurs par rubrique de paie", "collaborateurs/rubrique"],
      ["Pointage des collaborateurs", "collaborateurs/pointage"],
      ["Pivot · liste mensuelle", "collaborateurs/pivot"],
      ["MS par organisation", "masse-salariale/organisation"],
      ["Écart réel", "masse-salariale/reel"],
    ]) expect(entries.find((entry) => entry.label === label)?.href).toBe(`/e/${slug}/studio-rh/${path}`);
    const html = renderToStaticMarkup(actions);
    expect(html).toContain('data-testid="ms-export-xlsx"');
    expect(html).toContain(exportHref.replaceAll("&", "&amp;"));
    expect(html).not.toContain('target="_blank"');
    expect(renderToStaticMarkup(MsPageActions({ slug }))).not.toContain('data-testid="ms-export"');
  });

  it("inclut les sources dans l’impression puis restaure les divulgations après fermeture", () => {
    const details = [{ open: false }, { open: true }];
    const dataset: Record<string, string | undefined> = {};
    const events = new EventTarget();
    const browserPrint = vi.fn(() => {
      expect(details.map((detail) => detail.open)).toEqual([true, true]);
      expect(dataset.msPdf).toBe("synthese");
      events.dispatchEvent(new Event("afterprint"));
    });
    vi.stubGlobal("document", { body: { dataset }, querySelectorAll: () => details });
    vi.stubGlobal("window", { print: browserPrint, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    print();
    expect(browserPrint).toHaveBeenCalledOnce();
    expect(details.map((detail) => detail.open)).toEqual([false, true]);
    expect(dataset.msPdf).toBeUndefined();
  });

  it("restaure aussi la page à la prochaine interaction si le navigateur n’émet pas afterprint", () => {
    const detail = { open: false };
    const dataset: Record<string, string | undefined> = {};
    const events = new EventTarget();
    vi.stubGlobal("document", { body: { dataset }, querySelectorAll: () => [detail] });
    vi.stubGlobal("window", { print: vi.fn(), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
    print();
    expect(detail.open).toBe(true);
    events.dispatchEvent(new Event("keydown"));
    expect(detail.open).toBe(false);
    expect(dataset.msPdf).toBeUndefined();
  });
});
