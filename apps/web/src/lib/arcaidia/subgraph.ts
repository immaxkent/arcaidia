/**
 * The narrow GraphQL surface every subgraph-backed hook needs.
 *
 * Mirrors the backend's identical `FetchGraphQueryClient` (packages/agent,
 * packages/settlement) — same reasoning: errors surface, never swallowed. A
 * hook that read "no rows" when the endpoint was actually down would render
 * an honest-looking empty table instead of the error state the user needs to
 * see.
 */
export async function querySubgraph<T>(
  endpoint: string,
  document: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph query failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (body.errors?.length) {
    throw new Error(`Subgraph query errored: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Subgraph query returned no data.");

  return body.data;
}
