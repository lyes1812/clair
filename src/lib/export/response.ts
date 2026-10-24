// Réponse HTTP d'un export Excel : type MIME, nom de fichier assaini, jamais mis en cache.
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const FILE_NAME_MAX = 100;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// Nom de fichier sans extension : ni chemin, ni guillemet, ni retour à la ligne, ni caractère réservé, ni point ou tiret en tête.
function cleanBase(name: string, ext: string): string {
  let s = String(name)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\\/:*?"<>|%;,]+/g, " ")
    .trim()
    .replace(new RegExp(`\\.${ext}$`, "i"), "")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s]+$/, "");
  if (RESERVED.test(s)) s = `export-${s}`;
  s = s.slice(0, FILE_NAME_MAX).replace(/[.\s]+$/, "");
  return s || "export";
}

export const safeFileName = (name: string, ext = "xlsx"): string => `${cleanBase(name, ext)}.${ext}`;

// En-tête Content-Disposition : repli ASCII (filename) et nom complet en UTF-8 (filename*, RFC 5987).
export function contentDisposition(name: string, ext = "xlsx"): string {
  const base = cleanBase(name, ext);
  const ascii =
    base
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "") || "export";
  const full = encodeURIComponent(`${base}.${ext}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${full}`;
}

export function xlsxResponse(buffer: Buffer, name: string): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type": XLSX_MIME,
      "content-disposition": contentDisposition(name, "xlsx"),
      "content-length": String(buffer.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
