import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db/client", () => ({ db: {} }));

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
  it("conserve Données et les 5 sous-modules RH, puis les deux studios demandés", () => {
    expect(ALL_ITEMS.map((i) => i.label)).toEqual([
      "Données",
      "Collaborateurs",
      "KPI RH",
      "Masse salariale",
      "Hypothèses budgétaires",
      "Reporting social",
      "Studio Finance",
      "Studio Restructuring",
    ]);
    expect(STUDIO_RH_ITEMS).toHaveLength(5);
  });
});

describe("inscription sur invitation", async () => {
  const { allowedDomains, domainAllowed } = await import("@/lib/signup");
  it("lit la liste des domaines de recette et ignore les valeurs invalides", () => {
    expect(allowedDomains(" test.invalid, ,pas un domaine,Exemple.FR ")).toEqual(["test.invalid", "exemple.fr"]);
    expect(allowedDomains("")).toEqual([]);
  });
  it("sans argument ni variable d'environnement : aucun domaine (isolé du .env chargé)", () => {
    vi.stubEnv("CLAIR_SIGNUP_ALLOWED_DOMAINS", undefined);
    try {
      expect(allowedDomains(undefined)).toEqual([]);
      expect(allowedDomains()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("sans argument : lit CLAIR_SIGNUP_ALLOWED_DOMAINS", () => {
    vi.stubEnv("CLAIR_SIGNUP_ALLOWED_DOMAINS", "recette.invalid");
    try {
      expect(allowedDomains()).toEqual(["recette.invalid"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("n'ouvre que les domaines listés, sans correspondance partielle", () => {
    const d = ["test.invalid"];
    expect(domainAllowed("a@test.invalid", d)).toBe(true);
    expect(domainAllowed("A@TEST.INVALID", d)).toBe(true);
    expect(domainAllowed("a@evil-test.invalid", d)).toBe(false);
    expect(domainAllowed("a@test.invalid.evil.com", d)).toBe(false);
    expect(domainAllowed("a@example.com", [])).toBe(false);
  });
});
