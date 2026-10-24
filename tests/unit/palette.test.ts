import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Univers de Clair : bleu, blanc, noir, gris. Seules couleurs externes : le rouge et le vert, réservés aux tendances financières
// (--bad, --good et leurs fonds) ; le rouge d'erreur (--danger) reste pour les erreurs. Ce test lit toutes les feuilles de style et
// tous les composants et refuse toute couleur codée en dur hors de cet univers.
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk("src").filter((f) => /\.(css|tsx?)$/.test(f));

function hsl(hex: string): { h: number; s: number; l: number } {
  const h6 = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex.slice(0, 7);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h6.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: hue * 60, s, l };
}
// Rouge d'erreur et de tendance : teinte rouge ; vert de tendance : teinte verte, uniquement via les jetons.
const TOKENS = new Set(["#c4302b", "#138a55", "#fdf1f0", "#eef8f3", "#aa4051", "#fff8fa", "#f1d6dc"]);

describe("palette : bleu, blanc, noir, gris", () => {
  it("aucune couleur codée en dur hors de l'univers (bleus, gris, blancs, noirs) sauf les jetons rouge / vert de tendance et le rouge d'erreur", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
        const hex = m[0].toLowerCase();
        if (TOKENS.has(hex)) continue;
        const { h, s } = hsl(hex);
        const neutral = s < 0.16;
        const blue = h >= 195 && h <= 265;
        if (!neutral && !blue) offenders.push(`${f} ${hex}`);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
  it("le rouge / le vert de tendance (--bad, --good) ne s'appliquent qu'à des sélecteurs de tendance (« trend ») et à la cascade en euros", () => {
    const stray: string[] = [];
    for (const f of files) {
      const path = f.replace(/\\/g, "/");
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/var\(--(bad|good)\b/.test(line) && !/--(bad|good)(-soft)?\s*:/.test(line)) return;
        if (/--(bad|good)(-soft)?\s*:/.test(line)) return; // définition du jeton
        if (path.endsWith(".css") && /trend|legend|\.dot\.(bad|good)/.test(line)) return;
        if (path.endsWith("WaterfallChart.tsx")) return; // cascade en euros (trend="cost")
        stray.push(`${path}:${i + 1}`);
      });
    }
    expect(stray).toEqual([]);
  });
});
