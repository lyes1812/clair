import { ProviderError } from "./http";
import { createPayFitClient, readPayFit } from "./payfit/client";
import { createFixtureFetch, fixtureProvidersEnabled, isFixtureKey } from "./payfit/fixture";
import { createPennylaneClient, readPennylane } from "./pennylane/client";
import { createPennylaneFixtureFetch, isPennylaneFixtureKey } from "./pennylane/fixture";
import type { ProviderId, ProviderReadResult } from "./types";

// Registre des fournisseurs : comment vérifier une clé et comment lire un périmètre de mois.
export type VerifiedConnection = { companyId: string; companyName: string; scopes: string[] };
export type ProviderRead = ProviderReadResult & { company: { id: string; name: string; identificationNumber: string | null }; scopes: string[] };

function guardFixture(isFixture: boolean) {
  if (isFixture && !fixtureProvidersEnabled()) throw new ProviderError("key_rejected", "clé fictive refusée sur cet environnement");
}

export function payfitClientFor(apiKey: string) {
  const fixture = isFixtureKey(apiKey);
  guardFixture(fixture);
  return fixture ? createPayFitClient(apiKey, { fetchImpl: createFixtureFetch(apiKey), minIntervalMs: 0 }) : createPayFitClient(apiKey);
}

export function pennylaneClientFor(apiKey: string, companyId: string | null) {
  const fixture = isPennylaneFixtureKey(apiKey);
  guardFixture(fixture);
  return fixture
    ? createPennylaneClient(apiKey, companyId, { fetchImpl: createPennylaneFixtureFetch(apiKey), minIntervalMs: 0 })
    : createPennylaneClient(apiKey, companyId);
}

export const PROVIDERS: Record<ProviderId, {
  verify: (apiKey: string, companyId: string | null) => Promise<VerifiedConnection>;
  read: (apiKey: string, companyId: string | null, months: string[]) => Promise<ProviderRead>;
}> = {
  payfit: {
    async verify(apiKey) {
      const client = payfitClientFor(apiKey);
      const identity = await client.introspect();
      const company = await client.company(identity.companyId);
      return { companyId: company.id, companyName: company.name, scopes: identity.scopes };
    },
    read: (apiKey, _companyId, months) => readPayFit(payfitClientFor(apiKey), months),
  },
  pennylane: {
    async verify(apiKey, companyId) {
      const me = await pennylaneClientFor(apiKey, companyId).me();
      return { companyId: me.companyId, companyName: me.companyName, scopes: [] };
    },
    read: (apiKey, companyId, months) => readPennylane(pennylaneClientFor(apiKey, companyId), months),
  },
};

export function isProviderId(v: unknown): v is ProviderId {
  return v === "payfit" || v === "pennylane";
}
