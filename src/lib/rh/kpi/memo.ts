import type { KpiInput } from "./types";

// Mémo par appel : clé = objet d'entrée (une requête), donc libéré avec lui ; aucun cache partagé entre requêtes.
const memos = new WeakMap<KpiInput, Map<string, unknown>>();

export function memo<T>(input: KpiInput, key: string, compute: () => T): T {
  let m = memos.get(input);
  if (!m) {
    m = new Map();
    memos.set(input, m);
  }
  if (!m.has(key)) m.set(key, compute());
  return m.get(key) as T;
}
