import { expect, test } from "@playwright/test";
import { fixtureFecBytes, fixtureFecFilename } from "../../src/lib/fec/fixture";
import { CAPTURES, createWorkspaceAsAdmin, signUp, exactText } from "./helpers";

// Étape 1d : dépôt de FEC fictifs (générés depuis la fixture de référence ; SIREN fictif).
const run = Date.now().toString(36);
const fec = (o: Parameters<typeof fixtureFecBytes>[0], name = fixtureFecFilename(o)) => ({ name, mimeType: "text/plain", buffer: Buffer.from(fixtureFecBytes(o)) });

test("FEC : dépôt, aperçu, application, réimport détecté, exercice remplacé", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Admin FEC", email: `fec-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `FEC fictif ${run}`);

  await expect(page.getByTestId("fec-files-count")).toHaveText("aucun");
  await page.getByTestId("source-fec").getByRole("link", { name: "Gérer" }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${slug}/donnees/fec$`));
  await expect(page.getByTestId("fec-coverage-empty")).toBeVisible();

  await page.getByLabel(/Fichiers FEC/).setInputFiles([fec({ exerciseEnd: "2025-09" })]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider");
  const exercises = page.getByTestId("fec-exercises").first();
  await expect(exercises).toContainText("000000000");
  await expect(exercises).toContainText("2024-10-31 → 2025-09-30");
  await expect(exercises).toContainText("équilibré");
  // Cas de référence : 641100 en octobre 2024 = 13 840,00 €.
  await expect.poll(() => exactText(page.getByTestId("ledger-totals").getByRole("row").filter({ hasText: "2024-10" }).filter({ hasText: "641100" }))).toContain("13 840,00 €");
  await expect(page.getByTestId("ledger-totals")).not.toContainText("512000");
  await page.screenshot({ path: `${CAPTURES}/1d-01-apercu-fec.png`, fullPage: true });

  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");

  // Réimport : reconnu.
  await page.goto(`/e/${slug}/donnees/fec`);
  await page.getByLabel(/Fichiers FEC/).setInputFiles([fec({ exerciseEnd: "2025-09" }, "copie.txt")]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aucun changement");
  await expect(page.getByTestId("dsn-upload-files")).toContainText("déjà déposé");

  // FEC corrigé du même exercice : remplace le précédent.
  await page.goto(`/e/${slug}/donnees/fec`);
  await page.getByLabel(/Fichiers FEC/).setInputFiles([fec({ exerciseEnd: "2025-09", photograph: 2 }, "000000000FEC20250930.txt")]);
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider");
  await expect(page.getByTestId("sync-warnings")).toContainText("remplacera");
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");

  await page.goto(`/e/${slug}/donnees/fec`);
  await expect(page.getByTestId("fec-exercises").getByRole("row")).toHaveCount(2);
  await expect(page.getByTestId("fec-files").getByRole("row")).toHaveCount(3);
  await expect(page.getByTestId("fec-history")).toContainText("Remplacée");
  await page.screenshot({ path: `${CAPTURES}/1d-02-exercices-fec.png`, fullPage: true });

  await page.goto(`/e/${slug}/donnees`);
  await expect(page.getByTestId("fec-coverage-summary")).toHaveText("2024-10-31 → 2025-09-30");
  await page.screenshot({ path: `${CAPTURES}/1d-03-donnees.png`, fullPage: true });
});
