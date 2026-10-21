import { expect, test } from "@playwright/test";
import { fixtureDsnBytes } from "../../src/lib/dsn/fixture";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Étape 1c : dépôt de DSN fictives (générées depuis la fixture de référence ; NIR et SIREN fictifs).
const run = Date.now().toString(36);
const dsn = (name: string, o: Parameters<typeof fixtureDsnBytes>[0]) => ({ name, mimeType: "text/plain", buffer: Buffer.from(fixtureDsnBytes(o)) });

test("DSN : dépôt, aperçu, application, réimport détecté, annule et remplace", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Admin DSN", email: `dsn-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `DSN fictive ${run}`);

  await expect(page.getByTestId("dsn-files-count")).toHaveText("aucun");
  await page.getByTestId("source-dsn").getByRole("link", { name: "Gérer" }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${slug}/donnees/dsn$`));
  await expect(page.getByTestId("dsn-coverage-empty")).toBeVisible();

  // Deux mois dans un dépôt.
  await page.getByLabel(/Fichiers DSN/).setInputFiles([dsn("dsn-2024-10.txt", { month: "2024-10" }), dsn("dsn-2024-11.txt", { month: "2024-11" })]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider");
  await expect(page.getByTestId("dsn-upload-files").getByText("lu")).toHaveCount(2);
  const decl = page.getByTestId("dsn-declarations").getByRole("row");
  await expect(decl.filter({ hasText: "2024-10" })).toContainText(/normale\s*1\/1\s*1\s*6\s*6\s*6/);
  await expect(page.getByTestId("dsn-declarations").getByText("éligible", { exact: true })).toHaveCount(2);
  await expect(page.getByTestId("dsn-coverage").getByRole("row").filter({ hasText: "2024-11" })).toContainText("Complète");
  await page.screenshot({ path: `${CAPTURES}/1c-01-apercu-dsn.png`, fullPage: true });

  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");

  // Réimport du même fichier : reconnu, rien n'est créé.
  await page.goto(`/e/${slug}/donnees/dsn`);
  await expect(page.getByTestId("dsn-files").getByRole("row")).toHaveCount(3);
  await page.getByLabel(/Fichiers DSN/).setInputFiles([dsn("copie-2024-10.txt", { month: "2024-10" })]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aucun changement");
  await expect(page.getByTestId("sync-unchanged")).toContainText("aucun doublon");
  await expect(page.getByTestId("dsn-upload-files")).toContainText("déjà déposé");

  // Annule et remplace d'octobre : elle fait foi, la normale est écartée.
  await page.goto(`/e/${slug}/donnees/dsn`);
  await page.getByLabel(/Fichiers DSN/).setInputFiles([dsn("dsn-2024-10-ar.txt", { month: "2024-10", photograph: 2, type: "03", order: "2" })]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider");
  const octobre = page.getByTestId("dsn-coverage").getByRole("row").filter({ hasText: "2024-10" });
  await expect(octobre).toContainText("annule et remplace · fraction 1/1 · ordre 2");
  await expect(octobre).toContainText("remplacée");
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");

  await page.goto(`/e/${slug}/donnees/dsn`);
  await expect(page.getByTestId("dsn-files").getByRole("row")).toHaveCount(4);
  await expect(page.getByTestId("dsn-coverage").getByRole("row").filter({ hasText: "2024-10" })).toContainText("Complète");
  await page.screenshot({ path: `${CAPTURES}/1c-02-couverture-dsn.png`, fullPage: true });

  await page.goto(`/e/${slug}/donnees`);
  await expect(page.getByTestId("dsn-files-count")).toHaveText("3");
  // Source retenue : fichiers DSN par défaut ; forcer « API uniquement » donne n.d. avec sa raison.
  await expect(page.getByTestId("source-chosen-rh")).toContainText("Fichiers DSN");
  const choice = page.getByTestId("source-choice-rh");
  await choice.getByLabel("Règle").selectOption("api");
  await choice.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByTestId("source-chosen-rh")).toContainText("n.d.");
  await expect(page.getByTestId("source-chosen-rh")).toContainText("aucune lecture API appliquée");
  await choice.getByLabel("Règle").selectOption("auto");
  await choice.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByTestId("source-chosen-rh")).toContainText("Fichiers DSN");
  await expect(page.getByTestId("dsn-coverage-summary")).toContainText("2 mois × établissement complet(s) sur 2");

  // Paramètres de l'espace : définition de l'effectif (défaut validé CDI + CDD), modifiable par l'administrateur.
  await page.goto(`/e/${slug}/parametres`);
  await expect(page.getByTestId("setting-headcount-origin")).toContainText("Valeur par défaut");
  await expect(page.getByRole("checkbox", { name: /^CDI 01$/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /^CDD 02$/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /^CDD 02$/ }).uncheck();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("enregistrées");
  await page.reload();
  await expect(page.getByTestId("setting-headcount-origin")).toContainText("Modifié le");
  await expect(page.getByRole("checkbox", { name: /^CDD 02$/ })).not.toBeChecked();
  await page.screenshot({ path: `${CAPTURES}/2a-01-parametres.png`, fullPage: true });
});
