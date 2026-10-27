// Contrôle hors navigateur des fichiers téléchargés par tests/e2e/lot12-fichiers.spec.ts : chaque classeur est relu avec exceljs
// (feuilles, en-tête figée, filtre automatique, cellules n.d. avec leur raison, nombres réels), converti par LibreOffice en PDF puis
// en images ; chaque PDF est mesuré (pages). Usage : node scripts/verify-exports.mjs <dossier des fichiers> [dossier des rendus]
// Aucune donnée n'est affichée : seuls les noms de feuilles, les dimensions et les contrôles passés ou échoués.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import ExcelJS from "exceljs";

const dir = process.argv[2];
const out = process.argv[3] ?? join(dir, "rendus");
if (!dir || !existsSync(dir)) {
  console.error("Usage : node scripts/verify-exports.mjs <dossier> [rendus]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const FIXED = ["Filtres", "Sources", "Définitions"];
const report = [];
let failures = 0;
const check = (ok, what) => {
  if (!ok) failures += 1;
  return `${ok ? "OK " : "KO "} ${what}`;
};

for (const name of readdirSync(dir).filter((f) => f.endsWith(".xlsx")).sort()) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(join(dir, name)));
  const lines = [`== ${name}`];
  const sheets = wb.worksheets.map((s) => s.name);
  lines.push(`feuilles (${sheets.length}) : ${sheets.join(" · ")}`);
  lines.push(check(FIXED.every((f) => sheets.includes(f)), "feuilles Filtres / Sources / Définitions présentes"));
  lines.push(check(new Set(sheets).size === sheets.length && sheets.every((s) => s.length <= 31), "noms de feuilles uniques et ≤ 31 caractères"));
  let data = 0, nd = 0, ndWithReason = 0, numbers = 0, badNumbers = 0, texts = 0, frozen = 0, filtered = 0;
  for (const ws of wb.worksheets) {
    if (FIXED.includes(ws.name)) continue;
    data += 1;
    if ((ws.views ?? []).some((v) => v.state === "frozen")) frozen += 1;
    if (ws.autoFilter) filtered += 1;
    ws.eachRow((row) => row.eachCell((cell) => {
      const v = cell.value;
      if (typeof v === "number") { numbers += 1; if (!Number.isFinite(v)) badNumbers += 1; }
      else if (typeof v === "string") { texts += 1; if (v.trim() === "n.d.") { nd += 1; if (cell.note) ndWithReason += 1; } }
      else if (v && typeof v === "object" && "result" in v) badNumbers += 1; // une formule : interdit
    }));
  }
  lines.push(`feuilles de données : ${data} (figées : ${frozen}, filtre automatique : ${filtered}) ; nombres : ${numbers} ; textes : ${texts} ; n.d. : ${nd}`);
  lines.push(check(badNumbers === 0, "aucun nombre non fini ni formule"));
  lines.push(check(nd === ndWithReason, `chaque n.d. porte sa raison en commentaire (${ndWithReason}/${nd})`));
  lines.push(check(data === 0 || filtered === data, "filtre automatique sur chaque feuille de données"));
  // Rendu LibreOffice → PDF → PNG (première page) pour un contrôle à l'œil.
  try {
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", out, join(dir, name)], { stdio: "ignore", timeout: 120_000 });
    const pdf = join(out, name.replace(/\.xlsx$/, ".pdf"));
    const pages = /Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdf]).toString())?.[1] ?? "?";
    execFileSync("pdftoppm", ["-png", "-r", "60", "-f", "1", "-l", "1", pdf, join(out, name.replace(/\.xlsx$/, ""))], { stdio: "ignore" });
    lines.push(`rendu LibreOffice : ${pages} page(s)`);
  } catch (e) {
    lines.push(check(false, `rendu LibreOffice : ${e instanceof Error ? e.message : "échec"}`));
  }
  report.push(lines.join("\n"));
}
for (const name of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
  const buf = readFileSync(join(dir, name));
  const text = buf.toString("utf8");
  const rows = text.split(/\r?\n/).filter(Boolean);
  const cols = rows.map((r) => r.split(";").length);
  const lines = [`== ${name}`, `lignes : ${rows.length} ; colonnes : ${Math.min(...cols)}–${Math.max(...cols)}`];
  lines.push(check(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, "BOM UTF-8"));
  lines.push(check(new Set(cols).size === 1, "même nombre de colonnes sur chaque ligne"));
  lines.push(check(!rows.slice(1).some((r) => /;"?[=+@]/.test(r)), "aucune cellule texte commençant par =, + ou @ sans apostrophe"));
  report.push(lines.join("\n"));
}
for (const name of readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()) {
  const info = execFileSync("pdfinfo", [join(dir, name)]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  const size = /Page size:\s+(.+)/.exec(info)?.[1] ?? "?";
  const lines = [`== ${name}`, `pages : ${pages} ; format : ${size}`];
  if (name.includes("1-page")) lines.push(check(pages === 1, "la synthèse tient sur une page"));
  execFileSync("pdftoppm", ["-png", "-r", "60", join(dir, name), join(out, name.replace(/\.pdf$/, ""))], { stdio: "ignore" });
  report.push(lines.join("\n"));
}
const text = report.join("\n\n") + `\n\nContrôles en échec : ${failures}\n`;
writeFileSync(join(out, "rapport.txt"), text);
console.log(text);
process.exit(failures ? 1 : 0);
