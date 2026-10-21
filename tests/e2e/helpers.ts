import { expect, type Page } from "@playwright/test";
import { TOTP } from "otpauth";

export const PASSWORD = "Fictif-Test-2026!";
export const CAPTURES = process.env.CAPTURES_DIR ?? "captures";

export async function signUp(page: Page, u: { name: string; email: string }) {
  await page.goto("/inscription");
  await page.getByLabel("Nom").fill(u.name);
  await page.getByLabel("E-mail").fill(u.email);
  await page.getByLabel(/Mot de passe/).fill(PASSWORD);
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page).toHaveURL(/\/espaces$/);
}

// Crée un espace et active le TOTP de l'administrateur ; renvoie le slug et le secret TOTP.
export async function createWorkspaceAsAdmin(page: Page, name: string) {
  await page.getByLabel(/Nom de l'espace/).fill(name);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(/\/securite\?retour=/);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Configurer" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Code à 6 chiffres").fill(new TOTP({ secret, digits: 6, period: 30 }).generate());
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByTestId("totp-enabled")).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page).toHaveURL(/\/e\/[a-z0-9-]+\/donnees$/);
  return { slug: page.url().match(/\/e\/([a-z0-9-]+)\//)![1], secret };
}
