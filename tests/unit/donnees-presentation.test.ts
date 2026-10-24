import { describe, expect, it } from "vitest";
import { balanceColumns, defaultsNote, primaryAction } from "@/app/e/[slug]/donnees/ui";

// Cas de référence écrits à la main : aucun résultat n'est recalculé par le code testé.
describe("Données : action principale d'une carte de source", () => {
  it("API non connectée : « Connecter » pour un administrateur, rien pour les autres", () => {
    expect(primaryAction("api", { connected: false, isAdmin: true, canWrite: true })).toEqual({ label: "Connecter", anchor: "connexion" });
    expect(primaryAction("api", { connected: false, isAdmin: false, canWrite: true })).toBeNull(); // un éditeur ne connecte pas
    expect(primaryAction("api", { connected: false, isAdmin: false, canWrite: false })).toBeNull();
  });

  it("API connectée : « Synchroniser » pour un éditeur ou un administrateur, rien pour un lecteur", () => {
    expect(primaryAction("api", { connected: true, isAdmin: true, canWrite: true })).toEqual({ label: "Synchroniser", anchor: "synchroniser" });
    expect(primaryAction("api", { connected: true, isAdmin: false, canWrite: true })).toEqual({ label: "Synchroniser", anchor: "synchroniser" });
    expect(primaryAction("api", { connected: true, isAdmin: false, canWrite: false })).toBeNull();
  });

  it("fichiers (DSN, FEC) : « Déposer un fichier » pour un éditeur ou un administrateur, rien pour un lecteur", () => {
    expect(primaryAction("files", { connected: true, isAdmin: false, canWrite: true })).toEqual({ label: "Déposer un fichier", anchor: "deposer" });
    expect(primaryAction("files", { connected: true, isAdmin: true, canWrite: true })).toEqual({ label: "Déposer un fichier", anchor: "deposer" });
    expect(primaryAction("files", { connected: true, isAdmin: false, canWrite: false })).toBeNull();
  });
});

describe("Paramètres : grille de comptes en deux colonnes équilibrées", () => {
  it("grille par défaut : Brut (4 rubriques) à gauche ; Cotisations (2) puis Hors masse (2) à droite", () => {
    expect(balanceColumns([4, 2, 2])).toEqual([[0], [1, 2]]);
  });

  it("quatre boîtes de même hauteur : une sur deux dans chaque colonne, ordre conservé", () => {
    expect(balanceColumns([2, 2, 2, 2])).toEqual([[0, 2], [1, 3]]);
  });

  it("une grande boîte seule d'un côté, les petites de l'autre jusqu'à la rattraper", () => {
    // 1 | 5 | 1 → 1 | 2 | 3 | 4 (colonne de gauche) tant qu'elle reste moins haute que 5
    expect(balanceColumns([1, 5, 1, 1, 1])).toEqual([[0, 2, 3, 4], [1]]);
  });

  it("peu de boîtes : la seconde colonne peut être vide", () => {
    expect(balanceColumns([3])).toEqual([[0], []]);
    expect(balanceColumns([])).toEqual([[], []]);
  });
});

describe("Paramètres : l'origine des défauts est dite une fois par carte", () => {
  it("carte ETP (3 défauts validés, 1 proposé) : phrase au pluriel avec « sauf les règles signalées »", () => {
    expect(defaultsNote(["validated", "validated", "validated", "proposed"], "2026-10-22")).toBe("Valeurs par défaut validées le 22/10/2026, sauf les règles signalées ci-dessous.");
  });

  it("carte Absentéisme (tous validés) : phrase simple, sans réserve", () => {
    expect(defaultsNote(["validated", "validated", "validated"], "2026-10-22")).toBe("Valeurs par défaut validées le 22/10/2026.");
  });

  it("une règle modifiée ou illisible est une exception : la phrase reste, avec la réserve", () => {
    expect(defaultsNote(["validated", "setting", "invalid"], "2026-10-22")).toBe("Valeurs par défaut validées le 22/10/2026, sauf les règles signalées ci-dessous.");
  });

  it("aucun défaut validé : pas de phrase (chaque règle porte sa mention)", () => {
    expect(defaultsNote(["proposed", "setting"], "2026-10-22")).toBeNull();
    expect(defaultsNote([], "2026-10-22")).toBeNull();
  });

  it("une seule règle dans la carte : singulier", () => {
    expect(defaultsNote(["validated"], "2026-10-22")).toBe("Valeur par défaut validée le 22/10/2026.");
  });
});
