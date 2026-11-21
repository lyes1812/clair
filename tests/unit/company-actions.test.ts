import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanyAction, renameCompanyAction, selectCompanyAction } from "@/app/e/[slug]/company-actions";

const mocks = vi.hoisted(() => ({
  role: "admin" as "admin" | "reader",
  requireWorkspace: vi.fn(), createCompany: vi.fn(), renameCompany: vi.fn(), getCompany: vi.fn(),
  setCookie: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.setCookie }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mocks.revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { mocks.redirect(url); throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: (...args: unknown[]) => mocks.requireWorkspace(...args) }));
vi.mock("@/lib/companies", () => ({
  CompanyError: class CompanyError extends Error {},
  createCompany: (...args: unknown[]) => mocks.createCompany(...args),
  renameCompany: (...args: unknown[]) => mocks.renameCompany(...args),
  getCompany: (...args: unknown[]) => mocks.getCompany(...args),
}));

const companyId = "a1111111-1111-4111-8111-111111111111";
const workspaceId = "workspace-fictif";
const company = { id: companyId, workspaceId, name: "Société fictive", siren: "123456789", archivedAt: null };
const form = (values: Record<string, string>) => {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "admin";
  mocks.requireWorkspace.mockImplementation(async (_slug: string, minRole?: string) => {
    if (minRole === "admin" && mocks.role !== "admin") throw new Error("Accès refusé");
    return { session: { user: { id: "admin-fictif" } }, workspace: { id: workspaceId, slug: "demo", role: mocks.role } };
  });
  mocks.createCompany.mockResolvedValue(company);
  mocks.renameCompany.mockResolvedValue(company);
  mocks.getCompany.mockResolvedValue(company);
});

describe("actions du registre des sociétés", () => {
  it("réserve la création aux administrateurs et ouvre la société effectivement créée", async () => {
    await expect(createCompanyAction("demo", undefined, form({ name: " Société fictive ", siren: "123456789" }))).rejects.toThrow(`redirect:/e/demo/donnees?societe=${companyId}`);
    expect(mocks.requireWorkspace).toHaveBeenCalledWith("demo", "admin");
    expect(mocks.createCompany).toHaveBeenCalledWith(workspaceId, "admin-fictif", { name: "Société fictive", siren: "123456789" });
    expect(mocks.setCookie).toHaveBeenCalledWith(`clair-company-${workspaceId}`, companyId, expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/e/demo" }));
  });

  it("réserve le renommage aux administrateurs sans changer leur sélection", async () => {
    expect(await renameCompanyAction("demo", companyId, undefined, form({ name: "Nom modifié", siren: "123456789" }))).toEqual({ ok: "Informations de la société enregistrées." });
    expect(mocks.requireWorkspace).toHaveBeenCalledWith("demo", "admin");
    expect(mocks.renameCompany).toHaveBeenCalledWith(workspaceId, "admin-fictif", companyId, { name: "Nom modifié", siren: "123456789" });
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["create", "rename"])("refuse un lecteur avant tout effet de bord (%s)", async (operation) => {
    mocks.role = "reader";
    const data = form({ name: "Nom interdit" });
    const call = operation === "create" ? createCompanyAction("demo", undefined, data) : renameCompanyAction("demo", companyId, undefined, data);
    await expect(call).rejects.toThrow("Accès refusé");
    expect(mocks.requireWorkspace).toHaveBeenCalledWith("demo", "admin");
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.renameCompany).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("laisse un lecteur sélectionner une société autorisée de son espace", async () => {
    mocks.role = "reader";
    await expect(selectCompanyAction("demo", undefined, form({ companyId }))).rejects.toThrow(`redirect:/e/demo/donnees?societe=${companyId}`);
    expect(mocks.requireWorkspace).toHaveBeenCalledWith("demo");
    expect(mocks.getCompany).toHaveBeenCalledWith(workspaceId, companyId);
    expect(mocks.setCookie).toHaveBeenCalledTimes(1);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.renameCompany).not.toHaveBeenCalled();
  });

  it("refuse un identifiant invalide avant consultation du registre et sans cookie", async () => {
    expect(await selectCompanyAction("demo", undefined, form({ companyId: "*" }))).toEqual({ error: "Choisis une société de cet espace." });
    expect(mocks.getCompany).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("refuse une société étrangère ou archivée sans modifier la sélection", async () => {
    mocks.getCompany.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...company, archivedAt: new Date("2026-01-01") });
    for (let i = 0; i < 2; i++) expect(await selectCompanyAction("demo", undefined, form({ companyId }))).toEqual({ error: "Société indisponible dans cet espace." });
    expect(mocks.getCompany).toHaveBeenCalledWith(workspaceId, companyId);
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("ne crée ni ne renomme une société avec une identité invalide", async () => {
    expect(await createCompanyAction("demo", undefined, form({ name: "", siren: "123456789" }))).toHaveProperty("error");
    expect(await renameCompanyAction("demo", companyId, undefined, form({ name: "Nom", siren: "12" }))).toHaveProperty("error");
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.renameCompany).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
