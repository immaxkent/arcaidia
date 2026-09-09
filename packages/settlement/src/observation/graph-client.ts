/**
 * The narrow GraphQL surface settlement discovery needs.
 *
 * Deliberately duplicated from `@arcaidia/agent`'s identical file rather than
 * imported: the two packages are meant to be independently swappable halves
 * (see `packages/settlement/src/index.ts`'s own docstring), and a shared
 * dependency between them would mean neither could change its transport
 * without touching the other. The type is tiny and has no logic beyond
 * `fetch` plumbing, so the duplication costs little compared to what it buys.
 */

export interface GraphQueryClient {
  query<T>(endpoint: string, document: string, variables?: Record<string, unknown>): Promise<T>;
}

/** A `fetch`-based client. Errors are surfaced, never swallowed — see the discovery provider. */
export class FetchGraphQueryClient implements GraphQueryClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiKey?: string,
  ) {}

  async query<T>(
    endpoint: string,
    document: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: document, variables }),
    });

    if (!response.ok) {
      throw new Error(`Subgraph query failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    // GraphQL returns 200 with an errors array. Treating that as success would
    // hand the worker a partially-empty world and call it fresh data.
    if (body.errors?.length) {
      throw new Error(`Subgraph query errored: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error('Subgraph query returned no data.');

    return body.data;
  }
}
