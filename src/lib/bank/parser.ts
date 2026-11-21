import { parseCamt053 } from "./camt";
import { parseBankCsv } from "./csv";
import { BankError, type BankFormat, type BankParseResult } from "./model";
import { parseOfx } from "./ofx";
import { XmlError } from "./xml";

export const BANK_MAX_BYTES = 10 * 1024 * 1024;
export const BANK_MAX_FILES = 24;

/** UTF-8 si le contenu est valide en UTF-8 (BOM retiré), sinon Windows-1252 (exports bancaires français courants). */
export function decodeBankBytes(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/** Format reconnu par le contenu, jamais par l'extension seule. CFONB 120 : hors V1, message explicite. */
export function detectBankFormat(text: string): BankFormat | "cfonb" | null {
  const head = text.slice(0, 4096);
  if (/<BkToCstmrStmt[\s>]/.test(text.slice(0, 65536)) || /camt\.053/i.test(head)) return "camt053";
  if (/OFXHEADER|<OFX>/i.test(head)) return "ofx";
  const first = head.split(/\r\n|\n|\r/)[0] ?? "";
  if (/^0[1-7]\d{5}/.test(first) && first.length >= 118 && first.length <= 122 && !/[;\t]/.test(first)) return "cfonb";
  if (/[;,\t]/.test(head)) return "csv";
  return null;
}

export type BankParseOptions = { csvAccount: { identifier: string; identifierKind: "iban" | "national" } | null };

export function parseBankFile(bytes: Uint8Array, options: BankParseOptions): BankParseResult {
  if (bytes.length === 0) throw new BankError("Fichier vide.");
  if (bytes.length > BANK_MAX_BYTES) throw new BankError("Fichier trop volumineux (10 Mo au plus).");
  const { text, encoding } = decodeBankBytes(bytes);
  const format = detectBankFormat(text);
  if (format === "cfonb") throw new BankError("Format CFONB 120 reconnu : non lu en V1. Exporte le relevé en CAMT.053, OFX ou CSV.");
  if (!format) throw new BankError("Format non reconnu : CAMT.053 (XML), OFX ou CSV attendu.");
  try {
    if (format === "camt053") return { format, encoding, ...parseCamt053(text) };
    if (format === "ofx") return { format, encoding, ...parseOfx(text) };
    if (!options.csvAccount) throw new BankError("CSV : le fichier ne porte pas l'IBAN du compte. Saisis l'IBAN du compte dans le formulaire de dépôt.");
    const { statement, profile, warnings } = parseBankCsv(text, options.csvAccount);
    return { format, encoding, statements: [statement], warnings, profile };
  } catch (e) {
    if (e instanceof XmlError) throw new BankError(`XML illisible : ${e.message}`);
    throw e;
  }
}
