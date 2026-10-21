import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

// Chiffrement des secrets d'espace (clés API) : AES-256-GCM, clé maîtresse CLAIR_SECRETS_KEY
// (32 octets en base64) en variable d'environnement, jamais en base ni dans le dépôt.
const VERSION = "v1";

function masterKey(raw = process.env.CLAIR_SECRETS_KEY): Buffer {
  if (!raw) throw new Error("CLAIR_SECRETS_KEY manquante");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CLAIR_SECRETS_KEY doit faire 32 octets (base64)");
  return key;
}

// Le contexte (espace + fournisseur) est authentifié : un secret copié vers un autre espace ne se déchiffre pas.
export function encryptSecret(plain: string, context: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(rawKey), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(sealed: string, context: string, rawKey?: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("Secret chiffré illisible");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(rawKey), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

// Empreinte d'un identifiant sensible (NIR…) propre à un espace : permet le rapprochement sans stocker la valeur.
export function workspaceFingerprint(workspaceId: string, value: string, rawKey?: string): string {
  return createHmac("sha256", masterKey(rawKey)).update(`${workspaceId}\u0000${value}`).digest("hex");
}

// JSON canonique (clés triées) : deux contenus identiques donnent la même empreinte quel que soit l'ordre des clés.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
