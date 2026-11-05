import { createHash } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "owner@example.invalid", enabled: false,
  access: [{ id: "org-fictitious", name: "Espace fictif", slug: "test-fictif", role: "admin" }],
  authBefore: null as null | ((ctx: { path: string; body?: object; context: { session: { user: { email: string; twoFactorEnabled: boolean } } } }) => Promise<void>),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/db/client", () => ({ db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => state.access }) }) }) }) } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ user: { id: "user-fictitious", email: state.email, twoFactorEnabled: state.enabled } }) }));
vi.mock("better-auth", () => ({ betterAuth: (config: { hooks: { before: typeof state.authBefore } }) => { state.authBefore = config.hooks.before; return {}; } }));
vi.mock("better-auth/api", () => ({ APIError: class extends Error { constructor(_status: string, body: { message: string }) { super(body.message); } }, createAuthMiddleware: (fn: unknown) => fn }));
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("better-auth/plugins", () => ({ organization: () => ({}), twoFactor: () => ({}) }));
vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/signup", () => ({ signupAllowed: async () => false }));

import { requireWorkspace } from "@/lib/workspace";

beforeAll(async () => { await import("@/lib/auth"); });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T09:00:00.000Z"));
  state.email = "owner@example.invalid"; state.enabled = false;
  state.access = [{ id: "org-fictitious", name: "Espace fictif", slug: "test-fictif", role: "admin" }];
  for (const [key, value] of Object.entries({ APP: "clair-test", REGION_NAME: "osc-fr1", TEST_ONLY: "true", BETTER_AUTH_URL: "https://clair-test.osc-fr1.scalingo.io", CLAIR_TEST_MFA_BYPASS_EMAIL_SHA256: createHash("sha256").update(state.email).digest("hex"), CLAIR_TEST_MFA_BYPASS_UNTIL: "2026-11-12T09:00:00.000Z" })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("gardes réelles des pages et de l'administration", () => {
  it("laisse passer le seul administrateur ciblé, avec son rôle inchangé", async () => {
    expect((await requireWorkspace("test-fictif")).workspace.role).toBe("admin");
  });
  it("ne donne accès à aucun espace supplémentaire", async () => {
    state.access = [];
    await expect(requireWorkspace("autre-espace")).rejects.toThrow("not-found");
  });
  it("maintient le renvoi Sécurité pour un autre administrateur", async () => {
    state.email = "another@example.invalid";
    await expect(requireWorkspace("test-fictif")).rejects.toThrow("redirect:/securite");
  });
  it("rétablit le renvoi Sécurité à l'échéance", async () => {
    vi.setSystemTime(new Date("2026-11-12T09:00:00.000Z"));
    await expect(requireWorkspace("test-fictif")).rejects.toThrow("redirect:/securite");
  });
  it("ne change pas les droits d'un lecteur et refuse toujours un rôle insuffisant", async () => {
    state.email = "reader@example.invalid"; state.access[0].role = "reader";
    expect((await requireWorkspace("test-fictif")).workspace.role).toBe("reader");
    await expect(requireWorkspace("test-fictif", "admin")).rejects.toThrow("not-found");
  });
  it("emploie la même exception pour le hook d'administration, sans prendre l'adresse dans la requête", async () => {
    const ctx = { path: "/organization/invite-member", body: { email: "owner@example.invalid" }, context: { session: { user: { email: state.email, twoFactorEnabled: false } } } };
    await expect(state.authBefore!(ctx)).resolves.toBeUndefined();
    ctx.context.session.user.email = "another@example.invalid";
    await expect(state.authBefore!(ctx)).rejects.toThrow("Activez la double authentification");
  });
  it("refuse l'exception d'administration hors de TEST", async () => {
    vi.stubEnv("APP", "clair-production");
    await expect(state.authBefore!({ path: "/organization/delete", context: { session: { user: { email: state.email, twoFactorEnabled: false } } } })).rejects.toThrow("Activez la double authentification");
  });
  it("conserve l'inscription sur invitation", async () => {
    await expect(state.authBefore!({ path: "/sign-up/email", body: { email: state.email }, context: { session: { user: { email: state.email, twoFactorEnabled: false } } } })).rejects.toThrow("Inscription sur invitation uniquement");
  });
});
