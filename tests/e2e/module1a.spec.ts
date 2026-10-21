import { expect, test } from "@playwright/test";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Étape 1a : connecteur PayFit sur le transport fictif (clé « fixture-… », aucune donnée réelle).
const run = Date.now().toString(36);

test("PayFit : connexion, lecture, aperçu, application, relecture sans doublon", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Admin Données", email: `donnees-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Données fictives ${run}`);

  const source = page.getByTestId("source-payfit");
  await expect(source.getByTestId("payfit-connection")).toHaveText("Non connectée");
  await expect(source.getByTestId("payfit-active")).toContainText("n.d.");
  await source.getByRole("link", { name: "Gérer" }).click();

  // Clé mal formée : refusée sans appel réseau.
  await page.getByLabel("Clé API PayFit").fill("abc");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.locator("p.error")).toContainText("Clé API refusée");

  await page.getByLabel("Clé API PayFit").fill("fixture-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
  await expect(page.getByTestId("connection-detail")).toContainText("TEST");
  await expect(page.getByTestId("connection-detail")).toContainText("time:read");

  await page.getByLabel("Du mois").fill("2024-10");
  await page.getByLabel("Au mois").fill("2025-03");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page).toHaveURL(/\/donnees\/synchro\/[0-9a-f-]{36}$/);
  const syncUrl = page.url();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 60_000 });

  const summary = page.getByTestId("sync-summary");
  const row = (label: string) => summary.getByRole("row").filter({ hasText: label });
  await expect(row("Collaborateurs")).toContainText(/lue\s*8\s*8\s*0\s*0/);
  await expect(row("Contrats")).toContainText(/lue\s*8\s*8/);
  await expect(page.getByTestId("ledger-totals")).toContainText("641100");
  await page.screenshot({ path: `${CAPTURES}/1a-01-apercu-payfit.png`, fullPage: true });

  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");
  await expect(page.getByTestId("sync-active")).toBeVisible();
  await page.goto(syncUrl);
  await expect(page.getByRole("button", { name: "Appliquer cette lecture" })).toHaveCount(0);

  // Relecture du même contenu : détectée, aucun doublon.
  await page.goto(`/e/${slug}/donnees/payfit`);
  await page.getByLabel("Du mois").fill("2024-10");
  await page.getByLabel("Au mois").fill("2025-03");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aucun changement", { timeout: 60_000 });
  await expect(page.getByTestId("sync-unchanged")).toBeVisible();

  await page.goto(`/e/${slug}/donnees/payfit`);
  await expect(page.getByTestId("sync-history").getByRole("row")).toHaveCount(3);
  await page.screenshot({ path: `${CAPTURES}/1a-02-historique-payfit.png`, fullPage: true });

  await page.goto(`/e/${slug}/donnees`);
  await expect(page.getByTestId("payfit-connection")).toContainText("Vérifiée");
  await expect(page.getByTestId("payfit-active")).toContainText("Appliquée le");
  await page.screenshot({ path: `${CAPTURES}/1a-03-donnees.png`, fullPage: true });
});
