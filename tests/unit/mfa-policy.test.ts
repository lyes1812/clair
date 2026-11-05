import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { requiresMfaSetup, temporaryTestMfaExemption } from "@/lib/mfa-policy";

const email = "owner@example.invalid";
const now = Date.parse("2026-11-05T09:00:00.000Z");
const until = "2026-11-12T09:00:00.000Z";
const env = {
  APP: "clair-test", REGION_NAME: "osc-fr1", TEST_ONLY: "true",
  BETTER_AUTH_URL: "https://clair-test.osc-fr1.scalingo.io",
  CLAIR_TEST_MFA_BYPASS_EMAIL_SHA256: createHash("sha256").update(email).digest("hex"),
  CLAIR_TEST_MFA_BYPASS_UNTIL: until,
};

describe("dispense MFA temporaire et ciblée sur TEST", () => {
  it("permet uniquement au compte configuré de poursuivre sans TOTP avant l'échéance", () => {
    expect(temporaryTestMfaExemption({ email }, env, now)?.toISOString()).toBe(until);
    expect(requiresMfaSetup({ email, twoFactorEnabled: false }, env, now)).toBe(false);
    expect(requiresMfaSetup({ email: "another@example.invalid", twoFactorEnabled: false }, env, now)).toBe(true);
    expect(temporaryTestMfaExemption({ email: "Owner@example.invalid" }, env, now)).toBeNull();
  });

  it.each([
    ["APP", "clair-production"], ["REGION_NAME", "osc-secnum-fr1"], ["TEST_ONLY", "false"],
    ["BETTER_AUTH_URL", "https://clair-production.example.invalid"],
    ["BETTER_AUTH_URL", "https://clair-test.osc-fr1.scalingo.io.attacker.invalid"],
    ["BETTER_AUTH_URL", "http://clair-test.osc-fr1.scalingo.io"],
  ])("refuse la copie de configuration dans un autre environnement : %s=%s", (key, value) => {
    expect(temporaryTestMfaExemption({ email }, { ...env, [key]: value }, now)).toBeNull();
  });

  it("échoue fermé si une variable manque ou si l'empreinte est mal formée", () => {
    for (const key of Object.keys(env)) {
      expect(temporaryTestMfaExemption({ email }, { ...env, [key]: undefined }, now)).toBeNull();
    }
    for (const value of ["", "a".repeat(63), "z".repeat(64), env.CLAIR_TEST_MFA_BYPASS_EMAIL_SHA256.toUpperCase()]) {
      expect(temporaryTestMfaExemption({ email }, { ...env, CLAIR_TEST_MFA_BYPASS_EMAIL_SHA256: value }, now)).toBeNull();
    }
    expect(temporaryTestMfaExemption({ email }, {}, now)).toBeNull();
  });

  it("rétablit l'obligation exactement à l'échéance, sans renouvellement automatique", () => {
    const end = Date.parse(until);
    expect(requiresMfaSetup({ email }, env, end - 1)).toBe(false);
    expect(requiresMfaSetup({ email }, env, end)).toBe(true);
    expect(requiresMfaSetup({ email }, env, end + 1)).toBe(true);
  });

  it.each(["invalide", "2026-11-12", "2026-02-30T09:00:00.000Z", "2026-11-12T09:00:00+00:00"])("refuse une date ambiguë ou invalide : %s", (value) => {
    expect(temporaryTestMfaExemption({ email }, { ...env, CLAIR_TEST_MFA_BYPASS_UNTIL: value }, now)).toBeNull();
  });

  it("ne transforme pas un défaut d'horloge ou une identité invalide en autorisation", () => {
    expect(temporaryTestMfaExemption({ email }, env, NaN)).toBeNull();
    expect(temporaryTestMfaExemption({ email }, env, Infinity)).toBeNull();
    for (const value of ["", " owner@example.invalid", "owner@example.invalid\n", "sans-adresse"]) {
      expect(temporaryTestMfaExemption({ email: value }, env, now)).toBeNull();
    }
  });

  it("conserve le comportement d'un compte ayant déjà configuré TOTP", () => {
    expect(requiresMfaSetup({ email, twoFactorEnabled: true }, {}, now)).toBe(false);
  });
});
