import { createHash, timingSafeEqual } from "node:crypto";

type MfaUser = { email: string; twoFactorEnabled?: boolean | null };
type Environment = Readonly<Record<string, string | undefined>>;

// Server configuration only. An absent, expired or copied configuration keeps MFA mandatory.
export function temporaryTestMfaExemption(
  user: MfaUser,
  env: Environment = process.env,
  now = Date.now(),
): Date | null {
  if (env.APP !== "clair-test" || env.REGION_NAME !== "osc-fr1" || env.TEST_ONLY !== "true"
    || env.BETTER_AUTH_URL !== "https://clair-test.osc-fr1.scalingo.io") return null;

  const expected = env.CLAIR_TEST_MFA_BYPASS_EMAIL_SHA256;
  const until = env.CLAIR_TEST_MFA_BYPASS_UNTIL;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected) || !until
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(until)) return null;
  const expires = Date.parse(until);
  if (!Number.isFinite(now) || !Number.isFinite(expires) || expires <= now
    || new Date(expires).toISOString() !== until) return null;

  // Match the signed session's exact canonical address, never request parameters.
  if (typeof user.email !== "string" || user.email.length > 254 || user.email !== user.email.toLowerCase()
    || !/^[^\s@]+@[^\s@]+$/.test(user.email)) return null;
  const actual = createHash("sha256").update(user.email, "utf8").digest();
  return timingSafeEqual(actual, Buffer.from(expected, "hex")) ? new Date(expires) : null;
}

export function requiresMfaSetup(user: MfaUser, env: Environment = process.env, now = Date.now()): boolean {
  return !user.twoFactorEnabled && temporaryTestMfaExemption(user, env, now) === null;
}
