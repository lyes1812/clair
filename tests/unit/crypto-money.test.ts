import { describe, expect, it } from "vitest";
import { canonicalJson, decryptSecret, encryptSecret, workspaceFingerprint } from "@/lib/crypto";
import { toCents } from "@/lib/money";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");

describe("secrets chiffrés", () => {
  it("déchiffre avec la même clé et le même contexte", () => {
    const sealed = encryptSecret("cle-fictive-123", "ws-a:payfit", KEY);
    expect(sealed).not.toContain("cle-fictive");
    expect(decryptSecret(sealed, "ws-a:payfit", KEY)).toBe("cle-fictive-123");
  });
  it("refuse un autre espace, une autre clé maîtresse ou un secret altéré", () => {
    const sealed = encryptSecret("cle-fictive-123", "ws-a:payfit", KEY);
    expect(() => decryptSecret(sealed, "ws-b:payfit", KEY)).toThrow();
    expect(() => decryptSecret(sealed, "ws-a:payfit", OTHER)).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("autre").toString("base64");
    expect(() => decryptSecret(parts.join("."), "ws-a:payfit", KEY)).toThrow();
  });
  it("chiffre deux fois différemment (IV aléatoire)", () => {
    expect(encryptSecret("x", "c", KEY)).not.toBe(encryptSecret("x", "c", KEY));
  });
  it("empreinte stable par espace, différente entre espaces", () => {
    expect(workspaceFingerprint("a", "185057500000012", KEY)).toBe(workspaceFingerprint("a", "185057500000012", KEY));
    expect(workspaceFingerprint("a", "185057500000012", KEY)).not.toBe(workspaceFingerprint("b", "185057500000012", KEY));
  });
  it("JSON canonique indépendant de l'ordre des clés", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }));
  });
});

describe("conversion en centimes (cas écrits à la main)", () => {
  it.each([
    ["1234.56", 123456],
    ["1234,5", 123450],
    ["-0.01", -1],
    ["0", 0],
    ["12 345.00", 1234500],
    [1234.56, 123456],
    [0.1, 10],
    ["10.500", 1050],
  ])("%s → %s", (input, cents) => expect(toCents(input)).toBe(cents));
  it.each([["1.234"], ["abc"], [""], [null], [Number.NaN], ["1e3"]])("%s → null (jamais 0)", (input) => {
    expect(toCents(input)).toBeNull();
  });
});
