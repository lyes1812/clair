import { afterEach, describe, expect, it } from "vitest";
import { categorize } from "@/lib/bank/categories";
import { FIXTURE_PERSONS, fixtureFlows } from "@/lib/bank/categories-fixture";
import { resetTransport, setTransport, type JsonCall } from "@/lib/ia/client";
import { AI_BATCH, proposeCategories } from "@/lib/ia/categorize";
import { CATEGORIZE_PROMPT_VERSION } from "@/lib/ia/prompts/categorize-v1";

// Cap 13, lot L4 : IA sur le résidu, avec un transport simulé (aucun appel réseau dans les tests).
afterEach(() => resetTransport());

describe("catégorisation par IA du résidu", () => {
  it("n'envoie que le résidu, par lots de 100, pseudonymisé ; rejette les réponses hors liste ou de mauvais sens", async () => {
    const extra = Array.from({ length: 150 }, (_, i) => ({ key: `r-${i}`, bookingDate: "2026-06-15", amountCents: -10_000 - i, label: `VIR SEPA EMIS M INCONNU FICTIF ${FIXTURE_PERSONS[i % 2]} REF ${900000 + i}`, counterparty: "CAMILLE TESTARD" }));
    const flows = categorize([...fixtureFlows(), ...extra], { decisions: {}, learned: {}, ai: {} });
    const residue = flows.filter((f) => f.source === null);
    const sentTexts: string[] = [];
    setTransport(async <T,>(call: JsonCall<T>) => {
      sentTexts.push(call.user);
      const flux = (JSON.parse(call.user) as { flux: { i: number; sens: string }[] }).flux;
      // Le modèle simulé répond « fournisseurs » à tout, plus une réponse dupliquée et une hors liste.
      const resultats = flux.map((f) => ({ i: f.i, categorie: f.sens === "decaissement" ? "suppliers" : "payroll", confiance: 0.9, motif: "Simulé" }));
      resultats.push({ i: 0, categorie: "capex", confiance: 1, motif: "doublon" });
      return { output: call.schema.parse({ resultats }) as T, model: "modele-simule" };
    });
    const journal: Record<string, unknown>[] = [];
    const run = await proposeCategories(residue, FIXTURE_PERSONS.flatMap((n) => [n, n.split(" ")[1]]), async (d) => { journal.push(d); });

    expect(sentTexts.length).toBe(Math.ceil(residue.length / AI_BATCH));
    expect(run.sent).toBe(residue.length);
    // Aucun nom de personne, aucune référence chiffrée longue dans ce qui part au modèle.
    for (const t of sentTexts) {
      expect(t).not.toMatch(/TESTARD|EXEMPLIER|INCONNU/);
      const texts = (JSON.parse(t) as { flux: { libelle: string; contrepartie: string | null }[] }).flux.map((f) => `${f.libelle} ${f.contrepartie ?? ""}`).join(" ");
      expect(texts).not.toMatch(/\d{4,}/);
    }
    // Décaissements : proposition retenue ; encaissements : « salaires » refusé (mauvais sens), le flux reste à catégoriser.
    const outKeys = residue.filter((f) => f.direction === "out").map((f) => f.key);
    const inKeys = residue.filter((f) => f.direction === "in").map((f) => f.key);
    expect(outKeys.every((k) => run.proposals[k]?.category === "suppliers")).toBe(true);
    expect(inKeys.some((k) => run.proposals[k])).toBe(false);
    expect(run.proposals[residue[0].key]?.category).not.toBe("capex");
    // Journal : modèle, version du gabarit, empreinte ; jamais de libellé.
    expect(journal[0]).toMatchObject({ model: "modele-simule", promptVersion: CATEGORIZE_PROMPT_VERSION, status: "ok", flows: AI_BATCH });
    expect(JSON.stringify(journal)).not.toMatch(/VIR|FICTIF/);
  });

  it("un lot en échec est journalisé et n'arrête pas les autres", async () => {
    const residue = categorize(fixtureFlows(), { decisions: {}, learned: {}, ai: {} }).filter((f) => f.source === null);
    let n = 0;
    setTransport(async () => { n++; throw new Error("panne simulée"); });
    const journal: { status: string }[] = [];
    const run = await proposeCategories(residue, [], async (d) => { journal.push(d); });
    expect(run.failedBatches).toBe(n);
    expect(journal.every((j) => j.status === "echec")).toBe(true);
    expect(Object.keys(run.proposals)).toEqual([]);
  });
});
