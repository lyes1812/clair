// Transport HTTP commun aux connecteurs : lecture seule, aucune redirection suivie, réponses bornées,
// erreurs sans clé ni contenu de réponse.
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ProviderErrorCode =
  | "key_rejected"
  | "scope_denied"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "timeout"
  | "too_large";

export const PROVIDER_ERROR_LABELS: Record<ProviderErrorCode, string> = {
  key_rejected: "Clé API refusée par le fournisseur.",
  scope_denied: "Droit non accordé à cette clé.",
  not_found: "Ressource introuvable chez le fournisseur.",
  rate_limited: "Le fournisseur limite les appels : réessayez plus tard.",
  unavailable: "Fournisseur indisponible.",
  invalid_response: "Réponse du fournisseur non conforme au format attendu.",
  timeout: "Le fournisseur n'a pas répondu à temps.",
  too_large: "Réponse du fournisseur trop volumineuse.",
};

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    detail?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(detail ? `${PROVIDER_ERROR_LABELS[code]} (${detail})` : PROVIDER_ERROR_LABELS[code]);
    this.name = "ProviderError";
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 30;
  const v = value.trim();
  let seconds: number;
  if (/^\d+$/.test(v)) seconds = Number(v);
  else {
    const date = Date.parse(v);
    seconds = Number.isNaN(date) ? 30 : Math.ceil((date - now) / 1000);
  }
  return Math.min(300, Math.max(1, seconds));
}

export type RequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

export async function requestJson(fetchImpl: FetchLike, url: string, opts: RequestOptions = {}): Promise<unknown> {
  const { method = "GET", headers = {}, body, timeoutMs = 15_000, maxBytes = 4 * 1024 * 1024 } = opts;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { accept: "application/json", ...headers },
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new ProviderError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unavailable");
  }
  const { status } = response;
  if (status >= 300) {
    await response.body?.cancel().catch(() => {});
    if (status === 401) throw new ProviderError("key_rejected");
    if (status === 403) throw new ProviderError("scope_denied");
    if (status === 404) throw new ProviderError("not_found");
    if (status === 429) throw new ProviderError("rate_limited", undefined, parseRetryAfter(response.headers.get("retry-after")));
    throw new ProviderError("unavailable", status < 400 ? "redirection refusée" : `HTTP ${status}`);
  }
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError("invalid_response", "type de contenu");
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError("too_large");
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (e) {
    throw new ProviderError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "unavailable");
  }
  if (buffer.byteLength > maxBytes) throw new ProviderError("too_large");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    throw new ProviderError("invalid_response", "JSON illisible");
  }
}

// Relance bornée sur limitation (429), en respectant le délai indiqué par le fournisseur.
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 3, maxWaitSeconds = 60, sleep = defaultSleep }: { maxRetries?: number; maxWaitSeconds?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ProviderError) || e.code !== "rate_limited" || attempt >= maxRetries) throw e;
      const wait = e.retryAfterSeconds ?? 30;
      if (wait > maxWaitSeconds) throw e;
      await sleep(wait * 1000);
    }
  }
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
