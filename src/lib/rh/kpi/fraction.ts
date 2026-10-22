import type { Ratio } from "./types";

// Fractions d'entiers : jamais d'arrondi dans le moteur ; produits croisés en BigInt.
export function ratio(num: number, den: number): Ratio {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || den <= 0) throw new Error(`fraction invalide : ${num}/${den}`);
  return { num, den };
}

const abs = (x: bigint) => (x < 0n ? -x : x);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function fromBig(num: bigint, den: bigint): Ratio {
  const g = gcd(num, den);
  const n = num / g;
  const d = den / g;
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER) || d > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("fraction hors des entiers sûrs");
  return { num: Number(n), den: Number(d) };
}

export function reduce(r: Ratio): Ratio {
  return fromBig(BigInt(r.num), BigInt(r.den));
}

export function sub(a: Ratio, b: Ratio): Ratio {
  return fromBig(BigInt(a.num) * BigInt(b.den) - BigInt(b.num) * BigInt(a.den), BigInt(a.den) * BigInt(b.den));
}

export function times(r: Ratio, k: number): Ratio {
  return fromBig(BigInt(r.num) * BigInt(k), BigInt(r.den));
}

export function same(a: Ratio, b: Ratio): boolean {
  return BigInt(a.num) * BigInt(b.den) === BigInt(b.num) * BigInt(a.den);
}

// Valeur en unités de 10^-decimals, arrondie au plus proche, demi en s'éloignant de zéro (signe conservé).
export function roundHalfUp(r: Ratio, decimals: number): bigint {
  const n = BigInt(r.num) * 10n ** BigInt(decimals);
  const d = BigInt(r.den);
  const sign = n < 0n ? -1n : 1n;
  return sign * ((2n * abs(n) + d) / (2n * d));
}
