import { expect, test } from "@playwright/test";
import { createWorkspaceAsAdmin, exactText, signUp } from "./helpers";

// Parcours entièrement fictif : aucun connecteur ni synchronisation de paie nécessaire.
test("Suivi : référence explicite, budget incomplet, GET et vigilance au clavier", async ({ page }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36);
  await signUp(page, { name: "Admin Suivi fictif", email: `suivi-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `Entreprise Suivi fictive ${run}`);
  const studio = `/e/${slug}/studio-rh`;
  await page.goto(`${studio}/hypotheses`);
  await page.getByTestId("hyp-budgets").getByText("Saisir un budget").click();
  const create = page.getByTestId("budget-create");
  await create.getByLabel("Nom").fill("Budget Suivi fictif");
  await create.getByLabel("Année").fill("2026");
  await create.locator('input[name="m01"]').fill("0");
  await create.locator('input[name="m02"]').fill("12345");
  await create.getByRole("button", { name: "Créer le budget" }).click();
  await expect(create.getByRole("status")).toContainText("enregistré");

  await page.goto(`${studio}/masse-salariale/suivi?annee=2026`);
  await expect(page.getByTestId("ms-tabs").getByRole("link", { name: "Suivi réel / budget" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Budget ou scénario de référence")).toHaveValue("");
  await expect(page.getByTestId("suivi-choose-reference")).toBeVisible();
  const reference = await page.getByLabel("Budget ou scénario de référence").locator("option").filter({ hasText: "Budget Suivi fictif" }).getAttribute("value");
  await page.getByLabel("Budget ou scénario de référence").selectOption(reference!);
  await page.getByTestId("suivi-filters").getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByTestId("suivi-table").locator("tbody tr")).toHaveCount(12);
  expect(await exactText(page.getByTestId("suivi-table").locator('tr[data-month="2026-01"] td[data-col="reference"]'))).toBe("0,00 €");
  expect(await exactText(page.getByTestId("suivi-table").locator('tr[data-month="2026-02"] td[data-col="reference"]'))).toBe("12 345,00 €");
  await expect(page.getByTestId("suivi-table").locator('tr[data-month="2026-03"] td[data-col="reference"]')).toHaveText("n.d.");
  await expect(page.getByTestId("suivi-total-actual")).toContainText("n.d.");
  await expect(page.getByTestId("suivi-total-gap")).toContainText("n.d.");

  const vigilance = page.getByTestId("suivi-vigilance");
  await expect(vigilance).not.toHaveAttribute("open");
  await vigilance.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(vigilance).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(vigilance).not.toHaveAttribute("open");
  await expect(vigilance.locator("summary")).toBeFocused();

  const tableOption = page.getByLabel("Affichage du suivi").locator('option[data-view="tableau"]');
  const tableHref = (await tableOption.getAttribute("value"))!;
  const url = new URL(tableHref, "http://clair.invalid");
  expect(url.searchParams.get("reference")).toBe(reference);
  expect(url.searchParams.get("annee")).toBe("2026");
  await page.getByLabel("Affichage du suivi").selectOption(tableHref);
  await expect(page.getByTestId("suivi-table")).toBeVisible();
  await expect(page.getByTestId("suivi-chart")).toHaveCount(0);
});
