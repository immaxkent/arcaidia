/**
 * The narrow GraphQL surface the observation provider needs.
 *
 * A tiny interface rather than a client library: it keeps the provider testable
 * without a server, and it means swapping the transport (a different Graph
 * gateway, an API key change) touches one file.
 */

export interface GraphQueryClient {
  query<T>(endpoint: string, document: string, variables?: Record<string, unknown>): Promise<T>;
}

/** A `fetch`-based client. Errors are surfaced, never swallowed — see the provider. */
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
    // hand the solver a partially-empty world and call it fresh data.
    if (body.errors?.length) {
      throw new Error(`Subgraph query errored: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error('Subgraph query returned no data.');

    return body.data;
  }
}
