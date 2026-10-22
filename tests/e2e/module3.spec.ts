import { expect, test, type Browser } from "@playwright/test";
import { addMonthsToDate } from "../../src/lib/dates";
import { fixtureDsnBytes } from "../../src/lib/dsn/fixture";
import { CAPTURES, createWorkspaceAsAdmin, signUp } from "./helpers";

// Module 3 : KPI RH sur le transport PayFit fictif puis sur les DSN fictives (aucune donnée réelle).
// Les attentes PayFit dépendent de la date de lecture réelle : elles sont recalculées à partir des faits de la fixture.
const run = Date.now().toString(36);
const dsn = (month: string) => ({ name: `dsn-${month}.txt`, mimeType: "text/plain", buffer: Buffer.from(fixtureDsnBytes({ month })) });
const addM = (m: string, n: number) => {
  const [y, mm] = m.split("-").map(Number);
  const t = y * 12 + (mm - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const span = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addM(m, 1)) out.push(m);
  return out;
};
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
// Faits de la fixture A (profil 1) : ETP fin de mois en dix-millièmes et effectif fin de mois en personnes.
const etp4 = (m: string) => (m <= "2025-03" ? 48000 : m <= "2025-12" ? 56000 : m === "2026-01" ? 51000 : 61000);
// Arrondi au plus proche, demi vers le haut, à deux décimales, en virgule française.
const fr2 = (num: number, den: number) => {
  const units = Math.floor((200 * num + den) / (2 * den));
  return `${Math.floor(units / 100)},${String(units % 100).padStart(2, "0")}`;
};

async function invite(page: import("@playwright/test").Page, slug: string, email: string, role: "editor" | "reader") {
  await page.goto(`/e/${slug}/membres`);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Rôle", { exact: true }).selectOption(role);
  await page.getByRole("button", { name: "Inviter" }).click();
  const link = page.getByTestId("invitation-list").locator("li").filter({ hasText: email }).getByTestId("invitation-link");
  await expect(link).toBeVisible();
  return new URL((await link.textContent())!.trim()).pathname;
}

async function asMember(browser: Browser, user: { name: string; email: string }, invitationPath: string) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await signUp(p, user);
  await p.goto(invitationPath);
  await p.getByRole("button", { name: "Accepter l'invitation" }).click();
  await expect(p).toHaveURL(/\/donnees$/);
  return { ctx, page: p };
}

