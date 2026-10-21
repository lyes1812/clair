import { describe, expect, it } from "vitest";
import { RH_BUILDER_VERSION, rhInputsHash } from "@/lib/rh/referential/hash";

describe("empreinte des entrées du référentiel", () => {
  const syncs = [
    { id: "b", contentHash: "hb" },
    { id: "a", contentHash: "ha" },
  ];
  it("ne dépend pas de l'ordre des lectures ni des paires retenues", () => {
    const h1 = rhInputsHash({ source: "dsn", syncs, selected: [{ syncId: "b", key: "k2" }, { syncId: "a", key: "k1" }] });
    const h2 = rhInputsHash({ source: "dsn", syncs: [...syncs].reverse(), selected: [{ syncId: "a", key: "k1" }, { syncId: "b", key: "k2" }] });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  it("change avec un contenu, une paire retenue, la source ou la version des règles", () => {
    const base = rhInputsHash({ source: "payfit", syncs });
    expect(rhInputsHash({ source: "payfit", syncs: [{ id: "a", contentHash: "ha" }, { id: "b", contentHash: "hb2" }] })).not.toBe(base);
    expect(rhInputsHash({ source: "dsn", syncs })).not.toBe(base);
    expect(rhInputsHash({ source: "payfit", syncs, selected: [{ syncId: "a", key: "k" }] })).not.toBe(base);
    expect(RH_BUILDER_VERSION).toBeGreaterThanOrEqual(1);
  });
});
