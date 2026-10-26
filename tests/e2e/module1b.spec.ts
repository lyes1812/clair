import { expect, test } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp, exactText } from "./helpers";

// Étape 1b : connecteur Pennylane sur le transport fictif (clé « fixture-pl-… », aucune donnée réelle).
const run = Date.now().toString(36);

test("Pennylane : connexion, lecture du plan comptable et des écritures, application", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Admin Compta", email: `compta-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Compta fictive ${run}`);

  const card = page.getByTestId("source-pennylane");
  await expect(card.getByTestId("pennylane-connection")).toHaveText("Non connectée");
  await card.getByRole("link", { name: "Gérer" }).click();
  await expect(page).toHaveURL(new RegExp(`/e/${slug}/donnees/pennylane$`));

  await page.getByLabel("Clé API Pennylane").fill("fixture-pl-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
  await expect(page.getByTestId("connection-detail")).toContainText("9001");

  await page.getByLabel("Du mois").fill("2024-10");
  await page.getByLabel("Au mois").fill("2024-12");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 60_000 });
  const summary = page.getByTestId("sync-summary");
  await expect(summary.getByRole("row").filter({ hasText: "Plan comptable" })).toContainText(/lue\s*9\s*9/);
  // Cas de référence : 641100 en octobre 2024 = 13 840,00 € (somme des bruts fictifs du mois).
  await expect.poll(() => exactText(page.getByTestId("ledger-totals").getByRole("row").filter({ hasText: "2024-10" }).filter({ hasText: "641100" }))).toContain("13 840,00 €");
  await page.screenshot({ path: `${CAPTURES}/1b-01-apercu-pennylane.png`, fullPage: true });

  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");

  await page.goto(`/e/${slug}/donnees`);
  await expect(page.getByTestId("pennylane-active")).toContainText("Appliquée le");
  await expect(page.getByTestId("payfit-connection")).toHaveText("Non connectée");
  await page.screenshot({ path: `${CAPTURES}/1b-02-donnees.png`, fullPage: true });
});
