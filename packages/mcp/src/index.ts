/**
 * @arcaidia/mcp — Arcaidia's state, queryable in natural language.
 *
 * An MCP server exposing what the solver sees: vault liquidity, outstanding
 * exposure, settlement backlog and pending work. Composed with The Graph's
 * Subgraph MCP, it lets an agent ask about the protocol rather than parse it.
 *
 * Read-only by construction. See `tools.ts` for why that is not negotiable.
 */

export { ArcaidiaTools } from './tools.js';
export type {
  ArcaidiaToolOptions,
  VaultReport,
  SettlementReport,
  PendingIntentReport,
} from './tools.js';
export { formatUsdc, usdc, formatBps, formatDuration, shortAddress } from './format.js';
