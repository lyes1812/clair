import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod/v4";

// Client LLM unique de Clair (cahier des charges, section 8, garde-fou H5) : tout appel à un modèle passe par ce fichier,
// seul point de bascule entre fournisseurs. Sans clé (ANTHROPIC_API_KEY), l'IA est indisponible et Clair fonctionne en
// mode « sans IA » : règles seules, revue manuelle. Aucune donnée n'est envoyée tant que la clé n'est pas posée.

export const IA_MODEL = process.env.CLAIR_IA_MODEL || "claude-opus-5-5";

export class IaUnavailable extends Error {}
export class IaRefused extends Error {}

export function iaConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type JsonCall<T> = { system: string; user: string; schema: z.ZodType<T>; maxTokens: number };
export type JsonResult<T> = { output: T; model: string };
/** Transport injectable (tests) ; en production, l'API Anthropic. */
export type Transport = <T>(call: JsonCall<T>) => Promise<JsonResult<T>>;

let client: Anthropic | null = null;
const anthropicTransport: Transport = async <T,>(call: JsonCall<T>) => {
  if (!iaConfigured()) throw new IaUnavailable("IA non configurée : aucune clé d’API.");
  client ??= new Anthropic();
  // Classification : effort bas et sortie structurée validée par schéma. Le paramètre de température n'existe plus sur les
  // modèles actuels ; la sortie est contrainte par le schéma et toujours revue par un humain sous les seuils.
  const response = await client.beta.messages.parse({
    model: IA_MODEL,
    max_tokens: call.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: call.system,
    messages: [{ role: "user", content: call.user }],
    output_config: { effort: "low", format: betaZodOutputFormat(call.schema) },
  });
  if (response.stop_reason === "refusal") throw new IaRefused("Le modèle a refusé de répondre pour ce lot.");
  if (response.parsed_output === null || response.parsed_output === undefined) throw new IaRefused("Réponse du modèle hors schéma.");
  return { output: response.parsed_output as T, model: response.model };
};

let transport: Transport = anthropicTransport;
export const callJson: Transport = (call) => transport(call);
/** Tests uniquement : remplace le transport, puis le rétablit avec `resetTransport()`. */
export function setTransport(t: Transport) { transport = t; }
export function resetTransport() { transport = anthropicTransport; }
