import { describe, expect, it } from "vitest";
import { ARC_TESTNET, ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import { circleSolverEnvText, runtimeConfigText } from "./earn";

const VAULT: Address = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1";
const ON_SEPOLIA = [{ chainId: ETHEREUM_SEPOLIA, vaultAddress: VAULT }];
const ON_ARC = [{ chainId: ARC_TESTNET, vaultAddress: VAULT }];

describe("runtimeConfigText (WP-19.1)", () => {
  it("emits the per-chain liquidity vault variable, using the real vault address", () => {
    const text = runtimeConfigText(ON_SEPOLIA, null);
    expect(text).toContain(`ETHEREUM_SEPOLIA_LIQUIDITY_VAULT=${VAULT}`);
  });

  it("uses the correct prefix per chain", () => {
    expect(runtimeConfigText(ON_ARC, null)).toContain("ARC_TESTNET_LIQUIDITY_VAULT=");
    expect(runtimeConfigText(ON_SEPOLIA, null)).not.toContain("ARC_TESTNET_LIQUIDITY_VAULT=");
  });

  it("names every chain the vault lives on — one solver, one file, two lines", () => {
    const text = runtimeConfigText([...ON_SEPOLIA, ...ON_ARC], null);
    expect(text).toContain(`ETHEREUM_SEPOLIA_LIQUIDITY_VAULT=${VAULT}`);
    expect(text).toContain(`ARC_TESTNET_LIQUIDITY_VAULT=${VAULT}`);
    expect(text.match(/TELEMETRY_ENABLED=true/g)).toHaveLength(1);
  });

  /// WP-22's whole point was removing the need for an operator's own Graph
  /// account — handing one back here by default would undo it.
  it("never emits a live SUBGRAPH_URL value — only a commented-out example", () => {
    const text = runtimeConfigText(ON_SEPOLIA, null);
    const activeLines = text.split("\n").filter((line) => !line.trim().startsWith("#"));

    expect(activeLines.some((line) => line.startsWith("SUBGRAPH_URL_"))).toBe(false);
    expect(text).toContain("# SUBGRAPH_URL_ETHEREUM_SEPOLIA=");
  });

  it("never emits an operator private key of any kind", () => {
    const text = runtimeConfigText(ON_SEPOLIA, null);
    expect(text).not.toMatch(/PRIVATE_KEY=0x/);
  });

  it("includes the configured telemetry URL when one is set", () => {
    const text = runtimeConfigText(ON_SEPOLIA, "https://relay.example");
    expect(text).toContain("ARCAIDIA_TELEMETRY_URL=https://relay.example");
  });

  it("is honest, not silent, when no telemetry URL is configured", () => {
    const text = runtimeConfigText(ON_SEPOLIA, null);
    expect(text).toContain("ARCAIDIA_TELEMETRY_URL=# not configured for this deployment yet");
  });
});

describe("circleSolverEnvText (Circle Agent Wallet operators)", () => {
  const SUBMITTER = `0x${"22".repeat(32)}` as const;
  const WALLET: Address = "0x6b73143220c1fb00b96d7dbde302ff55157f3424";

  it("names the wallet, leaves the three Circle secrets for the operator, and carries only the submitter key", () => {
    const text = circleSolverEnvText([...ON_SEPOLIA, ...ON_ARC], WALLET, SUBMITTER, "https://relay.example");
    expect(text).toContain(`CIRCLE_AGENT_WALLET_ADDRESS=${WALLET}`);
    expect(text).toMatch(/^CIRCLE_API_KEY=$/m);
    expect(text).toMatch(/^CIRCLE_ENTITY_SECRET=$/m);
    expect(text).toMatch(/^CIRCLE_AGENT_WALLET_ID=$/m);
    expect(text).toContain(`LOCAL_SUBMITTER_PRIVATE_KEY=${SUBMITTER}`);
    expect(text).not.toContain("LOCAL_AGENT_PRIVATE_KEY=");
    expect(text).toContain(`ETHEREUM_SEPOLIA_LIQUIDITY_VAULT=${VAULT}`);
    expect(text).toContain(`ARC_TESTNET_LIQUIDITY_VAULT=${VAULT}`);
  });
});