test("KPI RH : PayFit puis DSN, paramètres, détail, rôles", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await signUp(page, { name: "Admin KPI", email: `kpi-${run}@test.invalid` });
  const { slug } = await createWorkspaceAsAdmin(page, `KPI fictifs ${run}`);
  const kpi = `/e/${slug}/studio-rh/kpi`;

  // Sans source : n.d. explicite.
  await page.goto(kpi);
  await expect(page.getByTestId("kpi-nd")).toBeVisible();

  // Lecture PayFit fictive appliquée sur 24 mois.
  await page.goto(`/e/${slug}/donnees/payfit`);
  await page.getByLabel("Clé API PayFit").fill("fixture-A-1");
  await page.getByRole("button", { name: "Vérifier et enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Connexion vérifiée");
  await page.getByLabel("Du mois").fill("2024-10");
  await page.getByLabel("Au mois").fill("2026-09");
  await page.getByRole("button", { name: "Synchroniser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée (active)");

  // Date de référence R = jour de la lecture ; dernier mois clos ; mois en borne basse (≤ mois(R) − 12).
  await page.goto(kpi);
  const refText = (await page.getByTestId("rh-build-info").textContent())!.match(/date de référence (\d{2})\/(\d{2})\/(\d{4})/)!;
  const refMonth = `${refText[3]}-${refText[2]}`;
  const refDate = `${refMonth}-${refText[1]}`;
  const isMonthEnd = Number(refText[1]) === lastDay(refMonth);
  const closed = isMonthEnd ? refMonth : addM(refMonth, -1);
  const windowStart = addM(refMonth, -12);
  const lower = (m: string) => m <= windowStart;
  const cutoff = addMonthsToDate(refDate, -12);
  const window = span(addM(closed, -11), closed);
  expect(`${window[0]}-${String(lastDay(window[0])).padStart(2, "0")}` >= cutoff).toBe(true); // ETP de fin de mois exacts sur toute la fenêtre

  await expect(page.getByTestId("kpi-closed-month")).toContainText(closed);
  await expect(page.getByTestId("kpi-payfit-notice")).toBeVisible();
  await expect(page.getByTestId("kpi-payfit-notice")).toContainText("Quotités à la date de lecture");
  await expect(page.getByTestId("kpi-tile-etp-end").locator("dd")).toHaveText("6,10");
  await expect(page.getByTestId("kpi-tile-etp-end")).toContainText("quotités à la date de lecture");
  // ETP moyen exact : somme des ETP fin de mois ÷ 12 (effectif exact au jour près depuis R − 12 mois).
  await expect(page.getByTestId("kpi-tile-etp-avg").locator("dd")).toHaveText(fr2(window.reduce((s, m) => s + etp4(m), 0), 12 * 10000));
  if (!isMonthEnd) await expect(page.getByTestId("kpi-tile-turnover").locator("dd")).toContainText("n.d.");
  await expect(page.getByTestId("kpi-tile-absenteeism").locator("dd")).toContainText("types d'absence non choisis");
  await expect(page.getByTestId("kpi-monthly-table").locator("tbody tr")).toHaveCount(12);
  await expect(page.getByTestId("kpi-definitions")).toBeAttached();
  await expect(page.locator("#def-etp-month-end")).toBeAttached();
  await expect(page.getByTestId("kpi-source-gaps")).toBeAttached();

  // Paramètre GET invalide : remplacé par le défaut et signalé.
  await page.goto(`${kpi}?fin=2027-01`);
  await expect(page.getByTestId("kpi-param-notice")).toContainText("paramètre ignoré : fin=2027-01 (hors des mois clos)");

  // Paramètres : choix des trois types d'absence de la lecture.
  await page.goto(`/e/${slug}/parametres`);
  await expect(page.getByTestId("setting-kpi-origin-absence-types")).toContainText("Valeur par défaut");
  const types = page.getByTestId("setting-kpi-absence-types");
  await expect(types).toHaveCount(3);
  for (let i = 0; i < 3; i++) await types.nth(i).check();
  await page.getByTestId("setting-kpi-save").click();
  await expect(page.getByTestId("setting-kpi-status")).toContainText("Définitions des KPI enregistrées");
  await page.reload();
  await expect(page.getByTestId("setting-kpi-origin-absence-types")).toContainText("Modifié le");
  await page.getByTestId("setting-kpi").screenshot({ path: `${CAPTURES}/3-04-parametres.png` });

  // Absentéisme mois par mois sur octobre 2025 → septembre 2026.
  await page.goto(`${kpi}?fin=2026-09`);
  await expect(page.getByTestId("kpi-absence-types")).toContainText("test_maternity (1)");
  const cell = (m: string, col: string) => page.getByTestId("kpi-monthly-table").locator(`tr[data-month='${m}'] td[data-col='${col}']`);
  if (lower("2025-12")) await expect(cell("2025-12", "absenteeism")).toContainText("n.d.");
  else await expect(cell("2025-12", "absenteeism")).toHaveText("6,91 %");
  await expect(cell("2026-02", "absenteeism")).toHaveText("0,00 %");
  await expect(cell("2026-02", "theoretical")).toHaveText("182 j");
  if (lower("2025-10")) await expect(page.getByTestId("kpi-tile-absenteeism").locator("dd")).toContainText("n.d.");
  await page.screenshot({ path: `${CAPTURES}/3-01-kpi-payfit.png`, fullPage: true });

  if (!lower("2025-12")) {
    await cell("2025-12", "absenteeism").locator("a").click();
    const detail = page.getByTestId("kpi-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("kpi-detail-absences")).toContainText("TEST-A-ABSENCE-2");
    await expect(detail.getByTestId("kpi-detail-absences")).toContainText("30 (15 j)");
    await expect(detail.getByTestId("kpi-detail-theoretical").locator("tbody tr")).toHaveCount(7);
    await expect(detail.getByTestId("kpi-detail-total")).toContainText("30 demi-journées = 15 j ÷ 217 j = 6,91 %");
    await detail.screenshot({ path: `${CAPTURES}/3-02-detail.png` });
  }

  // Dépôt des 24 DSN fictives, règle « Fichiers uniquement ».
  await page.goto(`/e/${slug}/donnees/dsn`);
  await page.getByLabel(/Fichiers DSN/).setInputFiles(span("2024-10", "2026-09").map(dsn));
  await page.getByRole("button", { name: "Déposer et prévisualiser" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Aperçu à valider", { timeout: 90_000 });
  await page.getByRole("button", { name: "Appliquer cette lecture" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Appliquée");
  await page.goto(`/e/${slug}/donnees`);
  const choice = page.getByTestId("source-choice-rh");
  await choice.getByLabel("Règle").selectOption("files");
  await choice.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByTestId("source-chosen-rh")).toContainText("Fichiers DSN");

  await page.goto(kpi);
  await expect(page.getByTestId("source-badge-rh")).toContainText("Fichiers DSN");
  await expect(page.getByTestId("kpi-closed-month")).toContainText("2026-09");
  await expect(page.getByTestId("kpi-payfit-notice")).toHaveCount(0);
  const tile = (id: string) => page.getByTestId(`kpi-tile-${id}`);
  await expect(tile("etp-end").locator("dd")).toHaveText("6,10");
  await expect(tile("etp-end-n1")).toContainText("5,60");
  await expect(tile("etp-end-delta")).toContainText("+0,50 ETP");
  await expect(tile("etp-avg").locator("dd")).toHaveText("5,89");
  await expect(tile("etp-avg-n1")).toContainText("5,20");
  await expect(tile("etp-avg-delta")).toContainText("+0,69 ETP");
  await expect(tile("headcount-avg").locator("dd")).toHaveText("6,92");
  await expect(tile("headcount-avg-n1")).toContainText("6,50");
  await expect(tile("turnover").locator("dd")).toHaveText("14,46 %");
  await expect(tile("turnover-n1")).toContainText("53,85 %");
  await expect(tile("turnover-delta")).toContainText("−39,39 pts");
  await expect(tile("absenteeism").locator("dd")).toHaveText("n.d. — arrêts non extraits de la DSN");
  await expect(page.getByTestId("kpi-monthly-table").locator("tr[data-month='2025-12'] td[data-col='theoretical']")).toHaveText("217 j");
  // Jours théoriques de la période : exacts même quand l'absentéisme est n.d. (2 510 j sur octobre 2025 → septembre 2026).
  const footTheoretical = (await page.getByTestId("kpi-monthly-foot").locator("td[data-col='theoretical']").textContent())!;
  expect(footTheoretical.replace(/\s/g, " "), [...footTheoretical].map((c) => c.charCodeAt(0).toString(16)).join(" ")).toBe("2 510 j");
  await page.goto(`${kpi}?detail=absenteeism&mois=2026-13#kpi-detail`);
  await expect(page.getByTestId("kpi-param-notice")).toContainText("paramètre ignoré : mois=2026-13 (format AAAA-MM attendu)");

  // Année civile 2025.
  await page.goto(`${kpi}?mode=civil&annee=2025`);
  await expect(page.getByTestId("kpi-period")).toContainText("année civile 2025");
  await expect(tile("etp-avg").locator("dd")).toHaveText("5,40");
  await expect(tile("headcount-avg").locator("dd")).toHaveText("6,75");
  await expect(tile("turnover").locator("dd")).toHaveText("14,81 %");
  await expect(tile("etp-end-delta")).toContainText("+0,80 ETP");

  // Détail de l'ETP fin septembre 2026 : sept contrats, quotités DSN, total.
  await page.goto(`${kpi}?detail=etp-end&mois=2026-09#kpi-detail`);
  const detail = page.getByTestId("kpi-detail");
  await expect(detail.getByTestId("kpi-detail-contracts").locator("tbody tr")).toHaveCount(7);
  await expect(detail.getByTestId("kpi-detail-contracts")).toContainText("138,67 / 173,33");
  await expect(detail.getByTestId("kpi-detail-total")).toContainText("6,10");
  await page.screenshot({ path: `${CAPTURES}/3-03-kpi-dsn.png`, fullPage: true });

  // Détail du turnover : 1 entrée, 1 sortie, base effectif moyen 83/12.
  await page.goto(`${kpi}?detail=turnover#kpi-detail`);
  await expect(page.getByTestId("kpi-detail-total")).toContainText("((1 + 1) ÷ 2) ÷ 83/12 = 12/83 = 14,46 %");

  // Éditeur et lecteur : la page s'affiche ; le formulaire des définitions est désactivé.
  for (const role of ["editor", "reader"] as const) {
    const user = { name: `KPI ${role}`, email: `kpi-${role}-${run}@invite.example` };
    const path = await invite(page, slug, user.email, role);
    const member = await asMember(browser, user, path);
    await member.page.goto(kpi);
    await expect(member.page.getByTestId("kpi-tile-etp-end").locator("dd")).toHaveText("6,10");
    await member.page.goto(`/e/${slug}/parametres`);
    await expect(member.page.getByTestId("setting-kpi-save")).toHaveCount(0);
    await expect(member.page.getByTestId("setting-kpi-etp-full-time")).toBeDisabled();
    await member.ctx.close();
  }
});
