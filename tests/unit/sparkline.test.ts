import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sparkline } from "@/components/Sparkline";

const render = (values: (number | null)[]) => renderToStaticMarkup(createElement(Sparkline, { values }));

describe("mini-courbes des cartes", () => {
  it("ne trace ni valeur inventée ni tendance à partir de points isolés", () => {
    for (const values of [[], [null, null], [4], [4, null, 6], [Number.NaN, Infinity]]) {
      expect(render(values)).toBe("");
    }
  });

  it("rompt le tracé aux mois n.d. et conserve leur position", () => {
    const html = render([2, 4, null, 8, 10]);
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain('points="2.00,28.00 36.00,22.00"');
    expect(html).toContain('points="104.00,10.00 138.00,4.00"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
  });

  it("trace les zéros connus sans les confondre avec une absence", () => {
    const html = render([0, 0, 0]);
    expect(html).toContain('points="2.00,16.00 70.00,16.00 138.00,16.00"');
    expect(html).not.toContain("NaN");
  });

  it("traite les valeurs non finies comme des ruptures et refuse un axe non fini", () => {
    expect(render([1, 2, Infinity, 4, 5]).match(/<polyline/g)).toHaveLength(2);
    expect(render([-Number.MAX_VALUE, Number.MAX_VALUE])).toBe("");
  });
});
