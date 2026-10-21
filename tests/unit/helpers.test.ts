import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: {} }));

const { hasAtLeast, isRole } = await import("@/lib/roles");
const { safeReturnPath } = await import("@/lib/session");
const { workspaceSlug } = await import("@/lib/slug");
const { ALL_ITEMS, STUDIO_RH_ITEMS } = await import("@/lib/nav");

describe("rôles", () => {
  it("ordonne lecteur < éditeur < administrateur", () => {
    expect(hasAtLeast("admin", "editor")).toBe(true);
    expect(hasAtLeast("editor", "reader")).toBe(true);
    expect(hasAtLeast("reader", "editor")).toBe(false);
    expect(hasAtLeast("editor", "admin")).toBe(false);
  });
  it("rejette les rôles inconnus, dont le « member » par défaut de Better Auth", () => {
    expect(isRole("member")).toBe(false);
    expect(isRole("owner")).toBe(false);
    expect(isRole("reader")).toBe(true);
  });
});

describe("chemin de retour", () => {
  it.each([
    ["/e/x/donnees", "/e/x/donnees"],
    ["//evil.example", "/espaces"],
    ["/\\evil.example", "/espaces"],
    ["https://evil.example", "/espaces"],
    [undefined, "/espaces"],
  ])("%s → %s", (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});

describe("slug d'espace", () => {
  it("translittère et ajoute un suffixe aléatoire", () => {
    expect(workspaceSlug("Société Générale d'Études")).toMatch(/^societe-generale-d-etudes-[0-9a-f]{8}$/);
    expect(workspaceSlug("!!!")).toMatch(/^espace-[0-9a-f]{8}$/);
    expect(workspaceSlug("A")).not.toBe(workspaceSlug("A"));
  });
});

describe("menu figé", () => {
  it("contient Données + exactement les 5 sous-modules Studio RH", () => {
    expect(ALL_ITEMS.map((i) => i.label)).toEqual([
      "Données",
      "Collaborateurs",
      "KPI RH",
      "Masse salariale",
      "Hypothèses budgétaires",
      "Reporting social",
    ]);
    expect(STUDIO_RH_ITEMS).toHaveLength(5);
  });
});
