import { randomBytes } from "node:crypto";

// Slug lisible + suffixe aléatoire : l'adresse d'un espace ne se devine pas à partir de son nom.
export function workspaceSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const suffix = randomBytes(4).toString("hex");
  return base ? `${base}-${suffix}` : `espace-${suffix}`;
}
