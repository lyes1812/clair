import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ enabled: false, email: "owner@example.invalid" }));
vi.mock("@/components/TopBar", () => ({ TopBar: () => null }));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ user: { email: state.email, twoFactorEnabled: state.enabled } }), safeReturnPath: (path: string | undefined) => path || "/espaces" }));
vi.mock("@/app/securite/TotpSetup", () => ({ TotpSetup: () => createElement("div", { "data-testid": "optional-setup" }) }));
import SecuritePage from "@/app/securite/page";

beforeEach(() => {
  state.enabled = false; state.email = "owner@example.invalid";
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T09:00:00.000Z"));
  for (const [key, value] of Object.entries({ APP: "clair-test", REGION_NAME: "osc-fr1", TEST_ONLY: "true", BETTER_AUTH_URL: "https://clair-test.osc-fr1.scalingo.io", CLAIR_TEST_MFA_BYPASS_EMAIL_SHA256: createHash("sha256").update(state.email).digest("hex"), CLAIR_TEST_MFA_BYPASS_UNTIL: "2026-11-12T09:00:00.000Z" })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const render = async () => renderToStaticMarkup(await SecuritePage({ searchParams: Promise.resolve({ retour: "/e/test-fictif" }) }));

it("propose de poursuivre pendant la dispense, sans annoncer une MFA activée ni obligatoire", async () => {
  const html = await render();
  expect(html).toContain("temporairement facultative");
  expect(html).toContain('href="/e/test-fictif"');
  expect(html).toContain("Continuer vers mon espace");
  expect(html).toContain('data-testid="optional-setup"');
  expect(html).not.toContain("obligatoire avant");
  expect(html).not.toContain('data-testid="totp-status"');
});
it("conserve l'obligation de configuration pour un autre administrateur", async () => {
  state.email = "another@example.invalid";
  const html = await render();
  expect(html).toContain("obligatoire avant");
  expect(html).not.toContain("temporairement facultative");
});
it("affiche toujours la MFA active lorsqu'elle est configurée", async () => {
  state.enabled = true;
  const html = await render();
  expect(html).toContain('data-testid="totp-status"');
  expect(html).not.toContain("temporairement facultative");
});
