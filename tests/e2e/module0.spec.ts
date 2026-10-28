import { expect, test } from "@playwright/test";
import { CAPTURES, freshTotp, PASSWORD, signUp } from "./helpers";

// Acceptation du module 0 : connexion, création d'espace, menu figé, accès croisé refusé, rôle lecteur.
// Comptes jetables à adresses fictives ; aucune donnée réelle.
const run = Date.now().toString(36);
const users = {
  admin: { name: "Admin Test", email: `admin-${run}@test.invalid` },
  outsider: { name: "Externe Test", email: `externe-${run}@test.invalid` },
  // Hors du domaine de recette : ne peut s'inscrire que grâce à son invitation.
  reader: { name: "Lecteur Test", email: `lecteur-${run}@invite.example` },
};
const MENU = ["Données", "Collaborateurs", "KPI RH", "Masse salariale", "Hypothèses budgétaires", "Reporting social"];
// Le titre « Studio RH » est le lien vers la synthèse du Studio RH ; les cinq sous-modules restent exactement ceux de MENU.
const MENU_LINKS = ["Données", "Studio RH", ...MENU.slice(1), "Studio Finance"];

let slug = "";
let totpSecret = "";

function totpCode() {
  return freshTotp(totpSecret);
}

test.describe.serial("Module 0 — socle", () => {
  test("un administrateur crée un espace, active le TOTP et voit le menu figé", async ({ page }) => {
    await signUp(page, users.admin);
    await expect(page.getByTestId("no-workspace")).toBeVisible();
    await page.getByLabel(/Nom de l'espace/).fill(`Structure fictive ${run}`);
    await page.getByRole("button", { name: "Créer l'espace" }).click();

    // Administrateur sans TOTP : configuration imposée avant d'entrer dans l'espace.
    await expect(page).toHaveURL(/\/securite\?retour=/);
    const pendingSlug = decodeURIComponent(page.url().split("retour=")[1]).split("/")[2];
    const pending = await (await page.request.get(`/api/espaces/${pendingSlug}`)).json();
    expect(pending.role).toBe("admin");
    const blocked = await page.request.post("/api/auth/organization/invite-member", {
      data: { organizationId: pending.workspace.id, email: `y-${run}@test.invalid`, role: "reader" },
    });
    expect(blocked.status()).toBe(403);
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Configurer" }).click();
    totpSecret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.getByLabel("Code à 6 chiffres").fill(await totpCode());
    await page.getByRole("button", { name: "Activer" }).click();
    await expect(page.getByTestId("totp-enabled")).toBeVisible();
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(page).toHaveURL(/\/e\/[a-z0-9-]+\/donnees$/);
    slug = page.url().match(/\/e\/([a-z0-9-]+)\//)![1];
    const menu = page.getByTestId("main-menu");
    await expect(menu.getByRole("link")).toHaveText(MENU_LINKS);
    await expect(menu.getByText("Studio RH", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/01-espace-menu-fige.png`, fullPage: true });

    // Studio RH se replie et se déplie.
    await menu.getByRole("button", { name: "Replier le Studio RH" }).click();
    await expect(menu.getByRole("link", { name: "Collaborateurs" })).toBeHidden();
    await menu.getByRole("button", { name: "Déplier le Studio RH" }).click();
    await expect(menu.getByRole("link", { name: "Collaborateurs" })).toBeVisible();

    // Modules livrés : sans source retenue, n.d. explicite ; modules à venir : écran d'attente.
    const EMPTY: Record<string, string> = { Collaborateurs: "collaborateurs-nd", "KPI RH": "kpi-nd", "Masse salariale": "ms-nd", "Hypothèses budgétaires": "hyp-nd", "Reporting social": "prevu" };
    for (const label of MENU.slice(1)) {
      await menu.getByRole("link", { name: label }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
      await expect(page.getByTestId(EMPTY[label] ?? "placeholder")).toBeVisible();
    }
  });

  test("l'inscription sans invitation est refusée", async ({ page }) => {
    await page.goto("/inscription");
    await page.getByLabel("Nom").fill("Inconnu");
    await page.getByLabel("E-mail").fill(`inconnu-${run}@example.com`);
    await page.getByLabel(/Mot de passe/).fill(PASSWORD);
    await page.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.locator("p.error")).toContainText("sur invitation");
    await expect(page).toHaveURL(/\/inscription/);
    const api = await page.request.post("/api/auth/sign-up/email", {
      data: { name: "Inconnu", email: `inconnu2-${run}@example.com`, password: PASSWORD },
    });
    expect(api.status()).toBe(403);
    // Better Auth limite les inscriptions à 3 par 10 s et par IP : on laisse passer la fenêtre.
    await page.waitForTimeout(11_000);
  });

  test("un second utilisateur ne voit pas l'espace (liste, URL directe, API)", async ({ page }) => {
    await signUp(page, users.outsider);
    await expect(page.getByTestId("no-workspace")).toBeVisible();

    const res = await page.goto(`/e/${slug}/donnees`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Page introuvable")).toBeVisible();
    await expect(page.getByTestId("main-menu")).toHaveCount(0);
    await page.screenshot({ path: `${CAPTURES}/02-acces-croise-refuse.png`, fullPage: true });

    const api = await page.request.get(`/api/espaces/${slug}`);
    expect(api.status()).toBe(403);
    const anonymous = await page.request.get(`/api/espaces/${slug}`, { headers: { cookie: "" } });
    expect([401, 403]).toContain(anonymous.status());
  });

  test("invitation d'un lecteur, qui ne peut pas modifier l'espace", async ({ browser }) => {
    // L'administrateur se reconnecte avec son code TOTP et invite un lecteur.
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await admin.goto("/connexion");
    await admin.getByLabel("E-mail").fill(users.admin.email);
    await admin.getByLabel("Mot de passe").fill(PASSWORD);
    await admin.getByRole("button", { name: "Se connecter" }).click();
    await expect(admin).toHaveURL(/\/connexion\/totp/);
    await admin.getByLabel("Code").fill(await totpCode());
    await admin.getByRole("button", { name: "Vérifier" }).click();
    await expect(admin).toHaveURL(/\/espaces$/);

    await admin.goto(`/e/${slug}/membres`);
    await admin.getByLabel("E-mail").fill(users.reader.email);
    await admin.getByLabel("Rôle").selectOption("reader");
    await admin.getByRole("button", { name: "Inviter" }).click();
    const link = admin.getByTestId("invitation-link").first();
    await expect(link).toBeVisible();
    const invitationPath = new URL((await link.textContent())!.trim()).pathname;
    await admin.screenshot({ path: `${CAPTURES}/03-membres-invitation.png`, fullPage: true });

    const readerCtx = await browser.newContext();
    const reader = await readerCtx.newPage();
    await signUp(reader, users.reader);
    await reader.goto(invitationPath);
    await reader.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(reader).toHaveURL(new RegExp(`/e/${slug}/donnees$`));
    await expect(reader.getByTestId("main-menu").getByRole("link")).toHaveText(MENU_LINKS);

    // Interface : aucun contrôle d'administration.
    await reader.goto(`/e/${slug}/membres`);
    await expect(reader.getByTestId("member-list")).toContainText(users.admin.email);
    await expect(reader.getByRole("button", { name: "Inviter" })).toHaveCount(0);
    await expect(reader.getByRole("button", { name: "Renommer" })).toHaveCount(0);

    // API : modification refusée côté serveur.
    const info = await (await reader.request.get(`/api/espaces/${slug}`)).json();
    expect(info.workspace.id).toBeTruthy();
    expect(info.role).toBe("reader");
    const rename = await reader.request.post("/api/auth/organization/update", {
      data: { organizationId: info.workspace.id, data: { name: "Renommage interdit" } },
    });
    expect(rename.status()).toBe(403);
    const invite = await reader.request.post("/api/auth/organization/invite-member", {
      data: { organizationId: info.workspace.id, email: `x-${run}@test.invalid`, role: "reader" },
    });
    expect(invite.status()).toBe(403);
    await expect((await reader.request.get(`/api/espaces/${slug}`)).json()).resolves.toMatchObject({
      workspace: { name: `Structure fictive ${run}` },
    });

    await adminCtx.close();
    await readerCtx.close();
  });
});
