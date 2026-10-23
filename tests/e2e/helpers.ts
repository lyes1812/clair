import { expect, type Page } from "@playwright/test";
import { TOTP } from "otpauth";

export const PASSWORD = "Fictif-Test-2026!";
export const CAPTURES = process.env.CAPTURES_DIR ?? "captures";

// Better Auth limite les inscriptions à 3 par 10 s et par adresse IP : on attend la fenêtre si besoin.
export async function signUp(page: Page, u: { name: string; email: string }) {
  await page.goto("/inscription");
  for (let attempt = 0; ; attempt++) {
    await page.getByLabel("Nom").fill(u.name);
    await page.getByLabel("E-mail").fill(u.email);
    await page.getByLabel(/Mot de passe/).fill(PASSWORD);
    await page.getByRole("button", { name: "Créer le compte" }).click();
    const outcome = await Promise.race([
      page.waitForURL(/\/espaces$/).then(() => "ok" as const),
      page.locator("p.error").waitFor().then(() => "error" as const),
    ]);
    if (outcome === "ok") return;
    const message = (await page.locator("p.error").textContent()) ?? "";
    if (!/Trop de tentatives/.test(message) || attempt >= 2) throw new Error(`Inscription refusée : ${message}`);
    await page.waitForTimeout(11_000);
  }
}

// Code TOTP généré loin d'un changement de fenêtre de 30 s (horloges du poste de test et du serveur légèrement
// décalées) : si moins de 10 s restent dans la fenêtre courante, on attend la suivante.
export async function freshTotp(secret: string): Promise<string> {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 10) await new Promise((r) => setTimeout(r, (left + 1) * 1000));
  return new TOTP({ secret, digits: 6, period: 30 }).generate();
}

// Crée un espace et active le TOTP de l'administrateur ; renvoie le slug et le secret TOTP.
export async function createWorkspaceAsAdmin(page: Page, name: string) {
  await page.getByLabel(/Nom de l'espace/).fill(name);
  await page.getByRole("button", { name: "Créer l'espace" }).click();
  await expect(page).toHaveURL(/\/securite\?retour=/);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Configurer" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Code à 6 chiffres").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByTestId("totp-enabled")).toBeVisible();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page).toHaveURL(/\/e\/[a-z0-9-]+\/donnees$/);
  return { slug: page.url().match(/\/e\/([a-z0-9-]+)\//)![1], secret };
}
