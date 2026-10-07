// The HTTP layer under the generated methods: auth, timeouts, retries with
// one Idempotency-Key per call, errors. No dependencies: Node 18+ fetch.

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://api.breakreach.com";

export interface ClientOptions {
  /** API key (br_...). Defaults to the BREAKREACH_API_KEY environment variable */
  apiKey?: string;
  /** Defaults to BREAKREACH_BASE_URL, then https://api.breakreach.com */
  baseUrl?: string;
  /** Workspace slug sent with every call that takes one, unless the call sets its own */
  workspace?: string;
  /** Retries after a network error, a timeout, a 429 or a 5xx (default 2) */
  maxRetries?: number;
  /** Per attempt, in milliseconds (default 60 000, uploads 300 000) */
  timeout?: number;
  /** Your own fetch, for tests or proxies */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** Reuse a key of your own, e.g. derived from your job id, so even a restart of your script can't post twice */
  idempotencyKey?: string;
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/** The API answered with an error status. message is the API's own reason */
export class BreakreachError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "BreakreachError";
    this.status = status;
    this.body = body;
  }
}

/** No answer: network failure or timeout, after every retry */
export class BreakreachConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BreakreachConnectionError";
  }
}

type Call = {
  query?: object;
  body?: object | FormData;
  idempotent?: boolean;
  workspace?: "query" | "body";
  options?: RequestOptions;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export abstract class Core {
  readonly baseUrl: string;
  readonly workspace?: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
    const apiKey = options.apiKey ?? env.BREAKREACH_API_KEY;
    if (!apiKey) throw new Error("Missing API key: pass { apiKey } or set BREAKREACH_API_KEY. Create one in Breakreach under Settings → API & MCP.");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? env.BREAKREACH_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.workspace = options.workspace;
    this.maxRetries = options.maxRetries ?? 2;
    this.timeout = options.timeout ?? 60_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  protected async request<T>(method: string, path: string, call: Call): Promise<T> {
    const opts = call.options ?? {};
    let query = call.query as Record<string, unknown> | undefined;
    let body = call.body;
    // The client's default workspace, wherever the operation takes one
    if (this.workspace && call.workspace === "query" && !(query && "workspace" in query && query.workspace !== undefined)) {
      query = { ...query, workspace: this.workspace };
    }
    if (this.workspace && call.workspace === "body" && body && !(body instanceof FormData) && (body as Record<string, unknown>).workspace === undefined) {
      body = { ...body, workspace: this.workspace };
    }

    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `breakreach-node/${VERSION}`,
    };
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    // One key for every attempt of this call: a retry can't create a second post
    const key = call.idempotent ? opts.idempotencyKey ?? newKey() : undefined;
    if (key) headers["Idempotency-Key"] = key;

    const maxRetries = opts.maxRetries ?? this.maxRetries;
    const timeout = opts.timeout ?? (body instanceof FormData ? Math.max(this.timeout, 300_000) : this.timeout);
    // Without a key, a POST that may have run isn't retried (a 500 could come
    // after the write). An upload is: storing a file twice publishes nothing.
    const safe = method === "GET" || method === "DELETE" || !!key || body instanceof FormData;

    for (let attempt = 0; ; attempt++) {
      const signals = [AbortSignal.timeout(timeout), ...(opts.signal ? [opts.signal] : [])];
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers, body: payload, signal: AbortSignal.any ? AbortSignal.any(signals) : signals[0] });
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (attempt < maxRetries && safe) {
          await sleep(backoff(attempt));
          continue;
        }
        const reason = (err as Error)?.name === "TimeoutError" ? `timed out after ${timeout} ms` : (err as Error)?.message;
        throw new BreakreachConnectionError(`${method} ${path} failed: ${reason}`, { cause: err });
      }

      const text = await res.text();
      let data: unknown = text;
      const json = (res.headers.get("content-type") || "").includes("application/json");
      if (json && text) {
        try { data = JSON.parse(text); } catch {}
      }
      if (res.ok) return data as T;

      // 409 = the first attempt with this key is still running: its answer comes on a retry.
      // A 5xx that isn't our JSON comes from the proxy (deploy, restart): the API never saw it.
      const retryable =
        res.status === 429 ||
        (res.status === 409 && !!key) ||
        (res.status >= 500 && (!json || method === "GET" || method === "DELETE"));
      if (retryable && attempt < maxRetries) {
        await sleep(retryAfter(res) ?? backoff(attempt));
        continue;
      }
      const message = (data as { error?: string })?.error ?? (text.slice(0, 200) || res.statusText);
      throw new BreakreachError(res.status, message, data);
    }
  }
}

function backoff(attempt: number) {
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base * (0.75 + Math.random() * 0.5);
}

function retryAfter(res: Response) {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 30) * 1000 : undefined;
}
