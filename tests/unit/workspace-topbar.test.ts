import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/SignOutButton", () => ({ SignOutButton: () => null }));
import { WorkspaceTopBar } from "@/components/WorkspaceTopBar";
import { menuFamilies } from "@/lib/menu";

const render = (path: string) => {
  state.pathname = path;
  return renderToStaticMarkup(createElement(WorkspaceTopBar, { slug: "espace-fictif", workspaceName: "Espace fictif", userName: "Utilisateur fictif", email: "fictif@example.invalid", families: menuFamilies("espace-fictif") }));
};
describe("Sommaire RH limité à son module", () => {
  it.each(["", "/collaborateurs", "/kpi", "/masse-salariale/croisee", "/hypotheses", "/reporting-social"])("reste accessible dans Studio RH%s", (path) => {
    const html = render(`/e/espace-fictif/studio-rh${path}`);
    expect(html).toContain('data-testid="mega-button"');
    expect(html).toContain("Toutes les entrées");
    expect(html).toContain('aria-label="Fil d&#x27;Ariane"');
  });
  it.each(["studio-finance", "studio-finance/modele", "studio-restructuring", "studio-restructuring/export", "donnees", "parametres", "glossaire", "studio-rh-autre"])("n’apparaît pas dans %s", (path) => {
    const html = render(`/e/espace-fictif/${path}`);
    expect(html).not.toContain('data-testid="mega-button"');
    expect(html).not.toContain("Toutes les entrées");
    expect(html).toContain("Espace fictif");
    expect(html).toContain('data-testid="user-menu"');
  });
});
