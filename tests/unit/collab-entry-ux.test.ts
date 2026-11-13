import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { payfitFixtureBuild } from "./helpers/rh";
import type { CollabContext } from "@/lib/rh/view";
const state = vi.hoisted(() => ({ ctx: null as unknown as CollabContext }));
vi.mock("@/lib/rh/view", async () => ({ ...await vi.importActual("@/lib/rh/view"), loadCollabContext: async () => state.ctx }));
import Page from "@/app/e/[slug]/studio-rh/collaborateurs/page";
import { Nature, PersonCell } from "@/app/e/[slug]/studio-rh/collaborateurs/components";

beforeEach(async () => {
  const data = await payfitFixtureBuild();
  data.persons.forEach(person => { person.employeeNumber = null; });
  state.ctx = {
    slug: "espace-fictif", source: { domain: "rh", chosen: "payfit", mode: "auto", reason: "source fictive", modeSetAt: null, appliedAt: null },
    chosen: "payfit", natures: { codes: ["01", "02", "29"], origin: "default" }, data,
    state: null, switchedAt: null, establishments: [], payfitHistory: null,
  } as unknown as CollabContext;
});
const html = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: "espace-fictif" }), searchParams: Promise.resolve({ mois: "2026-09" }) }));
const table = (value: string) => value.match(/<table[^>]*data-testid="collab-monthly-table"[\s\S]*?<\/table>/)?.[0] ?? "";

describe("Entrée Collaborateurs — lisibilité sans perdre les références", () => {
  it("retire seulement une colonne matricule entièrement indisponible", async () => {
    expect(table(await html())).not.toContain('<th scope="col">Matricule</th>');
    state.ctx.data!.persons[0].employeeNumber = "   ";
    expect(table(await html())).not.toContain('<th scope="col">Matricule</th>');
    state.ctx.data!.persons[0].employeeNumber = "MATRICULE-FICTIF";
    const value = table(await html());
    expect(value).toContain('<th scope="col">Matricule</th>');
    expect(value).toContain('MATRICULE-FICTIF');
  });
  it("garde les liens et déplace les identifiants source dans des détails fermés", async () => {
    const value = table(await html());
    expect(value).toContain('Fiche du contrat');
    expect(value).toContain('data-testid="collab-contract-references"');
    expect(value).toContain('Références et sources');
    expect(value).toContain('Identifiant du contrat');
    expect(value).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    const initial = value.replace(/<details[\s\S]*?<\/details>/g, "");
    expect(initial).not.toContain('<code');
    expect(initial).not.toContain('CDI (01)');
    expect(initial).toContain('CDI');
    expect(initial).toMatch(/href="\/e\/espace-fictif\/studio-rh\/collaborateurs\/p\//);
    expect(initial).toMatch(/href="\/e\/espace-fictif\/studio-rh\/collaborateurs\/c\//);
  });
  it("le mode compact ne modifie pas la lecture des composants secondaires", () => {
    const person = state.ctx.data!.persons[0], contract = state.ctx.data!.contracts.find(row => row.personKey === person.personKey)!;
    const regular = renderToStaticMarkup(createElement(PersonCell, { person, contract, slug: "fictif" }));
    const compact = renderToStaticMarkup(createElement(PersonCell, { person, contract, slug: "fictif", compact: true }));
    expect(regular).toContain('<code'); expect(compact).not.toContain('<code');
    expect(renderToStaticMarkup(createElement(Nature, { code: "01" }))).toContain('CDI (01)');
    expect(renderToStaticMarkup(createElement(Nature, { code: "01", compact: true }))).toContain('>CDI<');
  });
});
