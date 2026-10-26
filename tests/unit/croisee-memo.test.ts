import { describe, expect, it } from "vitest";
import { memoByContext } from "@/lib/croisee/memo";

describe("memoByContext : un calcul par contexte de requête", () => {
  it("même contexte : un seul appel ; autre contexte : nouvel appel", async () => {
    let calls = 0;
    const model = memoByContext(async (ctx: { id: number }) => {
      calls += 1;
      return ctx.id * 10;
    });
    const a = { id: 1 };
    const b = { id: 2 };
    expect(await model(a)).toBe(10);
    expect(await model(a)).toBe(10);
    expect(calls).toBe(1);
    expect(await model(b)).toBe(20);
    expect(calls).toBe(2);
  });
});
