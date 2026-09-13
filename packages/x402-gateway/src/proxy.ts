/**
 * The upstream hop: once `@x402/express` has verified and settled the payment, the gateway
 * fetches the same path from the relay (`INTELLIGENCE_UPSTREAM`) and returns its bytes and
 * status untouched. The gateway computes nothing itself — the relay's WP-33 intelligence stays
 * the single source, and a solver reading the free relay directly gets identical JSON to one
 * paying through here (the payment buys access at the public edge, not different numbers).
 */

export interface UpstreamResponse {
  readonly status: number;
  readonly body: string;
  readonly contentType: string;
}

export interface UpstreamProxyOptions {
  readonly upstreamBaseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class UpstreamProxy {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: UpstreamProxyOptions) {
    this.base = options.upstreamBaseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** `pathAndQuery` is the request's original `/v1/intelligence/...?...` — forwarded verbatim. */
  async forward(pathAndQuery: string): Promise<UpstreamResponse> {
    try {
      const response = await this.fetchImpl(`${this.base}${pathAndQuery}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return {
        status: response.status,
        body: await response.text(),
        contentType: response.headers.get('content-type') ?? 'application/json',
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        status: 502,
        body: JSON.stringify({ error: `Intelligence upstream unreachable: ${reason}` }),
        contentType: 'application/json',
      };
    }
  }
}
